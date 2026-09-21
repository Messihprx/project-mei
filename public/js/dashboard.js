import { supabase } from './auth.js';
import { protegerAcao, verificarStatusPlano } from './planos.js';
import { esc } from './dom-utils.js';

const filtroMesInput = document.getElementById("filtroMesDashboard");

// --- NOVO: PROTEÇÃO DE ROTA (EVITA O FLASH) ---
async function verificarSessao() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "login.html";
        return;
    } 

    // SE CHEGOU AQUI, ESTÁ LOGADO. 
    // Mostra a tela IMEDIATAMENTE antes de buscar os dados do banco
    document.body.classList.add("auth-ready");

    // Agora sim, carrega o resto sem pressa
    if (filtroMesInput && !filtroMesInput.value) {
        const agora = new Date();
        filtroMesInput.value = agora.toISOString().substring(0, 7);
    }
    
    carregarDadosUsuario();
    carregarDashboard();
}

// --- 1. CARREGAR DADOS DO USUÁRIO ---
async function carregarDadosUsuario() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const nomeCompleto = user.user_metadata?.nome || user.user_metadata?.full_name || user.email.split('@')[0];
            const primeiroNome = nomeCompleto.charAt(0).toUpperCase() + nomeCompleto.slice(1).split(' ')[0];
            const saudacaoElem = document.getElementById("nomeUsuario");
            if (saudacaoElem) {
                const h = new Date().getHours();
                const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
                saudacaoElem.textContent = `${g}, ${primeiroNome}!`;
            }
            
            const fotoElem = document.getElementById("fotoUsuario");
            if (fotoElem) fotoElem.src = user.user_metadata?.avatar_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
        }
    } catch (err) { console.error("Erro ao carregar dados do usuário:", err); }
}

