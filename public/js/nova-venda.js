import { supabase } from './auth.js';
import { esc } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirContaPadrao } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';
import { criarEditorItens, resumoDosItens } from './itens-venda.js';

let listaDeClientesGlobal = [];
let listaDeProdutosGlobal = [];

const inputClienteId = document.getElementById("clienteIdSelecionado");
const inputTitulo = document.getElementById("servicoVenda");

// 1. CLIENTE — select com busca (só vincula se escolher na lista)
const comboCliente = montarSelectBusca(document.getElementById("clienteVendaInput"), {
    placeholder: 'Buscar cliente...',
    opcaoVazia: { valor: '', texto: 'Sem cliente (avulso)' },
    permiteLivre: false,
    aoSelecionar: (valor) => {
        if (inputClienteId) inputClienteId.value = valor || '';
    }
});

// 2. ITENS DA VENDA — construtor compartilhado (produtos + avulsos)
const editorItens = criarEditorItens({
    listaEl: document.getElementById("listaItensVenda"),
    totalEl: document.getElementById("totalItensVenda"),
    inputBusca: document.getElementById("itemProdutoInput"),
    btnAddProduto: document.getElementById("btnAddProduto"),
    btnAddAvulso: document.getElementById("btnAddAvulso")
});

async function popularSugestoesClientes() {
    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        listaDeClientesGlobal = clientes || [];
        comboCliente.setOpcoes(listaDeClientesGlobal.map(c => ({
            valor: c.id,
            texto: c.nome
        })));
    } catch (err) {
        console.error("Erro ao carregar sugestões:", err.message);
    }
}

async function popularSugestoesProdutos() {
    try {
        const { data: produtos, error } = await supabase
            .from('produtos')
            .select('id, nome, valor, descricao')
            .order('nome', { ascending: true });

        if (error) throw error;

        listaDeProdutosGlobal = produtos || [];
        editorItens.setProdutos(listaDeProdutosGlobal);
    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
    }
}

// Data da venda: usa a data local de quem registra (new Date() aqui
// só serve para calcular; nunca via toISOString(), que mudaria o dia
// depois das 21h no horário de Brasília).
function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inputDataVenda = document.getElementById("dataVenda");
if (inputDataVenda && !inputDataVenda.value) {
    inputDataVenda.value = hojeISO();
}

// 3. SALVAR VENDA
const formNovaVenda = document.getElementById("formNovaVenda");
import { protegerAcao, invalidarCachePlano } from './planos.js';

if (formNovaVenda) {
    protegerAcao("formNovaVenda", "movimentacao");

    formNovaVenda.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (await protegerAcao("formNovaVenda", "movimentacao")) return;

        const btn = formNovaVenda.querySelector('button[type="submit"]') || formNovaVenda.querySelector('button');
        const itens = editorItens.getItens();

        if (itens.length === 0) {
            mostrarModal('Adicione ao menos um item', 'Busque um produto ou use "+ Serviço avulso" para montar a venda.', 'alerta');
            return;
        }
        if (!editorItens.validar()) {
            mostrarModal('Item incompleto', 'Todos os itens precisam de descrição e quantidade válida.', 'alerta');
            return;
        }

        const status = document.getElementById("statusVenda").value;
        const clienteId = inputClienteId?.value || comboCliente.getValor() || null;
        const contaId = document.getElementById("contaVenda")?.value || null;
        const dataVenda = inputDataVenda?.value || hojeISO();
        const titulo = (inputTitulo?.value || '').trim();
        const descricao = titulo || resumoDosItens(itens);
        const valorNumerico = editorItens.total();

        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            mostrarModal('Valor inválido', 'O total da venda deve ser maior que zero.', 'alerta');
            return;
        }

        if (!contaId) {
            mostrarModal('Conta obrigatória', 'Selecione a conta financeira onde o valor desta venda será registrado.', 'alerta');
            return;
        }

        // Produto único → mantém vendas.produto_id preenchido (compat legada/donut)
        const produtoUnico = itens.length === 1 && itens[0].produto_id ? itens[0].produto_id : null;

        try {
            btn.disabled = true;
            btn.innerText = "Registrando...";

            const { data: { user } } = await supabase.auth.getUser();

            const { data: vendaCriada, error } = await supabase.from('vendas').insert([
                {
                    user_id: user.id,
                    cliente_id: clienteId,
                    produto_id: produtoUnico,
                    conta_id: contaId,
                    descricao: descricao,
                    valor: valorNumerico,
                    status: status,
                    // Meio-dia UTC: grava o dia escolhido sem o fuso do
                    // Brasil rebaixar para o dia anterior na exibição.
                    data_venda: `${dataVenda}T12:00:00Z`
                }
            ]).select('id').single();

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

            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            mostrarModal('Venda registrada!', 'Sua venda foi registrada com sucesso.', 'sucesso');
            setTimeout(() => { window.location.href = "vendas.html"; }, 1500);

        } catch (err) {
            mostrarModal('Erro ao registrar venda', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Finalizar Registro";
        }
    });
}

popularSugestoesClientes();
popularSugestoesProdutos();

// 4. POPULAR SELECT DE CONTAS (com busca, reutilizável)
async function popularSelectContas() {
    const select = document.getElementById("contaVenda");
    if (!select) return;

    try {
        // Sem nenhuma conta ativa, cria o "Caixa do Negócio" antes de listar
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

popularSelectContas();
