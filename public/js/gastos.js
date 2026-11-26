import { supabase } from './auth.js';
import { verificarStatusPlano, invalidarCachePlano } from './planos.js';
import { esc, delegate, montarCsv, buscarTodasAsLinhas } from './dom-utils.js';
import { atualizarSaldoConta, garantirOpcaoConta } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';
import { criarDataTable } from './datatable.js';

let gastosRenderizados = [];

const filtroMes = document.getElementById("filtroMesGastos");
const formGasto = document.getElementById("formNovoGasto");

// --- POPULAR SELECT DE CONTAS ---
async function popularSelectContasGasto() {
    const selects = document.querySelectorAll('#contaGasto, #editContaGasto');
    if (selects.length === 0) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('id, nome')
            .eq('user_id', user.id)
            .eq('ativo', true)
            .order('nome');

        if (error) throw error;

        const options = (contas || []).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');

        selects.forEach(sel => {
            sel.innerHTML = '<option value="">Sem conta vinculada</option>' + options;
            montarSelectBusca(sel, {
                placeholder: 'Buscar conta...',
                opcaoVazia: { valor: '', texto: 'Sem conta vinculada' }
            });
        });
    } catch (err) {
        console.error("Erro ao carregar contas:", err.message);
    }
}

async function popularSelectContasFiltroGastos() {
    const select = document.getElementById("filtroContaGastos");
    if (!select) return;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        // Lista também contas inativadas: o histórico de gastos da conta
        // inativada continua consultável pelo filtro (RF113/RF115).
        const { data: contas } = await supabase
            .from('contas').select('id, nome, ativo')
            .eq('user_id', user.id).order('nome');
        select.innerHTML = '<option value="">Todas as contas</option>' +
            (contas || []).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');
    } catch (err) {
        console.error("Erro ao carregar filtro:", err.message);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = "login";
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
        filtroMes.addEventListener("change", () => carregarGastos());
    }

    carregarGastos();
    popularSelectContasGasto();

    // Filtro por conta
    const filtroContaGastos = document.getElementById("filtroContaGastos");
    if (filtroContaGastos) {
        popularSelectContasFiltroGastos();
        filtroContaGastos.addEventListener("change", () => carregarGastos());
    }

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
                    conta_id: document.getElementById("contaGasto").value || null,
                    user_id: user.id
                };
                const { error } = await supabase.from('despesas').insert([dados]);
                if (error) throw error;
                if (dados.conta_id) {
                    await atualizarSaldoConta(dados.conta_id, -valorGasto);
                }
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
                setTimeout(() => { window.location.href = "planos"; }, 2000);
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

// --- LISTA DE GASTOS (TABELA COM BUSCA E FILTRO) ---
let tabelaGastos = null;

function montarTabelaGastos(container) {
    tabelaGastos = criarDataTable({
        container,
        idLinha: (gasto) => gasto.id,
        porPagina: 10,
        placeholderBusca: 'Buscar por descrição, categoria ou conta...',
        textoVazio: 'Nenhum gasto registrado neste mês.',
        ordenacaoInicial: { coluna: 'data', direcao: 'desc' },
        filtros: [
            {
                id: 'categoria',
                rotulo: 'Categoria',
                opcoes: [
                    { valor: '', texto: 'Todas' },
                    { valor: 'Mercadoria', texto: 'Mercadoria' },
                    { valor: 'Aluguel', texto: 'Aluguel' },
                    { valor: 'Marketing', texto: 'Marketing' },
                    { valor: 'Serviços', texto: 'Serviços' },
                    { valor: 'Outros', texto: 'Outros' },
                ],
                testar: (gasto, valor) => gasto.categoria === valor,
            },
        ],
        colunas: [
            {
                id: 'data',
                titulo: 'Data',
                valor: (gasto) => new Date(gasto.data + 'T12:00:00').toLocaleDateString('pt-BR'),
                ordenarPor: (gasto) => gasto.data,
                classe: 'dt-col-data',
            },
            {
                id: 'descricao',
                titulo: 'Descrição',
                valor: (gasto) => gasto.descricao || '',
                render: (gasto) => `<div class="dt-celula-texto">
                    <span class="dt-nome">${esc(gasto.descricao)}</span>
                </div>`,
            },
            {
                id: 'categoria',
                titulo: 'Categoria',
                valor: (gasto) => gasto.categoria || '',
                render: (gasto) => `<span class="dt-tag">${esc(gasto.categoria || 'Outros')}</span>`,
            },
            {
                id: 'conta',
                titulo: 'Conta',
                valor: (gasto) => gasto.contas?.nome || '',
                render: (gasto) => `<span class="dt-sub" style="margin-top:0;">${esc(gasto.contas?.nome || '—')}</span>`,
            },
            {
                id: 'valor',
                titulo: 'Valor',
                alinhamento: 'right',
                valor: (gasto) => Number(gasto.valor || 0),
                ordenarPor: (gasto) => Number(gasto.valor || 0),
                buscaTexto: (gasto) => `R$ ${Number(gasto.valor || 0).toFixed(2).replace('.', ',')}`,
                render: (gasto) => `<span class="dt-valor neg">- R$ ${Number(gasto.valor || 0).toFixed(2).replace('.', ',')}</span>`,
            },
            {
                id: 'acoes',
                titulo: '',
                ordenavel: false,
                busca: false,
                alinhamento: 'right',
                render: (gasto) => `<div class="dt-acoes">
                    <button data-acao="editar" data-id="${esc(gasto.id)}" class="btn-acao btn-edit" title="Editar">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button data-acao="excluir" data-id="${esc(gasto.id)}" class="btn-acao btn-delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>`,
            },
        ],
    });
}

