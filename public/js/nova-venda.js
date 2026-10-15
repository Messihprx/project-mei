import { supabase } from './auth.js';
import { esc } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirContaPadrao } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';

let listaDeClientesGlobal = [];
let listaDeProdutosGlobal = [];

const inputServico = document.getElementById("servicoVenda");
const inputValor = document.getElementById("valorVenda");
const inputProdutoId = document.getElementById("produtoIdSelecionado");
const inputClienteId = document.getElementById("clienteIdSelecionado");

// 1. CLIENTE — select com busca (só vincula se escolher na lista)
const comboCliente = montarSelectBusca(document.getElementById("clienteVendaInput"), {
    placeholder: 'Buscar cliente...',
    opcaoVazia: { valor: '', texto: 'Sem cliente (avulso)' },
    permiteLivre: false,
    aoSelecionar: (valor) => {
        if (inputClienteId) inputClienteId.value = valor || '';
    }
});

// 2. PRODUTO — select com busca; texto livre = produto avulso
const comboProduto = montarSelectBusca(document.getElementById("produtoVendaInput"), {
    placeholder: 'Buscar produto ou digitar nome...',
    permiteLivre: true,
    aoSelecionar: (valor, item) => {
        if (inputProdutoId) inputProdutoId.value = valor || '';
        if (item?.meta) {
            if (inputServico) inputServico.value = item.meta.nome || '';
            if (inputValor && item.meta.valor != null) {
                inputValor.value = parseFloat(item.meta.valor).toFixed(2);
            }
        }
    },
    aoDigitar: () => {
        if (inputProdutoId) inputProdutoId.value = '';
    }
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
        comboProduto.setOpcoes(listaDeProdutosGlobal.map(p => ({
            valor: p.id,
            texto: p.nome,
            meta: { nome: p.nome, valor: p.valor }
        })));
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

        const btn = formNovaVenda.querySelector('button');

        const descricao = inputServico.value.trim();
        const valor = inputValor.value;
        const status = document.getElementById("statusVenda").value;
        const produtoId = inputProdutoId.value || null;
        const clienteId = inputClienteId?.value || comboCliente.getValor() || null;
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
