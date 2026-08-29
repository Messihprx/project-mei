import { supabase } from './auth.js';
import { verificarStatusPlano, invalidarCachePlano } from './planos.js';
import { esc, delegate, montarCsv, TAMANHO_PAGINA, botaoCarregarMais } from './dom-utils.js';

let gastosRenderizados = [];

const filtroMes = document.getElementById("filtroMesGastos");
const formGasto = document.getElementById("formNovoGasto");

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }

    // Delegação no lugar dos onclick inline
    delegate(document.getElementById('listaGastos'), 'button[data-acao]', 'click', (e, botao) => {
        const gasto = gastosRenderizados.find(g => g.id === botao.dataset.id);
        if (!gasto) return;
        if (botao.dataset.acao === 'editar') {
            window.abrirEditarGasto(gasto.id);
        } else if (botao.dataset.acao === 'excluir') {
            window.deletarGasto(gasto.id);
        }
    });

    if (filtroMes) {
        if (!filtroMes.value) {
            const hoje = new Date();
            filtroMes.value = hoje.toISOString().substring(0, 7);
        }
        filtroMes.addEventListener("change", () => carregarGastos(TAMANHO_PAGINA));
    }

    carregarGastos();

    if (formGasto) {
        formGasto.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = formGasto.querySelector('button');

            // --- NOVO: Validação de Valor Positivo ---
            const valorInput = document.getElementById("valorGasto");
            const valorGasto = parseFloat(valorInput.value);

            if (isNaN(valorGasto) || valorGasto <= 0) {
                mostrarModal('Valor inválido', 'Por favor, insira um valor maior que zero. Para gastos, o sistema já registra como saída automaticamente.', 'alerta');
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
                // A contagem mudou: o aviso de limite não pode continuar
                // mostrando o número anterior a esta operação.
                invalidarCachePlano();
                fecharModalGasto();
                carregarGastos();
            } catch (err) {
                mostrarModal('Erro ao salvar', traduzirErro(err.message));
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
                mostrarModal('Recurso Premium', 'A exportação de relatórios de despesas é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos.html"; }, 2000);
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
                    .select('id, descricao, valor, data, categoria')
                    .gte('data', dataInicio)
                    .lte('data', dataFim)
                    .order('data', { ascending: false });

                if (error) throw error;

                if (!gastos || gastos.length === 0) {
                    mostrarModal('Nenhum gasto', 'Nenhum gasto encontrado para exportar neste mês.', 'alerta');
                    return;
                }

                // Gerar CSV (montarCsv neutraliza fórmulas: = + - @)
                const csv = montarCsv(
                    ["Data", "Descricao", "Categoria", "Valor"],
                    gastos.map(g => [
                        new Date(g.data + 'T12:00:00').toLocaleDateString('pt-BR'),
                        g.descricao || '',
                        g.categoria || '',
                        parseFloat(g.valor).toFixed(2).replace('.', ',')
                    ])
                );

                const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Gastos_FinMEI_${mesSel}.csv`;
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
let limiteGastos = TAMANHO_PAGINA;

async function carregarGastos(limite = limiteGastos) {
    limiteGastos = limite;
    const mesSel = filtroMes.value;
    if (!mesSel) return;

    const [ano, mes] = mesSel.split('-');
    const ultimoDia = new Date(ano, mes, 0).getDate();

    try {
        const { data: gastos, error } = await supabase
            .from('despesas')
            .select('id, descricao, valor, data, categoria')
            .gte('data', `${ano}-${mes}-01`)
            .lte('data', `${ano}-${mes}-${ultimoDia}`)
            .order('data', { ascending: false })
            .limit(limite);

        if (error) throw error;

        const lista = document.getElementById("listaGastos");
        let total = 0;
        
        if (!gastos || gastos.length === 0) {
            lista.innerHTML = '<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhum gasto registrado neste mês.</p>';
            document.getElementById("totalGastoMes").textContent = "R$ 0,00";
            return;
        }

        gastosRenderizados = gastos;

        lista.innerHTML = gastos.map(g => {
            total += parseFloat(g.valor);
            return `
                <div class="gasto-card">
                    <div class="gasto-info">
                        <div class="gasto-icone">
                            <i data-lucide="trending-down" style="width: 20px;"></i>
                        </div>
                        <div class="gasto-texto">
                            <h4>${esc(g.descricao)}</h4>
                            <small>${esc(g.categoria)} • ${new Date(g.data + 'T12:00:00').toLocaleDateString('pt-BR')}</small>
                        </div>
                    </div>
                    <div class="gasto-preco-acoes">
                        <span class="gasto-valor">- R$ ${parseFloat(g.valor).toFixed(2)}</span>
                        <div class="gasto-acoes">
                            <button data-acao="editar" data-id="${esc(g.id)}" class="btn-acao btn-edit" title="Editar">
                                <i data-lucide="edit-2"></i>
                            </button>
                            <button data-acao="excluir" data-id="${esc(g.id)}" class="btn-acao btn-delete" title="Excluir">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        botaoCarregarMais(lista, gastos.length, limite, carregarGastos);

        document.getElementById("totalGastoMes").textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar gastos:", err);
    }
}

window.abrirEditarGasto = async function(id) {
    try {
        const { data, error } = await supabase.from('despesas').select('id, descricao, valor, data, categoria').eq('id', id).single();
        if (error) throw error;

        document.getElementById("editGastoId").value = data.id;
        document.getElementById("editDescGasto").value = data.descricao;
        document.getElementById("editValorGasto").value = data.valor;
        document.getElementById("editDataGasto").value = data.data;
        document.getElementById("editCatGasto").value = data.categoria;

        document.getElementById("modalEditarGasto").style.display = 'flex';
        lucide.createIcons();
    } catch (err) {
        mostrarModal('Erro ao buscar dados', traduzirErro(err.message));
    }
};

window.fecharModalEditarGasto = function() {
    document.getElementById("modalEditarGasto").style.display = 'none';
};

window.deletarGasto = async function(id) {
    const confirmed = await confirmModal("Excluir gasto", "Tem certeza que deseja excluir este gasto? Essa ação não pode ser desfeita.");
    if (!confirmed) return;
    try {
        const { error } = await supabase.from('despesas').delete().eq('id', id);
        if (error) throw error;
        // A contagem mudou: o aviso de limite não pode continuar
        // mostrando o número anterior a esta operação.
        invalidarCachePlano();
        carregarGastos();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
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
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();
            fecharModalEditarGasto();
            carregarGastos();
        } catch (err) {
            mostrarModal('Erro ao salvar', traduzirErro(err.message));
        } finally { btn.disabled = false; }
    });
}


