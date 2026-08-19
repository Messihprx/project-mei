import { supabase } from './auth.js';
import { verificarStatusPlano } from './planos.js';

const filtroMes = document.getElementById("filtroMesGastos");
const formGasto = document.getElementById("formNovoGasto");

document.addEventListener("DOMContentLoaded", () => {
    if (filtroMes) {
        if (!filtroMes.value) {
            const hoje = new Date();
            filtroMes.value = hoje.toISOString().substring(0, 7);
        }
        filtroMes.addEventListener("change", carregarGastos);
    }

    if (formGasto) {
        formGasto.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = formGasto.querySelector('button');

            // --- NOVO: Validação de Valor Positivo ---
            const valorInput = document.getElementById("valorGasto");
            const valorGasto = parseFloat(valorInput.value);

            if (isNaN(valorGasto) || valorGasto <= 0) {
                alert("Por favor, insira um valor maior que zero. Para gastos, o sistema já registra como saída automaticamente.");
                return;
            }

            try {
                btn.disabled = true;
                const { data: { user } } = await supabase.auth.getUser();
                const dados = {
                    descricao: document.getElementById("descGasto").value,
                    valor: valorGasto,
                    data: document.getElementById("dataGasto").value,
                    categoria: document.getElementById("catGasto").value,
                    user_id: user.id
                };
                const { error } = await supabase.from('despesas').insert([dados]);
                if (error) throw error;
                fecharModalGasto();
                carregarGastos();
            } catch (err) {
                alert("Erro ao salvar: " + err.message);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // --- 5. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarGastos");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                alert("🔒 Função Premium: A exportação de relatórios de despesas é um recurso exclusivo para assinantes Premium.");
                window.location.href = "planos.html";
                return;
            }

            const mesSel = document.getElementById("filtroMesGastos").value;
            const [ano, mes] = mesSel.split('-');
            const ultimoDia = new Date(ano, mes, 0).getDate();
            const dataInicio = `${ano}-${mes}-01`;
            const dataFim = `${ano}-${mes}-${ultimoDia}`;

            btnExport.disabled = true;
            btnExport.innerText = "Exportando...";

            try {
                const { data: gastos, error } = await supabase
                    .from('despesas')
                    .select('*')
                    .gte('data', dataInicio)
                    .lte('data', dataFim)
                    .order('data', { ascending: false });

                if (error) throw error;

                if (!gastos || gastos.length === 0) {
                    alert("Nenhum gasto encontrado para exportar neste mês.");
                    return;
                }

                // Gerar CSV
                let csv = "Data;Descricao;Categoria;Valor\n";
                gastos.forEach(g => {
                    const dataFmt = new Date(g.data + 'T12:00:00').toLocaleDateString('pt-BR');
                    const valor = parseFloat(g.valor).toFixed(2).replace('.', ',');
                    csv += `${dataFmt};${g.descricao};${g.categoria};${valor}\n`;
                });

                const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Gastos_FinMEI_${mesSel}.csv`;
                link.click();
                URL.revokeObjectURL(link.href);

            } catch (err) {
                console.error("Erro ao exportar:", err.message);
                alert("Erro ao exportar dados.");
            } finally {
                btnExport.disabled = false;
                btnExport.innerHTML = '<i data-lucide="download" style="width: 16px;"></i> Exportar CSV';
                if (window.lucide) lucide.createIcons();
            }
        });
    }
});

// Tornar globais para os botões inline
window.abrirModalGasto = function() {
    const modal = document.getElementById("modalGasto");
    if (modal) {
        modal.style.display = 'flex';
        // Reset do form
        formGasto.reset();
        document.getElementById("dataGasto").value = new Date().toISOString().substring(0, 10);
        lucide.createIcons();
    }
};

window.fecharModalGasto = function() {
    document.getElementById("modalGasto").style.display = 'none';
};

// ... Resto das funções carregarGastos, fecharModalEditarGasto, etc. (mantendo a lógica existente)
async function carregarGastos() {
    const mesSel = filtroMes.value;
    if (!mesSel) return;

    const [ano, mes] = mesSel.split('-');
    const ultimoDia = new Date(ano, mes, 0).getDate();

    try {
        const { data: gastos, error } = await supabase
            .from('despesas')
            .select('*')
            .gte('data', `${ano}-${mes}-01`)
            .lte('data', `${ano}-${mes}-${ultimoDia}`)
            .order('data', { ascending: false });

        if (error) throw error;

        const lista = document.getElementById("listaGastos");
        let total = 0;
        
        if (!gastos || gastos.length === 0) {
            lista.innerHTML = '<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhum gasto registrado neste mês.</p>';
            document.getElementById("totalGastoMes").textContent = "R$ 0,00";
            return;
        }

        lista.innerHTML = gastos.map(g => {
            total += parseFloat(g.valor);
            return `
                <div class="card card-venda-premium" style="margin-bottom: 0.8rem; border-left: 4px solid var(--cor-erro);">
                    <div style="flex: 1;">
                        <h4 style="margin: 0;">${g.descricao}</h4>
                        <small style="color: var(--texto-secundario);">${g.categoria} • ${new Date(g.data + 'T12:00:00').toLocaleDateString('pt-BR')}</small>
                    </div>
                    <div style="text-align: right;">
                        <div style="color: var(--cor-erro); font-weight: 700; margin-bottom: 8px;">- R$ ${parseFloat(g.valor).toFixed(2)}</div>
                        <div style="display: flex; gap: 8px; justify-content: flex-end;">
                            <button onclick="abrirEditarGasto('${g.id}')" style="background:none; border:none; color:var(--cor-primaria); cursor:pointer;"><i data-lucide="edit-2" style="width: 16px;"></i></button>
                            <button onclick="deletarGasto('${g.id}')" style="background:none; border:none; color:var(--cor-erro); cursor:pointer;"><i data-lucide="trash-2" style="width: 16px;"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById("totalGastoMes").textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar gastos:", err);
    }
}

window.abrirEditarGasto = async function(id) {
    try {
        const { data, error } = await supabase.from('despesas').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById("editGastoId").value = data.id;
        document.getElementById("editDescGasto").value = data.descricao;
        document.getElementById("editValorGasto").value = data.valor;
        document.getElementById("editDataGasto").value = data.data;
        document.getElementById("editCatGasto").value = data.categoria;

        document.getElementById("modalEditarGasto").style.display = 'flex';
        lucide.createIcons();
    } catch (err) {
        alert("Erro ao buscar dados: " + err.message);
    }
};

window.fecharModalEditarGasto = function() {
    document.getElementById("modalEditarGasto").style.display = 'none';
};

window.deletarGasto = async function(id) {
    if (!confirm("Tem certeza que deseja excluir este gasto?")) return;
    try {
        const { error } = await supabase.from('despesas').delete().eq('id', id);
        if (error) throw error;
        carregarGastos();
    } catch (err) {
        alert("Erro ao excluir: " + err.message);
    }
};

const formEditarGasto = document.getElementById("formEditarGasto");
if (formEditarGasto) {
    formEditarGasto.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("editGastoId").value;
        const btn = formEditarGasto.querySelector('button');
        
        try {
            btn.disabled = true;
            const dados = {
                descricao: document.getElementById("editDescGasto").value,
                valor: parseFloat(document.getElementById("editValorGasto").value),
                data: document.getElementById("editDataGasto").value,
                categoria: document.getElementById("editCatGasto").value
            };
            const { error } = await supabase.from('despesas').update(dados).eq('id', id);
            if (error) throw error;
            fecharModalEditarGasto();
            carregarGastos();
        } catch (err) {
            alert("Erro ao salvar: " + err.message);
        } finally { btn.disabled = false; }
    });
}

// Inicializa a lista
carregarGastos();
