import { supabase } from './auth.js';

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
            clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

    } catch (err) {
        console.error("Erro ao carregar clientes:", err.message);
    }
}

// --- 2. SALVAR NOVA VENDA ---
import { protegerAcao, verificarStatusPlano } from './planos.js';
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
async function carregarVendas() {
    const container = document.getElementById("listaVendas");
    const filtroMesInput = document.getElementById("filtroMesVendas"); 
    
    if (!container) return;

    try {
        let query = supabase
            .from('vendas')
            .select(`*, clientes ( nome )`)
            .order('created_at', { ascending: false });

        if (filtroMesInput && filtroMesInput.value) {
            const [ano, mes] = filtroMesInput.value.split('-');
            const primeiroDia = `${ano}-${mes}-01T00:00:00Z`;
            const ultimoDia = new Date(ano, mes, 0).toISOString().replace(/T.*$/, 'T23:59:59Z');
            query = query.gte('created_at', primeiroDia).lte('created_at', ultimoDia);
        }

        const { data: vendas, error } = await query;
        if (error) throw error;

        if (vendas.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhuma venda encontrada para este período.</p>`;
            return;
        }

        container.innerHTML = vendas.map(venda => `
            <div class="card-venda-premium ${venda.status}">
                <div class="venda-frente">
                    <div class="venda-icone">
                        <i data-lucide="${venda.status === 'pago' ? 'check-circle' : 'clock'}"></i>
                    </div>
                    <div class="venda-detalhes">
                        <h4>${venda.clientes?.nome || 'Cliente avulso'}</h4>
                        <p>${venda.descricao || 'Serviço Geral'}</p>
                        <span class="venda-data">${new Date(venda.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
                <div class="venda-financeiro">
                    <span class="venda-valor">R$ ${parseFloat(venda.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                    <span class="venda-badge">${venda.status.toUpperCase()}</span>
                    
                    <div style="display:flex; gap:8px; justify-content: flex-end; margin-top:10px;">
                        <button onclick="abrirModalEditarVenda('${venda.id}', '${venda.descricao}', ${venda.valor}, '${venda.status}')" class="btn-acao" style="color: var(--cor-primaria);" title="Editar">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button onclick="deletarVenda('${venda.id}')" class="btn-acao btn-delete" title="Excluir">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

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
    if (!confirm("Deseja realmente excluir esta venda?")) return;
    try {
        const { error } = await supabase.from('vendas').delete().eq('id', id);
        if (error) throw error;
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
    const filtroMesVendas = document.getElementById("filtroMesVendas");

    if (filtroMesVendas) {
        if (!filtroMesVendas.value) {
            const agora = new Date();
            filtroMesVendas.value = agora.toISOString().substring(0, 7);
        }
        filtroMesVendas.addEventListener("change", carregarVendas);
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
                    .gte('created_at', dataInicio)
                    .lte('created_at', dataFim)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                if (!vendas || vendas.length === 0) {
                    mostrarModal('Nenhuma venda', 'Nenhuma venda encontrada para exportar neste mês.', 'alerta');
                    return;
                }

                // Gerar CSV
                let csv = "Data;Cliente;Servico;Valor;Status\n";
                vendas.forEach(v => {
                    const dataFmt = new Date(v.created_at).toLocaleDateString('pt-BR');
                    const cliente = v.clientes ? v.clientes.nome : 'N/A';
                    const valor = v.valor.toFixed(2).replace('.', ',');
                    csv += `${dataFmt};${cliente};${v.servico};${valor};${v.status}\n`;
                });

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