import { supabase } from './auth.js';
import { esc } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirContaPadrao } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';
import { criarEditorItens, resumoDosItens, formatarMoeda } from './itens-venda.js';
import { protegerAcao, invalidarCachePlano } from './planos.js';
import { gerarComprovante } from './comprovante.js';

let listaDeClientesGlobal = [];
let listaDeProdutosGlobal = [];

const inputClienteId = document.getElementById("clienteIdSelecionado");
const inputTitulo = document.getElementById("servicoVenda");
const inputDataVenda = document.getElementById("dataVenda");
const inputConta = document.getElementById("contaVenda");
const inputStatus = document.getElementById("statusVenda");

// --- CLIENTE (opcional) ---
const comboCliente = montarSelectBusca(document.getElementById("clienteVendaInput"), {
    placeholder: 'Buscar cliente (opcional)...',
    opcaoVazia: { valor: '', texto: 'Sem cliente (avulso)' },
    permiteLivre: false,
    aoSelecionar: (valor) => {
        if (inputClienteId) inputClienteId.value = valor || '';
    }
});

// --- ITENS (carrinho compartilhado) ---
// Sem listaEl/totalEl: renderizamos nós mesmos no drawer para controlar o visual.
const editorItens = criarEditorItens({
    listaEl: null,
    totalEl: null
});

async function popularSugestoesClientes() {
    try {
        const { data: clientes, error } = await supabase
            .from('clientes').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        listaDeClientesGlobal = clientes || [];
        comboCliente.setOpcoes(listaDeClientesGlobal.map(c => ({ valor: c.id, texto: c.nome })));
    } catch (err) {
        console.error("Erro ao carregar clientes:", err.message);
    }
}

async function popularSugestoesProdutos() {
    try {
        const { data: produtos, error } = await supabase
            .from('produtos').select('id, nome, valor, descricao, foto_url').order('nome', { ascending: true });
        if (error) throw error;
        listaDeProdutosGlobal = produtos || [];
        editorItens.setProdutos(listaDeProdutosGlobal);
        renderizarCatalogo(listaDeProdutosGlobal);
    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
    }
}

function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
if (inputDataVenda && !inputDataVenda.value) inputDataVenda.value = hojeISO();

// ============================================
// CATÁLOGO PDV (grade com busca)
// ============================================
const gradeCatalogo = document.getElementById("gradeCatalogo");
const inputCatalogoBusca = document.getElementById("catalogoBuscaInput");
const contadorCatalogo = document.getElementById("catalogoContador");
const vazioCatalogo = document.getElementById("catalogoVazio");

function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function thumbCatalogo(produto) {
    if (produto.foto_url) {
        return `<img src="${esc(produto.foto_url)}" class="produto-catalogo-thumb" alt="${esc(produto.nome)}">`;
    }
    return `<span class="produto-catalogo-placeholder"><i data-lucide="package"></i></span>`;
}