// --- 2. CARREGAR DASHBOARD COMPLETO ---
// --- 2. CARREGAR DASHBOARD ---
//
// Antes esta função buscava TODO o histórico de vendas e despesas e
// somava no navegador. O PostgREST corta em 1000 linhas sem avisar,
// então o "Saldo Geral" ficava errado em silêncio assim que o usuário
// passava desse volume. Agora o Postgres agrega e devolve pronto.
async function carregarDashboard() {
    if (!filtroMesInput) return;
    const mesSel = filtroMesInput.value;
    if (!mesSel) return;

    try {
        const { data: resumo, error } = await supabase.rpc('dashboard_resumo', { p_mes: mesSel });
        if (error) throw error;
        if (!resumo || resumo.erro) return;

        const mes = resumo.mes || {};
        const serie = resumo.serie_mensal || [];

        const atualizarTexto = (id, valor) => {
            const el = document.getElementById(id);
            if (el) el.textContent = `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        };

        atualizarTexto("totalEntradas", mes.entradas);
        atualizarTexto("totalSaidas", mes.pendentes);
        atualizarTexto("totalGastosDashboard", mes.gastos);
        atualizarTexto("lucroReal", mes.lucro);

        const saldoGeral = Number(resumo.saldo_geral || 0);
        const cardSaldo = document.getElementById("saldoGeralTotal");
        if (cardSaldo) {
            cardSaldo.textContent = `R$ ${saldoGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            cardSaldo.style.color = saldoGeral < 0 ? 'var(--cor-erro)' : 'var(--cor-primaria-strong)';
        }

        // --- SALDO CONSOLIDADO DAS CONTAS (RF106) ---
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: contas } = await supabase
                    .from('contas')
                    .select('saldo_atual, finalidade')
                    .eq('user_id', user.id)
                    .eq('ativo', true);

                const saldoConsolidado = (contas || [])
                    .filter(c => c.finalidade === 'negocio' || c.finalidade === 'misto')
                    .reduce((sum, c) => sum + parseFloat(c.saldo_atual || 0), 0);

                const cardSaldoConsolidado = document.getElementById("saldoConsolidadoDashboard");
                if (cardSaldoConsolidado) {
                    cardSaldoConsolidado.textContent = `R$ ${saldoConsolidado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                    cardSaldoConsolidado.style.color = saldoConsolidado < 0 ? 'var(--cor-erro)' : 'var(--cor-sucesso)';
                }
            }
        } catch (e) {
            console.error("Erro ao calcular saldo consolidado:", e);
        }

        renderizarMovimentacoes(resumo.ultimas_movimentacoes || []);
        atualizarListaHistorica(serie);
        renderizarGraficos(serie, resumo.donut || []);
        renderizarComparacao(mes, resumo.mes_anterior || {});

    } catch (err) {
        console.error("Erro ao processar dashboard:", err);
    }
}

// Função auxiliar para formatar datas sem erro de fuso horário
function formatarData(dataStr) {
    if (!dataStr) return '';
    if (dataStr.length <= 10 && !dataStr.includes('T')) {
        return new Date(dataStr + 'T12:00:00').toLocaleDateString('pt-BR');
    }
    return new Date(dataStr).toLocaleDateString('pt-BR');
}

function renderizarMovimentacoes(movs) {
    const lista = document.getElementById("listaMovimentacoes");
    if (!lista) return;

    if (!movs.length) {
        lista.innerHTML = '<p style="text-align:center; color:var(--texto-faint); padding: 1rem;">Nenhuma movimentação no mês.</p>';
        return;
    }

    lista.innerHTML = movs.map(m => `
        <div class="item-venda" style="margin-bottom: 8px;">
            <span style="color: var(--texto-secundario); font-size: 0.85rem;">${esc(m.titulo)} <br><small style="color: var(--texto-faint);">${formatarData(m.data)}</small></span>
            <span style="color: ${m.status === 'gasto' ? 'var(--cor-erro)' : (m.status === 'pago' ? 'var(--cor-sucesso)' : 'var(--cor-alerta)')}; font-weight: 600;">
                ${m.status === 'gasto' ? '-' : ''} R$ ${Number(m.valor || 0).toFixed(2)}
            </span>
        </div>
    `).join('');
}

const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho',
                  'julho','agosto','setembro','outubro','novembro','dezembro'];

function rotuloMesExtenso(chave) {
    const [ano, mes] = String(chave).split('-');
    return `${MESES_PT[Number(mes) - 1] || mes} de ${ano}`;
}

function atualizarListaHistorica(serie) {
    const container = document.getElementById("listaLucroMensal");
    if (!container) return;

    if (!serie.length) {
        container.innerHTML = '<p style="text-align:center; color:var(--texto-faint); padding: 1rem;">Sem histórico disponível.</p>';
        return;
    }

    container.innerHTML = serie.slice().reverse().map(item => {
        const lucro = Number(item.lucro || 0);
        return `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--borda-cor); padding: 0.8rem 0;">
                <span style="color: var(--texto-secundario); text-transform: capitalize; font-size: 0.85rem;">${esc(rotuloMesExtenso(item.mes))}</span>
                <span style="color: ${lucro >= 0 ? 'var(--cor-sucesso)' : 'var(--cor-erro)'}; font-weight: 700; font-size: 0.9rem;">
                    R$ ${lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
            </div>
        `;
    }).join('');
}

// --- 3. GRÁFICOS CHART.JS ---
let charts = {};

function destroyCharts() {
    Object.values(charts).forEach(c => c && c.destroy());
    charts = {};
}

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Os gráficos agora recebem a série já agregada pelo Postgres, em vez
// de reagrupar milhares de linhas no navegador a cada troca de mês.
function renderizarGraficos(serie, donut) {
    destroyCharts();

    const textoCor = getCssVar('--texto-faint') || '#8a9aa9';
    const gridCor = getCssVar('--borda-cor') || '#26364e';
    const surfaceCor = getCssVar('--fundo-card') || '#162031';
    const accentCor = getCssVar('--cor-primaria') || '#1fa6fc';
    const posCor = getCssVar('--cor-sucesso') || '#00e575';
    const negCor = getCssVar('--cor-erro') || '#ff3b30';
    const warnCor = getCssVar('--cor-alerta') || '#ff9100';

    const baseOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: { color: textoCor, boxWidth: 12, boxHeight: 12, usePointStyle: true }
            }
        },
        scales: {
            x: { grid: { color: gridCor }, ticks: { color: textoCor } },
            y: { grid: { color: gridCor }, ticks: { color: textoCor, callback: v => 'R$ ' + v } }
        }
    };

    const ultimos = serie.slice(-6);
    const mesesLabels = ultimos.map(s => s.label);

    // --- Receitas x Despesas (barras mensais) ---
    const ctxRevExp = document.getElementById('chRevExp');
    if (ctxRevExp) {
        charts['chRevExp'] = new Chart(ctxRevExp, {
            type: 'bar',
            data: {
                labels: mesesLabels,
                datasets: [
                    {
                        label: 'Receitas',
                        data: ultimos.map(s => Math.round(Number(s.receita || 0))),
                        backgroundColor: accentCor,
                        borderRadius: 4
                    },
                    {
                        label: 'Despesas',
                        data: ultimos.map(s => Math.round(Number(s.despesa || 0))),
                        backgroundColor: negCor,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                ...baseOpts,
                scales: {
                    x: { grid: { display: false }, ticks: { color: textoCor } },
                    y: { grid: { color: gridCor }, ticks: { color: textoCor, callback: v => 'R$ ' + v } }
                }
            }
        });
    }

    // --- Evolução do Lucro (linha) ---
    const ctxProfit = document.getElementById('chProfit');
    if (ctxProfit) {
        charts['chProfit'] = new Chart(ctxProfit, {
            type: 'line',
            data: {
                labels: mesesLabels,
                datasets: [{
                    label: 'Lucro',
                    data: ultimos.map(s => Math.round(Number(s.lucro || 0))),
                    borderColor: posCor,
                    backgroundColor: 'transparent',
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: posCor,
                    borderWidth: 2
                }]
            },
            options: baseOpts
        });
    }

    // --- Donut de vendas por produto ---
    const ctxDonut = document.getElementById('chDonut');
    if (ctxDonut && donut.length) {
        const palette = [accentCor, '#8b5cf6', posCor, warnCor, '#ec4899', '#64748b', '#14b8a6', '#f97316'];
        charts['chDonut'] = new Chart(ctxDonut, {
            type: 'doughnut',
            data: {
                labels: donut.map(d => d.label),
                datasets: [{
                    data: donut.map(d => Number(d.valor || 0)),
                    backgroundColor: palette.slice(0, donut.length),
                    borderColor: surfaceCor,
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: textoCor, boxWidth: 12, boxHeight: 12, usePointStyle: true }
                    }
                }
            }
        });
    }
}

function renderizarComparacao(mes, mesAnterior) {
    const insightEl = document.getElementById('insightComparacao');
    const gridEl = document.getElementById('comparacaoGrid');
    if (!insightEl || !gridEl) return;

    const entAtual = Number(mes.entradas || 0);
    const lucroAtual = Number(mes.lucro || 0);
    const entAnt = Number(mesAnterior.entradas || 0);
    const lucroAnt = Number(mesAnterior.lucro || 0);

    const rotulo = (ref) => {
        const [ano, m] = String(ref || '').split('-');
        const nome = MESES_PT[Number(m) - 1];
        return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : (ref || '');
    };
    const mesAtualLabel = rotulo(mes.referencia);
    const mesAntLabel = rotulo(mesAnterior.referencia);

    if (lucroAnt === 0 && lucroAtual === 0) {
        insightEl.innerHTML = '<i data-lucide="info"></i><div>Dados insuficientes para comparação entre meses.</div>';
        if (window.lucide) lucide.createIcons();
        gridEl.innerHTML = '';
        return;
    }

    const variacao = lucroAnt > 0 ? ((lucroAtual / lucroAnt - 1) * 100) : (lucroAtual > 0 ? 100 : 0);
    const variacaoReceita = entAnt > 0 ? ((entAtual / entAnt - 1) * 100) : 0;
    const margemAtual = entAtual > 0 ? (lucroAtual / entAtual * 100) : 0;
    const margemAnt = entAnt > 0 ? (lucroAnt / entAnt * 100) : 0;

    const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    const fmtBRL = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0 });

    insightEl.innerHTML = `
        <i data-lucide="info"></i>
        <div>
            Sua receita variou <strong>${fmtPct(variacaoReceita)}</strong> e seu lucro
            <strong>${fmtPct(variacao)}</strong> em relação a ${esc(mesAntLabel)}.
            A margem de lucro passou de <strong>${margemAnt.toFixed(1)}%</strong> para <strong>${margemAtual.toFixed(1)}%</strong>.
        </div>
    `;

    gridEl.innerHTML = `
        <div class="goal-stat">
            <div class="g-label">${esc(mesAntLabel)}</div>
            <div class="g-value">${fmtBRL(lucroAnt)}</div>
        </div>
        <div class="goal-stat">
            <div class="g-label">${esc(mesAtualLabel)}</div>
            <div class="g-value pos">${fmtBRL(lucroAtual)}</div>
        </div>
        <div class="goal-stat">
            <div class="g-label">Variação</div>
            <div class="g-value ${variacao >= 0 ? 'pos' : 'neg'}">${fmtPct(variacao)} (${fmtBRL(lucroAtual - lucroAnt)})</div>
        </div>
        <div class="goal-stat">
            <div class="g-label">Margem de Lucro</div>
            <div class="g-value acc">${margemAtual.toFixed(1)}%</div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();
}

// Os itens globais (menu mobile, etc) agora são tratados pelo auth.js

// Ligar o botão de resetar mês
document.getElementById("btnLimparFiltro")?.addEventListener("click", () => {
    const agora = new Date();
    filtroMesInput.value = agora.toISOString().substring(0, 7);
    carregarDashboard();
});

filtroMesInput?.addEventListener("change", carregarDashboard);

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
    verificarSessao();
});

