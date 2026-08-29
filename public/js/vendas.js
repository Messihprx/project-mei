import { supabase } from './auth.js';
import { esc, delegate, montarCsv, TAMANHO_PAGINA, botaoCarregarMais } from './dom-utils.js';

// Vendas da última renderização. Antes a descrição era injetada
// dentro de onclick="...('${venda.descricao}')", então uma venda
// como "Pao d'alho" quebrava o botão de editar.
let vendasRenderizadas = [];

// --- 1. CARREGAR CLIENTES NO SELECT ---
async function popularSelectClientes() {
    const select = document.getElementById("clienteVenda");
    if (!select) return;

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('id, nome')
            .order('nome');

        if (error) throw error;

        select.innerHTML = '<option value="">Selecione um cliente</option>' + 
            clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');

    } catch (err) {
        console.error("Erro ao carregar clientes:", err.message);
    }
}

// --- 2. SALVAR NOVA VENDA ---
import { protegerAcao, verificarStatusPlano, invalidarCachePlano } from './planos.js';
const formNovaVenda = document.getElementById("formNovaVenda");
if (formNovaVenda) {
    protegerAcao("formNovaVenda", "movimentacao");
    formNovaVenda.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        if (await protegerAcao("formNovaVenda", "movimentacao")) return;

        const btn = formNovaVenda.querySelector('button');
        
        const clienteId = document.getElementById("clienteVenda").value;
        const descricao = document.getElementById("servicoVenda").value.trim();
        const valor = document.getElementById("valorVenda").value;
        const status = document.getElementById("statusVenda").value;

        try {
            btn.disabled = true;
            btn.innerText = "Registrando...";

            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase.from('vendas').insert([
                {
                    user_id: user.id,
                    cliente_id: clienteId,
                    descricao: descricao,
                    valor: parseFloat(valor),
                    status: status
                }
            ]);

            if (error) throw error;
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

// --- 3. FUNÇÃO MESTRE PARA LISTAR VENDAS (COM FILTRO REAL) ---
let limiteVendas = TAMANHO_PAGINA;

async function carregarVendas(limite = limiteVendas) {
    limiteVendas = limite;
    const container = document.getElementById("listaVendas");
    const filtroMesInput = document.getElementById("filtroMesVendas"); 
    
    if (!container) return;

    try {
        let query = supabase
            .from('vendas')
            .select('id, descricao, valor, status, data_venda, cliente_id, clientes(nome)')
            // data_venda é a data de negócio (o dashboard usa a mesma).
            // Antes esta lista ordenava e filtrava por created_at, então
            // uma venda retroativa aparecia num mês aqui e noutro lá.
            .order('data_venda', { ascending: false })
            .limit(limite);

        if (filtroMesInput && filtroMesInput.value) {
            const [ano, mes] = filtroMesInput.value.split('-');
            const primeiroDia = `${ano}-${mes}-01T00:00:00Z`;
            const ultimoDia = new Date(ano, mes, 0).toISOString().replace(/T.*$/, 'T23:59:59Z');
            query = query.gte('data_venda', primeiroDia).lte('data_venda', ultimoDia);
        }

        const { data: vendas, error } = await query;
        if (error) throw error;

        if (vendas.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhuma venda encontrada para este período.</p>`;
            return;
        }

        vendasRenderizadas = vendas;

        container.innerHTML = vendas.map(venda => `
            <div class="card-venda-premium ${esc(venda.status)}">
                <div class="venda-frente">
                    <div class="venda-icone">
                        <i data-lucide="${venda.status === 'pago' ? 'check-circle' : 'clock'}"></i>
                    </div>
                    <div class="venda-detalhes">
                        <h4>${esc(venda.clientes?.nome || 'Cliente avulso')}</h4>
                        <p>${esc(venda.descricao || 'Serviço Geral')}</p>
                        <span class="venda-data">${new Date(venda.data_venda || venda.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
                <div class="venda-financeiro">
                    <span class="venda-valor">R$ ${parseFloat(venda.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                    <span class="venda-badge">${esc((venda.status || "").toUpperCase())}</span>
                    
                    <div style="display:flex; gap:8px; justify-content: flex-end; margin-top:10px;">
                        <button data-acao="editar" data-id="${esc(venda.id)}" class="btn-acao" style="color: var(--cor-primaria);" title="Editar">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button data-acao="excluir" data-id="${esc(venda.id)}" class="btn-acao btn-delete" title="Excluir">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        botaoCarregarMais(container, vendas.length, limite, carregarVendas);

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar vendas:", err.message);
        container.innerHTML = `<p style="color:red">Erro ao carregar dados.</p>`;
    }
}

// --- 4. FUNÇÕES DE EDIÇÃO E EXCLUSÃO (WINDOW) ---
window.abrirModalEditarVenda = (id, servico, valor, status) => {
    document.getElementById("editVendaId").value = id;
    document.getElementById("editServicoVenda").value = servico;
    document.getElementById("editValorVenda").value = valor;
    document.getElementById("editStatusVenda").value = status;
    document.getElementById("modalEditarVenda").style.display = "flex";
    if (window.lucide) lucide.createIcons();
};

window.fecharModalEditarVenda = () => {
    document.getElementById("modalEditarVenda").style.display = "none";
};

window.deletarVenda = async (id) => {
    const confirmed = await confirmModal("Excluir venda", "Tem certeza que deseja excluir esta venda? Essa ação não pode ser desfeita.");
    if (!confirmed) return;
    try {
        const { error } = await supabase.from('vendas').delete().eq('id', id);
        if (error) throw error;
        // A contagem mudou: o aviso de limite não pode continuar
        // mostrando o número anterior a esta operação.
        invalidarCachePlano();
        carregarVendas();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

// --- 5. SUBMIT DA EDIÇÃO ---
const formEditarVenda = document.getElementById("formEditarVenda");
if (formEditarVenda) {
    protegerAcao("formEditarVenda", "movimentacao");
    formEditarVenda.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        if (await protegerAcao("formEditarVenda", "movimentacao")) return;

        const id = document.getElementById("editVendaId").value;
        const btn = formEditarVenda.querySelector('button');

        const dadosAtualizados = {
            descricao: document.getElementById("editServicoVenda").value,
            valor: parseFloat(document.getElementById("editValorVenda").value),
            status: document.getElementById("editStatusVenda").value
        };

        try {
            btn.disabled = true;
            btn.innerText = "Atualizando...";

            const { error } = await supabase
                .from('vendas')
                .update(dadosAtualizados)
                .eq('id', id);

            if (error) throw error;
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            fecharModalEditarVenda();
            carregarVendas();
        } catch (err) {
            mostrarModal('Erro ao atualizar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Salvar Alterações";
        }
    });
}


// --- 6. INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", () => {
    // Delegação no lugar dos onclick inline
    delegate(document.getElementById('listaVendas'), 'button[data-acao]', 'click', (e, botao) => {
        const venda = vendasRenderizadas.find(v => v.id === botao.dataset.id);
        if (!venda) return;
        if (botao.dataset.acao === 'editar') {
            window.abrirModalEditarVenda(venda.id, venda.descricao, venda.valor, venda.status);
        } else if (botao.dataset.acao === 'excluir') {
            window.deletarVenda(venda.id);
        }
    });

    const filtroMesVendas = document.getElementById("filtroMesVendas");

    if (filtroMesVendas) {
        if (!filtroMesVendas.value) {
            const agora = new Date();
            filtroMesVendas.value = agora.toISOString().substring(0, 7);
        }
        filtroMesVendas.addEventListener("change", () => carregarVendas(TAMANHO_PAGINA));
    }

    const inputBusca = document.getElementById("buscarVenda");
    if (inputBusca) {
        inputBusca.addEventListener("input", (e) => {
            const termo = e.target.value.toLowerCase().trim();
            const itens = document.querySelectorAll(".card-venda-premium");
            itens.forEach(item => {
                const texto = item.innerText.toLowerCase();
                item.style.display = texto.includes(termo) ? "flex" : "none";
            });
        });
    }

    carregarVendas();
    popularSelectClientes();

    // --- 7. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarVendas");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                mostrarModal('Recurso Premium', 'A exportação de relatórios detalhados é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos.html"; }, 2000);
                return;
            }

            const mesSel = document.getElementById("filtroMesVendas").value;
            const [ano, mes] = mesSel.split('-');
            const ultimoDia = new Date(ano, mes, 0).getDate();
            const dataInicio = `${ano}-${mes}-01T00:00:00`;
            const dataFim = `${ano}-${mes}-${ultimoDia}T23:59:59`;

            btnExport.disabled = true;
            btnExport.innerText = "Exportando...";

            try {
                const { data: vendas, error } = await supabase
                    .from('vendas')
                    .select('*, clientes(nome)')
                    .gte('data_venda', dataInicio)
                    .lte('data_venda', dataFim)
                    .order('data_venda', { ascending: false });

                if (error) throw error;

                if (!vendas || vendas.length === 0) {
                    mostrarModal('Nenhuma venda', 'Nenhuma venda encontrada para exportar neste mês.', 'alerta');
                    return;
                }

                // Gerar CSV. Duas correções aqui:
                //  - a coluna era v.servico, que não existe na tabela
                //    (o campo é descricao) e saía "undefined" no arquivo;
                //  - montarCsv neutraliza células que o Excel leria como
                //    fórmula (= + - @).
                const csv = montarCsv(
                    ["Data", "Cliente", "Servico", "Valor", "Status"],
                    vendas.map(v => [
                        new Date(v.data_venda || v.created_at).toLocaleDateString('pt-BR'),
                        v.clientes ? v.clientes.nome : 'N/A',
                        v.descricao || '',
                        Number(v.valor || 0).toFixed(2).replace('.', ','),
                        v.status || ''
                    ])
                );

                const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Vendas_${mesSel}.csv`;
                link.click();
                URL.revokeObjectURL(link.href);

            } catch (err) {
                console.error("Erro ao exportar:", err.message);
                mostrarModal('Erro ao exportar', 'Não foi possível exportar os dados. Tente novamente.');
            } finally {
                btnExport.disabled = false;
                btnExport.innerHTML = '<i data-lucide="download" style="width: 16px;"></i> Exportar CSV';
                if (window.lucide) lucide.createIcons();
            }
        });
    }
});