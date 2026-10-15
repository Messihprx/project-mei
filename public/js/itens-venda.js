// Construtor de itens da venda (multi-produto) — compartilhado entre
// o formulário de nova venda e o modal de edição.
//
// const editor = criarEditorItens({
//     listaEl, totalEl, inputBusca, btnAddProduto, btnAddAvulso, produtos
// });
// editor.getItens();   // [{produto_id, descricao, quantidade, valor_unit}]
// editor.setItens([]); // carrega para edição
// editor.total();      // soma qtd × valor_unit

import { esc } from './dom-utils.js';
import { montarSelectBusca } from './select-busca.js';

export function formatarMoeda(valor) {
    return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function totalDosItens(itens) {
    return itens.reduce((soma, it) => soma + (Number(it.quantidade) || 0) * (Number(it.valor_unit) || 0), 0);
}

export function resumoDosItens(itens) {
    return itens
        .map(it => {
            const qtd = Number(it.quantidade) || 1;
            return qtd > 1 ? `${qtd}x ${it.descricao}` : it.descricao;
        })
        .join('; ');
}

export function criarEditorItens(config) {
    const { listaEl, totalEl } = config;
    let itens = [];
    let produtos = config.produtos || [];
    let comboBusca = null;

    function render() {
        if (!listaEl) return;
        listaEl.innerHTML = itens.map((it, idx) => {
            const sub = (Number(it.quantidade) || 0) * (Number(it.valor_unit) || 0);
            const nome = it.produto_id
                ? `<span class="item-nome">${esc(it.descricao)}</span>`
                : `<input type="text" class="item-desc-input" value="${esc(it.descricao)}" placeholder="Descrição do serviço" data-idx="${idx}">`;
            return `
                <div class="item-venda-editor" data-idx="${idx}">
                    <div class="item-venda-info">${nome}</div>
                    <input type="number" class="item-qtd" value="${it.quantidade}" min="1" step="1" data-idx="${idx}" title="Quantidade">
                    <input type="number" class="item-valor-unit" value="${Number(it.valor_unit).toFixed(2)}" min="0" step="0.01" data-idx="${idx}" title="Valor unitário">
                    <span class="item-subtotal">${formatarMoeda(sub)}</span>
                    <button type="button" class="item-remover" data-idx="${idx}" title="Remover item">&times;</button>
                </div>
            `;
        }).join('');
        atualizarTotal();
    }

    function atualizarTotal() {
        if (totalEl) totalEl.textContent = formatarMoeda(totalDosItens(itens));
    }

    function adicionarProduto(prod) {
        const existente = itens.find(it => it.produto_id === prod.id);
        if (existente) {
            existente.quantidade = (Number(existente.quantidade) || 1) + 1;
        } else {
            itens.push({
                produto_id: prod.id,
                descricao: prod.nome,
                quantidade: 1,
                valor_unit: isNaN(parseFloat(prod.valor)) ? 0 : parseFloat(prod.valor)
            });
        }
        render();
    }

    function adicionarAvulso() {
        itens.push({ produto_id: null, descricao: '', quantidade: 1, valor_unit: 0 });
        render();
        const inputs = listaEl?.querySelectorAll('.item-desc-input');
        inputs[inputs.length - 1]?.focus();
    }

    if (listaEl) {
        listaEl.addEventListener('input', (e) => {
            const idx = Number(e.target.dataset.idx);
            if (isNaN(idx) || !itens[idx]) return;
            if (e.target.classList.contains('item-qtd')) {
                itens[idx].quantidade = Math.max(1, parseFloat(e.target.value) || 1);
            } else if (e.target.classList.contains('item-valor-unit')) {
                itens[idx].valor_unit = Math.max(0, parseFloat(e.target.value) || 0);
            } else if (e.target.classList.contains('item-desc-input')) {
                itens[idx].descricao = e.target.value;
            }
            const linha = e.target.closest('.item-venda-editor');
            if (linha) {
                const sub = (Number(itens[idx].quantidade) || 0) * (Number(itens[idx].valor_unit) || 0);
                const elSub = linha.querySelector('.item-subtotal');
                if (elSub) elSub.textContent = formatarMoeda(sub);
            }
            atualizarTotal();
        });

        listaEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.item-remover');
            if (!btn) return;
            const idx = Number(btn.dataset.idx);
            if (isNaN(idx)) return;
            itens.splice(idx, 1);
            render();
        });
    }

    if (config.inputBusca) {
        comboBusca = montarSelectBusca(config.inputBusca, {
            placeholder: config.placeholder || 'Buscar produto para adicionar...',
            permiteLivre: false,
            aoSelecionar: (valor, item) => {
                if (!valor || !item) return;
                const prod = produtos.find(p => p.id === valor) || {};
                adicionarProduto({
                    id: valor,
                    nome: item.meta?.nome || item.texto,
                    valor: item.meta?.valor ?? prod.valor
                });
                comboBusca.limpar();
                config.inputBusca.focus();
            }
        });
    }

    config.btnAddProduto?.addEventListener('click', () => comboBusca?.focar());
    config.btnAddAvulso?.addEventListener('click', adicionarAvulso);

    return {
        setProdutos(novos) {
            produtos = novos || [];
            comboBusca?.setOpcoes(produtos.map(p => ({
                valor: p.id,
                texto: p.nome,
                meta: { nome: p.nome, valor: p.valor }
            })));
        },
        getItens() {
            return itens.map(it => ({ ...it }));
        },
        setItens(novos) {
            itens = (novos || []).map(it => ({
                produto_id: it.produto_id || null,
                descricao: it.descricao || '',
                quantidade: Number(it.quantidade) || 1,
                valor_unit: Number(it.valor_unit) || 0
            }));
            render();
        },
        total() {
            return Math.round(totalDosItens(itens) * 100) / 100;
        },
        validar() {
            const invalido = itens.length === 0 || itens.some(it => !(it.descricao || '').trim() || (Number(it.quantidade) || 0) <= 0);
            return !invalido;
        }
    };
}
