import { supabase } from './auth.js';

// Variável global para armazenar os clientes e facilitar a busca do ID pelo nome
let listaDeClientesGlobal = [];

// 1. FUNÇÃO PARA POPULAR O DATALIST COM SUGESTÕES
async function popularSugestoesClientes() {
    const datalist = document.getElementById("listaClientesSugestoes");
    if (!datalist) return;

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        listaDeClientesGlobal = clientes; // Salva na variável global

        // Preenche o datalist com as opções de nomes
        datalist.innerHTML = clientes.map(c => `<option value="${c.nome}"></option>`).join('');

    } catch (err) {
        console.error("Erro ao carregar sugestões:", err.message);
    }
}

// 2. FUNÇÃO PARA SALVAR A VENDA
const formNovaVenda = document.getElementById("formNovaVenda");
import { protegerAcao } from './planos.js';

if (formNovaVenda) {
    // Proteger formulário na renderização
    protegerAcao("formNovaVenda", "movimentacao");

    formNovaVenda.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        // Verificação extra antes do processo
        if(await protegerAcao("formNovaVenda", "movimentacao")) return;

        const btn = formNovaVenda.querySelector('button');
        
        // Pega os elementos do DOM
        const inputValor = document.getElementById("valorVenda");
        const nomeDigitado = document.getElementById("clienteVendaInput").value;
        const descricao = document.getElementById("servicoVenda").value.trim();
        const valor = inputValor.value;
        const status = document.getElementById("statusVenda").value;

        // --- CORREÇÃO DO TRATAMENTO DE ERRO ---
        const valorNumerico = parseFloat(valor); // Aqui estava o erro (valorInput não existia)

        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            alert("Por favor, insira um valor de venda válido e maior que zero.");
            return; 
        }
        // ------------------------------------------

        // Tenta encontrar o ID correspondente ao nome digitado
        const clienteEncontrado = listaDeClientesGlobal.find(c => c.nome === nomeDigitado);

        if (!clienteEncontrado) {
            alert("Por favor, selecione um cliente válido da lista de sugestões.");
            return;
        }

        try {
            btn.disabled = true;
            btn.innerText = "Registrando...";

            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase.from('vendas').insert([
                {
                    user_id: user.id,
                    cliente_id: clienteEncontrado.id, 
                    descricao: descricao,
                    valor: valorNumerico,
                    status: status
                }
            ]);

            if (error) throw error;

            alert("✅ Venda registrada com sucesso!");
            window.location.href = "vendas.html";

        } catch (err) {
            alert("Erro ao registrar venda: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Finalizar Registro";
        }
    });
}

// Inicializa as sugestões ao carregar a página
popularSugestoesClientes();