function renderizarCatalogo(produtos) {
    if (!gradeCatalogo) return;

    const termo = normalizar(inputCatalogoBusca ? inputCatalogoBusca.value : '');
    const filtrados = termo
        ? produtos.filter(p =>
            normalizar(p.nome).includes(termo) ||
            normalizar(p.descricao || '').includes(termo)
        )
        : produtos;

    gradeCatalogo.innerHTML = filtrados.map(produto => {
        const preco = Number(produto.valor || 0);
        return `
            <div class="produto-card-catalogo" data-id="${esc(produto.id)}">
                <div class="produto-catalogo-linha">
                    ${thumbCatalogo(produto)}
                    <div class="produto-catalogo-info">
                        <h4><span class="produto-nome-texto">${esc(produto.nome)}</span></h4>
                        ${(produto.descricao || '').trim()
                ? `<p>${esc(produto.descricao)}</p>`
                : ''}
                    </div>
                </div>
                <div class="produto-catalogo-rodape">
                    <span class="produto-catalogo-preco">${formatarMoeda(preco)}</span>
                    <button type="button" class="btn-add-catalogo" data-id="${esc(produto.id)}" title="Adicionar ao carrinho">
                        <i data-lucide="plus"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    ativarMarqueeProdutos();

    if (contadorCatalogo) {
        const total = produtos.length;
        contadorCatalogo.textContent = `${filtrados.length} de ${total} produto${total !== 1 ? 's' : ''}`;
    }
    if (vazioCatalogo) vazioCatalogo.hidden = filtrados.length > 0;
}

// Clique no "+" do produto: adiciona ao carrinho e abre o drawer da direita.
if (gradeCatalogo) {
    gradeCatalogo.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-add-catalogo');
        if (!btn) return;
        const prod = listaDeProdutosGlobal.find(p => p.id === btn.dataset.id);
        if (!prod) return;

        editorItens.adicionarProduto(prod);
        abrirCarrinho();
        renderizarCarrinho();

        // Feedback visual no ícone
        const icone = btn.querySelector('i');
        if (icone) {
            icone.setAttribute('data-lucide', 'check');
            icone.classList.add('adicionado');
        }
        setTimeout(() => {
            if (icone) {
                icone.setAttribute('data-lucide', 'plus');
                icone.classList.remove('adicionado');
            }
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    ativarMarqueeProdutos();
        }, 700);
    });
}

if (inputCatalogoBusca) {
    inputCatalogoBusca.addEventListener('input', () => renderizarCatalogo(listaDeProdutosGlobal));
}

function ativarMarqueeProdutos() {
    if (!gradeCatalogo) return;
    requestAnimationFrame(() => {
        gradeCatalogo.querySelectorAll('.produto-catalogo-info h4').forEach(h4 => {
            const span = h4.querySelector('.produto-nome-texto');
            if (!span) return;
            span.classList.remove('is-marquee');
            span.style.removeProperty('--marquee-shift');
            span.style.removeProperty('--marquee-dur');
            const excesso = span.scrollWidth - h4.clientWidth;
            if (excesso > 2) {
                span.style.setProperty('--marquee-shift', `-${excesso + 6}px`);
                span.style.setProperty('--marquee-dur', `${Math.max(3.5, Math.min(9, excesso / 22 + 2.5)).toFixed(1)}s`);
                span.classList.add('is-marquee');
            }
        });
    });
}
window.addEventListener('resize', ativarMarqueeProdutos);

// ============================================
// CARRINHO (drawer que sai da direita)
// ============================================
const carrinhoEl = document.getElementById("pdvCarrinho");
const carrinhoItensEl = document.getElementById("carrinhoItens");
const carrinhoVazioEl = document.getElementById("carrinhoVazio");
const carrinhoTotalEl = document.getElementById("carrinhoTotal");
const carrinhoQtdEl = document.getElementById("carrinhoQtdItens");
const btnFecharCarrinho = document.querySelector(".btn-fechar-carrinho");
const overlayCarrinho = document.getElementById("overlayCarrinho");

// --- DESCONTO (em % ou R$ fixo) ---
let descontoTipo = 'percentual'; // 'percentual' | 'fixo'
let descontoValorDigitado = 0;

const btnToggleDesconto = document.getElementById("btnToggleDesconto");
const pdvDescontoBody = document.getElementById("pdvDescontoBody");
const pdvDescontoBox = document.getElementById("pdvDescontoBox");
const descontoPrefixo = document.getElementById("descontoPrefixo");
const descontoInput = document.getElementById("descontoValorInput");
const btnLimparDesconto = document.getElementById("btnLimparDesconto");
const badgeDescontoAtivo = document.getElementById("badgeDescontoAtivo");
const descontoResumoTexto = document.getElementById("descontoResumoTexto");
const carrinhoDescontoResumo = document.getElementById("carrinhoDescontoResumo");
const carrinhoSubtotalEl = document.getElementById("carrinhoSubtotal");
const carrinhoDescontoLabelEl = document.getElementById("carrinhoDescontoLabel");
const carrinhoDescontoValorEl = document.getElementById("carrinhoDescontoValor");

function calcularTotaisComDesconto() {
    const subtotal = editorItens.total();
    const raw = Math.max(0, Number(descontoValorDigitado) || 0);
    let descontoReais = 0;

    if (subtotal > 0 && raw > 0) {
        if (descontoTipo === 'percentual') {
            const pct = Math.min(100, raw);
            descontoReais = Math.round(subtotal * (pct / 100) * 100) / 100;
        } else {
            descontoReais = Math.min(subtotal, Math.round(raw * 100) / 100);
        }
    }

    const totalFinal = Math.max(0, Math.round((subtotal - descontoReais) * 100) / 100);
    const pctEfetivo = subtotal > 0 && descontoReais > 0
        ? Math.round((descontoReais / subtotal) * 1000) / 10
        : 0;

    return { subtotal, descontoReais, totalFinal, pctEfetivo };
}

function atualizarUIdesconto() {
    const { subtotal, descontoReais, totalFinal, pctEfetivo } = calcularTotaisComDesconto();
    const temDesconto = descontoReais > 0;

    if (btnLimparDesconto) btnLimparDesconto.hidden = !(Number(descontoValorDigitado) > 0);

    if (badgeDescontoAtivo) {
        if (temDesconto) {
            badgeDescontoAtivo.hidden = false;
            badgeDescontoAtivo.textContent = descontoTipo === 'percentual'
                ? `-${Math.min(100, Number(descontoValorDigitado))}%`
                : `-${formatarMoeda(descontoReais)}`;
        } else {
            badgeDescontoAtivo.hidden = true;
            badgeDescontoAtivo.textContent = '';
        }
    }

    if (descontoResumoTexto) {
        if (subtotal <= 0) {
            descontoResumoTexto.textContent = 'Adicione itens ao carrinho para aplicar desconto.';
        } else if (temDesconto) {
            descontoResumoTexto.innerHTML = `Subtotal: <strong>${formatarMoeda(subtotal)}</strong> • Desconto: <strong class="desconto-destaque">-${formatarMoeda(descontoReais)} (${pctEfetivo}%)</strong> • Total: <strong>${formatarMoeda(totalFinal)}</strong>`;
        } else {
            descontoResumoTexto.textContent = `Subtotal atual: ${formatarMoeda(subtotal)}`;
        }
    }

    if (carrinhoDescontoResumo) {
        carrinhoDescontoResumo.hidden = !temDesconto;
        if (temDesconto) {
            if (carrinhoSubtotalEl) carrinhoSubtotalEl.textContent = formatarMoeda(subtotal);
            if (carrinhoDescontoLabelEl) carrinhoDescontoLabelEl.textContent = `Desconto (${pctEfetivo}%)`;
            if (carrinhoDescontoValorEl) carrinhoDescontoValorEl.textContent = `- ${formatarMoeda(descontoReais)}`;
        }
    }

    if (carrinhoTotalEl) carrinhoTotalEl.textContent = formatarMoeda(totalFinal);
}

if (btnToggleDesconto && pdvDescontoBody) {
    btnToggleDesconto.addEventListener('click', () => {
        const aberto = !pdvDescontoBody.hidden;
        pdvDescontoBody.hidden = aberto;
        btnToggleDesconto.setAttribute('aria-expanded', String(!aberto));
        pdvDescontoBox?.classList.toggle('aberto', !aberto);
    });
}

document.querySelectorAll('.pdv-desconto-tipo').forEach(btn => {
    btn.addEventListener('click', () => {
        descontoTipo = btn.dataset.tipo === 'fixo' ? 'fixo' : 'percentual';
        document.querySelectorAll('.pdv-desconto-tipo').forEach(b => b.classList.toggle('active', b === btn));
        if (descontoPrefixo) descontoPrefixo.textContent = descontoTipo === 'percentual' ? '%' : 'R$';
        if (descontoInput) {
            descontoInput.max = descontoTipo === 'percentual' ? '100' : '';
            descontoInput.placeholder = descontoTipo === 'percentual' ? '0' : '0,00';
        }
        atualizarUIdesconto();
    });
});

if (descontoInput) {
    descontoInput.addEventListener('input', () => {
        descontoValorDigitado = parseFloat(descontoInput.value) || 0;
        if (descontoTipo === 'percentual' && descontoValorDigitado > 100) {
            descontoValorDigitado = 100;
            descontoInput.value = '100';
        }
        atualizarUIdesconto();
    });
}

if (btnLimparDesconto) {
    btnLimparDesconto.addEventListener('click', () => {
        descontoValorDigitado = 0;
        if (descontoInput) descontoInput.value = '';
        atualizarUIdesconto();
    });
}

function abrirCarrinho() {
    if (carrinhoEl) carrinhoEl.classList.add('aberto');
    if (overlayCarrinho) overlayCarrinho.classList.add('ativo');
}
function fecharCarrinho() {
    if (carrinhoEl) carrinhoEl.classList.remove('aberto');
    if (overlayCarrinho) overlayCarrinho.classList.remove('ativo');
}

function renderizarCarrinho() {
    const itens = editorItens.getItens();
    if (!carrinhoItensEl) return;

    if (itens.length === 0) {
        carrinhoItensEl.innerHTML = '';
        if (carrinhoVazioEl) carrinhoVazioEl.hidden = false;
        if (carrinhoTotalEl) carrinhoTotalEl.textContent = formatarMoeda(0);
        if (carrinhoQtdEl) carrinhoQtdEl.textContent = '0';
        atualizarUIdesconto();
        fecharCarrinho();
        return;
    }
    if (carrinhoVazioEl) carrinhoVazioEl.hidden = true;
    if (carrinhoQtdEl) {
        carrinhoQtdEl.textContent = String(itens.reduce((s, i) => s + (Number(i.quantidade) || 1), 0));
    }

    carrinhoItensEl.innerHTML = itens.map((it, idx) => {
        const qtd = Number(it.quantidade) || 1;
        const unit = Number(it.valor_unit) || 0;
        const sub = qtd * unit;
        return `
            <div class="carrinho-item" data-idx="${idx}">
                <div class="carrinho-item-info">
                    <div class="carrinho-item-nome">${esc(it.descricao)}</div>
                    <div class="carrinho-item-meta">${it.produto_id ? 'Produto' : 'Serviço avulso'} • ${formatarMoeda(unit)} un.</div>
                </div>
                <div class="carrinho-item-controles">
                    <button type="button" class="carrinho-qtd carrinho-qtd-menos" data-idx="${idx}" title="Remover uma unidade">−</button>
                    <span class="carrinho-item-qtd">${qtd}</span>
                    <button type="button" class="carrinho-qtd carrinho-qtd-mais" data-idx="${idx}" title="Adicionar uma unidade">+</button>
                </div>
                <div class="carrinho-item-subtotal">${formatarMoeda(sub)}</div>
                <button type="button" class="carrinho-remover" data-idx="${idx}" title="Remover item">&times;</button>
            </div>
        `;
    }).join('');

    atualizarUIdesconto();
}

if (carrinhoItensEl) {
    carrinhoItensEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const idx = Number(btn.dataset.idx);
        if (isNaN(idx)) return;
        if (btn.classList.contains('carrinho-remover')) removerItem(idx);
        else if (btn.classList.contains('carrinho-qtd-mais')) addUm(idx);
        else if (btn.classList.contains('carrinho-qtd-menos')) removerUm(idx);
    });
}

function addUm(idx) {
    const itens = editorItens.getItens();
    if (!itens[idx]) return;
    const prod = listaDeProdutosGlobal.find(p => p.id === itens[idx].produto_id);
    if (prod) editorItens.adicionarProduto(prod);
    else {
        itens[idx].quantidade++;
        editorItens.setItens(itens);
    }
    renderizarCarrinho();
}

function removerUm(idx) {
    const itens = editorItens.getItens();
    if (!itens[idx]) return;
    if (itens[idx].quantidade > 1) {
        itens[idx].quantidade--;
        editorItens.setItens(itens);
    } else {
        removerItem(idx);
    }
    renderizarCarrinho();
}

function removerItem(idx) {
    const itens = editorItens.getItens();
    itens.splice(idx, 1);
    editorItens.setItens(itens);
    renderizarCarrinho();
}

if (btnFecharCarrinho) btnFecharCarrinho.addEventListener('click', fecharCarrinho);
if (overlayCarrinho) overlayCarrinho.addEventListener('click', fecharCarrinho);

// ============================================
// FINALIZAR VENDA
// ============================================
const btnFinalizar = document.getElementById("btnFinalizarVenda");
const formNovaVenda = document.getElementById("formNovaVenda");

if (btnFinalizar) {
    btnFinalizar.addEventListener('click', async (e) => {
        e.preventDefault();
        const itens = editorItens.getItens();
        if (itens.length === 0) {
            mostrarModal('Carrinho vazio', 'Adicione ao menos um produto antes de finalizar a venda.', 'alerta');
            return;
        }
        if (!editorItens.validar()) {
            mostrarModal('Item incompleto', 'Revise os itens do carrinho.', 'alerta');
            return;
        }
        const contaId = inputConta?.value || null;
        if (!contaId) {
            mostrarModal('Conta obrigatória', 'Selecione a conta financeira onde o valor será registrado.', 'alerta');
            return;
        }
        // Reutiliza o formulário (e sua validação / salvamento já existentes)
        if (formNovaVenda) formNovaVenda.requestSubmit();
    });
}

// Salvamento (mantido do fluxo original, agora disparado pelo botão do carrinho)
if (formNovaVenda) {
    protegerAcao("formNovaVenda", "movimentacao");
    formNovaVenda.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (await protegerAcao("formNovaVenda", "movimentacao")) return;

        const btn = btnFinalizar || formNovaVenda.querySelector('button[type="submit"]') || formNovaVenda.querySelector('button');
        const itens = editorItens.getItens();
        if (itens.length === 0) {
            mostrarModal('Carrinho vazio', 'Adicione ao menos um produto antes de finalizar.', 'alerta');
            return;
        }
        if (!editorItens.validar()) {
            mostrarModal('Item incompleto', 'Todos os itens precisam de descrição e quantidade válida.', 'alerta');
            return;
        }

        const status = inputStatus?.value || 'pago';
        const clienteId = inputClienteId?.value || comboCliente.getValor() || null;
        const contaId = inputConta?.value || null;
        const dataVenda = inputDataVenda?.value || hojeISO();
        const titulo = (inputTitulo?.value || '').trim();
        const descricao = titulo || resumoDosItens(itens);
        const { totalFinal: valorNumerico } = calcularTotaisComDesconto();

        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            mostrarModal('Valor inválido', 'O total da venda deve ser maior que zero.', 'alerta');
            return;
        }
        if (!contaId) {
            mostrarModal('Conta obrigatória', 'Selecione a conta financeira.', 'alerta');
            return;
        }

        const produtoUnico = itens.length === 1 && itens[0].produto_id ? itens[0].produto_id : null;

        try {
            if (btn) { btn.disabled = true; btn.innerText = "Registrando..."; }
            const { data: { user } } = await supabase.auth.getUser();

            const { data: vendaCriada, error } = await supabase.from('vendas').insert([{
                user_id: user.id,
                cliente_id: clienteId,
                produto_id: produtoUnico,
                conta_id: contaId,
                descricao: descricao,
                valor: valorNumerico,
                status: status,
                data_venda: `${dataVenda}T12:00:00Z`
            }]).select('id').single();

            if (error) throw error;

            const { error: erroItens } = await supabase.from('venda_itens').insert(
                itens.map(it => ({
                    user_id: user.id,
                    venda_id: vendaCriada.id,
                    produto_id: it.produto_id || null,
                    descricao: it.descricao.trim(),
                    quantidade: Number(it.quantidade) || 1,
                    valor_unit: Number(it.valor_unit) || 0
                }))
            );
            if (erroItens) throw erroItens;

            const delta = calcDeltaVenda(valorNumerico, status, 'criar');
            if (delta !== 0) await atualizarSaldoConta(contaId, delta);
            invalidarCachePlano();

            if (status === 'pago' && typeof confirmModal === 'function') {
                const querComprovante = await confirmModal(
                    'Venda registrada!',
                    'Sua venda foi registrada com sucesso. Deseja gerar o comprovante de pagamento agora?',
                    {
                        icon: '🧾',
                        okText: 'Gerar comprovante',
                        cancelText: 'Agora não',
                        okClass: 'modal-confirmar-primario'
                    }
                );
                if (querComprovante) {
                    const clienteObj = clienteId
                        ? (listaDeClientesGlobal.find(c => c.id === clienteId) || null)
                        : null;
                    const contaNome = inputConta?.selectedOptions?.[0]?.textContent?.trim() || '';
                    await gerarComprovante({
                        id: vendaCriada.id,
                        descricao,
                        valor: valorNumerico,
                        status,
                        data_venda: `${dataVenda}T12:00:00Z`,
                        clientes: clienteObj ? { nome: clienteObj.nome, telefone: clienteObj.telefone || '' } : null,
                        contas: contaNome ? { nome: contaNome } : null,
                        venda_itens: itens
                    });
                }
                window.location.href = "vendas";
            } else {
                mostrarModal('Venda registrada!', 'Sua venda foi registrada com sucesso.', 'sucesso');
                setTimeout(() => { window.location.href = "vendas"; }, 1500);
            }
        } catch (err) {
            mostrarModal('Erro ao registrar venda', traduzirErro(err.message));
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = "Finalizar Venda"; }
        }
    });
}

// 4. POPULAR SELECT DE CONTAS (com busca, reutilizável)
async function popularSelectContas() {
    const select = document.getElementById("contaVenda");
    if (!select) return;

    try {
        await garantirContaPadrao();

        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('id, nome')
            .eq('user_id', user.id)
            .eq('ativo', true)
            .order('nome');

        if (error) throw error;

        const lista = contas || [];
        select.innerHTML = lista.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
        const combo = montarSelectBusca(select, {
            placeholder: 'Buscar conta...',
            autoSelecionarUnica: true
        });
        combo.setOpcoes(lista.map(c => ({ valor: c.id, texto: c.nome })));
    } catch (err) {
        console.error("Erro ao carregar contas:", err.message);
    }
}

popularSugestoesClientes();
popularSugestoesProdutos();
popularSelectContas();