async function carregarGastos() {
    const mesSel = filtroMes.value;
    if (!mesSel) return;

    const container = document.getElementById("listaGastos");
    if (!container) return;

    const [ano, mes] = mesSel.split('-');
    const ultimoDia = new Date(ano, mes, 0).getDate();

    if (!tabelaGastos) {
        container.innerHTML = '<p class="dt-carregando">Carregando gastos...</p>';
    }

    try {
        const gastos = await buscarTodasAsLinhas((inicio, fim) => {
            let query = supabase
                .from('despesas')
                .select('id, descricao, valor, data, categoria, conta_id, contas(nome)')
                .gte('data', `${ano}-${mes}-01`)
                .lte('data', `${ano}-${mes}-${ultimoDia}`)
                .order('data', { ascending: false })
                .order('id', { ascending: true });

            const filtroConta = document.getElementById("filtroContaGastos");
            if (filtroConta && filtroConta.value) {
                query = query.eq('conta_id', filtroConta.value);
            }

            return query.range(inicio, fim);
        });

        gastosRenderizados = gastos;

        const total = gastos.reduce((soma, gasto) => soma + Number(gasto.valor || 0), 0);
        document.getElementById("totalGastoMes").textContent =
            `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        if (!tabelaGastos) montarTabelaGastos(container);
        tabelaGastos.atualizar(gastos);

    } catch (err) {
        console.error("Erro ao carregar gastos:", err);
        if (!tabelaGastos) {
            container.innerHTML = '<p style="color:red">Erro ao carregar dados.</p>';
        } else {
            mostrarModal('Erro ao carregar', 'Não foi possível carregar os gastos. Tente novamente.', 'alerta');
        }
    }
}

window.abrirEditarGasto = async function(id) {
    try {
        const { data, error } = await supabase.from('despesas').select('id, descricao, valor, data, categoria, conta_id').eq('id', id).single();
        if (error) throw error;

        document.getElementById("editGastoId").value = data.id;
        document.getElementById("editDescGasto").value = data.descricao;
        document.getElementById("editValorGasto").value = data.valor;
        document.getElementById("editDataGasto").value = data.data;
        document.getElementById("editCatGasto").value = data.categoria;
        // Se a conta vinculada está inativada, injeta a opção no select
        // antes de setar o value — senão o salvar desvinculava o gasto.
        const selConta = document.getElementById("editContaGasto");
        await garantirOpcaoConta(selConta, data.conta_id);
        if (selConta?._selectBusca) {
            const opcoes = [...selConta.querySelectorAll('option')]
                .map(o => ({ valor: o.value, texto: o.textContent.trim() }))
                .filter(o => o.valor);
            selConta._selectBusca.setOpcoes(opcoes);
            selConta._selectBusca.setValor(data.conta_id || '');
        } else if (selConta) {
            selConta.value = data.conta_id || '';
        }

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
        const { data: gasto } = await supabase.from('despesas').select('conta_id, valor').eq('id', id).single();
        const { error } = await supabase.from('despesas').delete().eq('id', id);
        if (error) throw error;
        if (gasto?.conta_id) {
            await atualizarSaldoConta(gasto.conta_id, parseFloat(gasto.valor || 0));
        }
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
            const { data: gastoAntigo } = await supabase.from('despesas').select('conta_id, valor').eq('id', id).single();
            const novoValor = parseFloat(document.getElementById("editValorGasto").value);
            const novaConta = document.getElementById("editContaGasto").value || null;

            const dados = {
                descricao: document.getElementById("editDescGasto").value,
                valor: novoValor,
                data: document.getElementById("editDataGasto").value,
                categoria: document.getElementById("editCatGasto").value,
                conta_id: novaConta
            };
            const { error } = await supabase.from('despesas').update(dados).eq('id', id);
            if (error) throw error;

            if (gastoAntigo) {
                const valorAntigo = parseFloat(gastoAntigo.valor || 0);
                const contaAntiga = gastoAntigo.conta_id;
                if (contaAntiga && contaAntiga !== novaConta) {
                    await atualizarSaldoConta(contaAntiga, valorAntigo);
                    if (novaConta) await atualizarSaldoConta(novaConta, -novoValor);
                } else if (contaAntiga && contaAntiga === novaConta) {
                    await atualizarSaldoConta(novaConta, valorAntigo - novoValor);
                }
            }
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


