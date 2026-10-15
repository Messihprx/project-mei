import { supabase } from './auth.js';
import { esc } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirContaPadrao } from './conta-saldo.js';

let listaDeClientesGlobal = [];
let listaDeProdutosGlobal = [];

// 1. SUGESTÕES DE CLIENTES
async function popularSugestoesClientes() {
    const datalist = document.getElementById("listaClientesSugestoes");
    if (!datalist) return;

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        listaDeClientesGlobal = clientes;
        datalist.innerHTML = clientes.map(c => `<option value="${esc(c.nome)}"></option>`).join('');
    } catch (err) {
        console.error("Erro ao carregar sugestões:", err.message);
    }
}

// 2. SUGESTÕES DE PRODUTOS
async function popularSugestoesProdutos() {
    const datalist = document.getElementById("listaProdutosSugestoes");
    if (!datalist) return;

    try {
        const { data: produtos, error } = await supabase
            .from('produtos')
            .select('id, nome, valor, descricao')
            .order('nome', { ascending: true });

        if (error) throw error;

        listaDeProdutosGlobal = produtos;
        datalist.innerHTML = produtos.map(p =>
            `<option value="${p.nome}" data-id="${p.id}" data-valor="${p.valor}" data-desc="${p.descricao || ''}"></option>`
        ).join('');
    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
    }
}

// 3. AUTO-PREENCHIMENTO AO SELECIONAR PRODUTO
const inputProduto = document.getElementById("produtoVendaInput");
const inputProdutoId = document.getElementById("produtoIdSelecionado");
const inputServico = document.getElementById("servicoVenda");
const inputValor = document.getElementById("valorVenda");

if (inputProduto) {
    inputProduto.addEventListener("input", () => {
        const nomeDigitado = inputProduto.value.trim();
        const produto = listaDeProdutosGlobal.find(p => p.nome === nomeDigitado);

        if (produto) {
            inputProdutoId.value = produto.id;
            inputServico.value = produto.nome;
            inputValor.value = parseFloat(produto.valor).toFixed(2);
        } else {
            inputProdutoId.value = '';
        }
    });

    // Limpar ID se o usuário apagar o campo
    inputProduto.addEventListener("blur", () => {
        const nomeDigitado = inputProduto.value.trim();
        if (!nomeDigitado) {
            inputProdutoId.value = '';
        }
    });
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

// 4. SALVAR VENDA
const formNovaVenda = document.getElementById("formNovaVenda");
import { protegerAcao, invalidarCachePlano } from './planos.js';

if (formNovaVenda) {
    protegerAcao("formNovaVenda", "movimentacao");

    formNovaVenda.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (await protegerAcao("formNovaVenda", "movimentacao")) return;

        const btn = formNovaVenda.querySelector('button');

        const nomeDigitado = document.getElementById("clienteVendaInput").value;
        const descricao = document.getElementById("servicoVenda").value.trim();
        const valor = inputValor.value;
        const status = document.getElementById("statusVenda").value;
        const produtoId = inputProdutoId.value || null;
        const contaId = document.getElementById("contaVenda")?.value || null;
        const dataVenda = inputDataVenda?.value || hojeISO();

        const valorNumerico = parseFloat(valor);

        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            mostrarModal('Valor inválido', 'Por favor, insira um valor de venda válido e maior que zero.', 'alerta');
            return;
        }

        if (!contaId) {
            mostrarModal('Conta obrigatória', 'Selecione a conta financeira onde o valor desta venda será registrado.', 'alerta');
            return;
        }

        let clienteId = null;
        if (nomeDigitado && nomeDigitado.trim()) {
            const clienteEncontrado = listaDeClientesGlobal.find(c => c.nome === nomeDigitado);
            if (clienteEncontrado) {
                clienteId = clienteEncontrado.id;
            }
        }

        try {
            btn.disabled = true;
            btn.innerText = "Registrando...";

            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase.from('vendas').insert([
                {
                    user_id: user.id,
                    cliente_id: clienteId,
                    produto_id: produtoId,
                    conta_id: contaId,
                    descricao: descricao,
                    valor: valorNumerico,
                    status: status,
                    // Meio-dia UTC: grava o dia escolhido sem o fuso do
                    // Brasil rebaixar para o dia anterior na exibição.
                    data_venda: `${dataVenda}T12:00:00Z`
                }
            ]);

            if (error) throw error;

            if (contaId) {
                const delta = calcDeltaVenda(valorNumerico, status, 'criar');
                if (delta !== 0) await atualizarSaldoConta(contaId, delta);
            }
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

// 5. POPULAR SELECT DE CONTAS
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
        select.innerHTML = '<option value="" disabled selected>Selecione a conta</option>' +
            lista.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');

        // Com uma conta só, já deixa selecionada — venda rápida sem clique extra
        if (lista.length === 1) select.value = lista[0].id;
    } catch (err) {
        console.error("Erro ao carregar contas:", err.message);
    }
}

popularSelectContas();