window.abrirRelatorioAnalitico = async function() {
    const statusObj = await verificarStatusPlano();
    if (!statusObj.premium) {
        mostrarModal('Recurso Premium', 'O módulo de Relatórios de BI Avançados está disponível apenas para assinantes Premium. Faça o upgrade agora!', 'alerta');
        setTimeout(() => { window.location.href = "planos.html"; }, 2000);
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        mostrarModal('Faça login', 'Por favor, faça login para acessar seus relatórios.');
        setTimeout(() => { window.location.href = "login.html"; }, 2000);
        return;
    }

    // Antes o link levava ?user_id=<uuid> e o Streamlit confiava nisso:
    // quem tivesse o UUID de alguém via o financeiro daquela pessoa.
    // Agora pedimos um código de uso único, válido por 5 minutos.
    try {
        const { data, error } = await supabase.functions.invoke('bi-token', { body: {} });
        if (error) throw error;
        if (!data?.token) throw new Error(data?.error || 'Não foi possível gerar o acesso.');

        const urlStreamlit = "https://project-mei-app-dw-e5jih2p8ek6plegymc93ot.streamlit.app/";
        window.open(`${urlStreamlit}?t=${encodeURIComponent(data.token)}`, '_blank');
    } catch (e) {
        console.error('Erro ao abrir relatório:', e);
        mostrarModal('Erro', 'Não foi possível abrir o relatório agora. Tente novamente em instantes.', 'erro');
    }
}