import { supabase } from './auth.js';
import { protegerAcao, verificarStatusPlano } from './planos.js';
import { esc, formatarDataVenda } from './dom-utils.js';

const filtroMesInput = document.getElementById("filtroMesDashboard");
const filtroPeriodoSelect = document.getElementById("filtroTipoPeriodo");
const filtroAnoInput = document.getElementById("filtroAnoDashboard");
const campoFiltroMes = document.getElementById("campoFiltroMes");
const campoFiltroAno = document.getElementById("campoFiltroAno");
let dashboardRequestId = 0;

function mesAtualLocal() {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function atualizarControlesPeriodo() {
    const modo = filtroPeriodoSelect?.value || 'month';
    if (campoFiltroMes) campoFiltroMes.hidden = modo !== 'month';
    if (campoFiltroAno) campoFiltroAno.hidden = modo !== 'year';

    const sufixo = modo === 'year' ? 'Ano' : modo === 'all' ? 'Todo período' : 'Mês';
    const rotulos = [
        ['labelRecebidoDashboard', `Recebido (${sufixo})`],
        ['labelPendenteDashboard', `A Receber (${sufixo})`],
        ['labelDespesasDashboard', `Despesas (${sufixo})`],
        ['labelLucroDashboard', `Lucro Líquido (${sufixo})`]
    ];
    rotulos.forEach(([id, texto]) => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.textContent = texto;
    });

    const badge = document.getElementById('badgePeriodo');
    const badgeTexto = document.getElementById('textoBadgePeriodo');
    if (badge && badgeTexto) {
        let texto = '';
        if (modo === 'month') {
            const [ano, mes] = String(filtroMesInput?.value || '').split('-');
            const nome = mes ? MESES_PT[Number(mes) - 1] : '';
            texto = nome ? `${nome.charAt(0).toUpperCase() + nome.slice(1)} de ${ano}` : 'Mês atual';
        } else if (modo === 'year') {
            texto = filtroAnoInput?.value ? `Ano ${filtroAnoInput.value}` : 'Ano atual';
        } else {
            texto = 'Todo o período';
        }
        badgeTexto.textContent = texto;
    }

    const tituloComparacao = document.getElementById('tituloComparacao');
    if (tituloComparacao) {
        tituloComparacao.textContent = modo === 'year'
            ? 'Comparação com o Ano Anterior'
            : modo === 'all'
                ? 'Resumo de Todo o Histórico'
                : 'Comparação com o Mês Anterior';
    }
}

// --- NOVO: PROTEÇÃO DE ROTA (EVITA O FLASH) ---
async function verificarSessao() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "login";
        return;
    } 

    // SE CHEGOU AQUI, ESTÁ LOGADO. 
    // Mostra a tela IMEDIATAMENTE antes de buscar os dados do banco
    document.body.classList.add("auth-ready");

    // Agora sim, carrega o resto sem pressa
    if (filtroMesInput && !filtroMesInput.value) filtroMesInput.value = mesAtualLocal();
    if (filtroAnoInput && !filtroAnoInput.value) filtroAnoInput.value = String(new Date().getFullYear());
    atualizarControlesPeriodo();
    
    carregarDadosUsuario();
    carregarDashboard();
}

// --- 1. CARREGAR DADOS DO USUÁRIO ---
async function carregarDadosUsuario() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const nomeCompleto = (user.user_metadata?.nome || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário').toString().trim();
            const primeiroNome = nomeCompleto ? nomeCompleto.charAt(0).toUpperCase() + nomeCompleto.slice(1).split(' ')[0] : 'Usuário';
            const saudacaoElem = document.getElementById("nomeUsuario");
            if (saudacaoElem) {
                const h = new Date().getHours();
                const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
                saudacaoElem.textContent = `${g}, ${primeiroNome}!`;
            }

            const nomeHeaderElem = document.getElementById("nomePerfilHeader");
            if (nomeHeaderElem) {
                const partes = nomeCompleto.trim().split(/\s+/);
                const nomeCurto = partes.length > 0 ? partes.slice(0, 2).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Usuário';
                nomeHeaderElem.textContent = nomeCurto || 'Usuário';
            }
            
            const fotoElem = document.getElementById("fotoUsuario");
            if (fotoElem) fotoElem.src = user.user_metadata?.avatar_url || user.user_metadata?.picture || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
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
    if (!filtroMesInput || !filtroPeriodoSelect) return;
    const modo = filtroPeriodoSelect.value;
    const periodoSelecionado = modo === 'all'
        ? 'all'
        : modo === 'year'
            ? filtroAnoInput?.value
            : filtroMesInput.value;
    if (!periodoSelecionado) return;
    if (modo === 'year' && (!filtroAnoInput?.validity.valid || !/^\d{4}$/.test(periodoSelecionado))) {
        filtroAnoInput?.reportValidity();
        return;
    }
    const requestId = ++dashboardRequestId;

    try {
        const { data: resumo, error } = await supabase.rpc('dashboard_resumo', { p_mes: periodoSelecionado });
        if (error) throw error;
        if (requestId !== dashboardRequestId) return;
        if (!resumo || resumo.erro) return;

        const mes = resumo.mes || {};
        const serie = resumo.serie_mensal || [];

        // Formata moeda de forma segura: nunca exibe "undefined" / "NaN".
        const moeda = (v) => {
            const n = Number(v || 0);
            return Number.isFinite(n) ? n : 0;
        };

        const atualizarTexto = (id, valor) => {
            const el = document.getElementById(id);
            if (el) el.textContent = `R$ ${moeda(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        };

        atualizarTexto("totalEntradas", mes.entradas);
        atualizarTexto("totalSaidas", mes.pendentes);
        atualizarTexto("totalGastosDashboard", mes.gastos);
        atualizarTexto("lucroReal", mes.lucro);

        // --- Variação % vs período anterior nos 4 cards ---
        const mesAnt = resumo.mes_anterior || {};
        const fmtVar = (atual, anterior) => {
            const a = Number(atual || 0);
            const ant = Number(anterior || 0);
            if (!Number.isFinite(a)) a = 0;
            if (!Number.isFinite(ant)) ant = 0;

            // Sem dado do período anterior: não inventa variação, mostra 0% neutra.
            if (ant === 0) {
                const texto = a > 0 ? '+100,0%' : (a === 0 ? '0,0%' : '-100,0%');
                const classe = a > 0 ? 'pos' : (a < 0 ? 'neg' : 'neutro');
                const icone = a > 0 ? 'trending-up' : (a < 0 ? 'trending-down' : 'minus');
                return { texto, icone, classe };
            }

            const pct = ((a / ant - 1) * 100);
            const sinal = pct >= 0 ? '+' : '';
            const icone = pct > 0 ? 'trending-up' : (pct < 0 ? 'trending-down' : 'minus');
            return { texto: `${sinal}${pct.toFixed(1).replace('.', ',')}%`, icone, classe: pct > 0 ? 'pos' : (pct < 0 ? 'neg' : 'neutro') };
        };

        // Rótulo do período anterior para mostrar "vs X"
        const rotuloMesAnt = (ref) => {
            if (!ref) return 'período passado';
            const [ano, m] = String(ref).split('-');
            const nome = MESES_PT?.[Number(m) - 1] || m;
            return `${nome.charAt(0).toUpperCase() + nome.slice(1)} de ${ano}`;
        };
        const labelComparacao = rotuloMesAnt(mesAnt.referencia);

        const aplicarVariacao = (idAtual, idAnt, idEl) => {
            const el = document.getElementById(idEl);
            if (!el) return;
            const v = fmtVar(mes[idAtual], mesAnt[idAnt]) || {};
            el.innerHTML = `<i data-lucide="${esc(v.icone || 'minus')}"></i> ${esc(v.texto || '0,0%')} <span class="metric-variacao-vs">vs ${esc(labelComparacao || 'período passado')}</span>`;
            el.className = 'metric-variacao ' + (v.classe || 'neutro');
            if (window.lucide) lucide.createIcons();
        };

        aplicarVariacao('entradas', 'entradas', 'variacaoRecebido');
        aplicarVariacao('pendentes', 'pendentes', 'variacaoReceber');
        aplicarVariacao('gastos', 'gastos', 'variacaoDespesas');
        aplicarVariacao('lucro', 'lucro', 'variacaoLucro');

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
        if (requestId !== dashboardRequestId) return;

        renderizarMovimentacoes(resumo.ultimas_movimentacoes || []);
        atualizarListaHistorica(serie);
        renderizarGraficos(serie, resumo.donut || [], modo);
        renderizarComparacao(mes, resumo.mes_anterior || {}, modo);

    } catch (err) {
        console.error("Erro ao processar dashboard:", err);
    }
}

// Função auxiliar para formatar datas sem erro de fuso horário:
// formatarDataVenda trata data pura em meia-noite UTC (gastos e
// vendas da IA chegam assim pelo SQL) sem rebaixar o dia.
function formatarData(dataStr) {
    return formatarDataVenda(dataStr);
}

function renderizarMovimentacoes(movs) {
    const lista = document.getElementById("listaMovimentacoes");
    if (!lista) return;

    if (!movs.length) {
        lista.innerHTML = '<p style="text-align:center; color:var(--texto-faint); padding: 1rem;">Nenhuma movimentação no período.</p>';
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
        const rotulo = /^\d{4}-\d{2}$/.test(String(item.mes))
            ? rotuloMesExtenso(item.mes)
            : (item.label || item.mes);
        return `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--borda-cor); padding: 0.8rem 0;">
                <span style="color: var(--texto-secundario); text-transform: capitalize; font-size: 0.85rem;">${esc(rotulo)}</span>
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
function renderizarGraficos(serie, donut, modo) {
    destroyCharts();

    const textoCor = getCssVar('--texto-faint') || '#8a9aa9';
    const gridCor = getCssVar('--borda-cor') || '#26364e';
    const surfaceCor = getCssVar('--fundo-card') || '#162031';
    const accentCor = getCssVar('--cor-primaria') || '#3b82f6';
    const posCor = getCssVar('--cor-sucesso') || '#10b981';
    const negCor = getCssVar('--cor-erro') || '#f43f5e';
    const warnCor = getCssVar('--cor-alerta') || '#f59e0b';

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

    const ultimos = modo === 'month' ? serie.slice(-6) : serie;
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
        const palette = [accentCor, '#8b5cf6', posCor, warnCor, '#ec4899', '#6b7a90', '#14b8a6', '#f97316'];
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

function renderizarComparacao(mes, mesAnterior, modo) {
    const insightEl = document.getElementById('insightComparacao');
    const gridEl = document.getElementById('comparacaoGrid');
    if (!insightEl || !gridEl) return;

    if (modo === 'all') {
        insightEl.innerHTML = '<i data-lucide="info"></i><div>Os valores consideram todo o histórico de vendas e despesas registradas.</div>';
        gridEl.innerHTML = '';
        if (window.lucide) lucide.createIcons();
        return;
    }

    const entAtual = Number(mes.entradas || 0);
    const lucroAtual = Number(mes.lucro || 0);
    const entAnt = Number(mesAnterior.entradas || 0);
    const lucroAnt = Number(mesAnterior.lucro || 0);

    const rotulo = (ref) => {
        const [ano, m] = String(ref || '').split('-');
        const nome = MESES_PT[Number(m) - 1];
        return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : (ref || '');
    };
    const mesAtualLabel = modo === 'year' ? String(mes.referencia || '') : rotulo(mes.referencia);
    const mesAntLabel = modo === 'year' ? String(mesAnterior.referencia || '') : rotulo(mesAnterior.referencia);

    if (lucroAnt === 0 && lucroAtual === 0) {
        const unidade = modo === 'year' ? 'anos' : 'meses';
        insightEl.innerHTML = `<i data-lucide="info"></i><div>Dados insuficientes para comparação entre ${unidade}.</div>`;
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
    if (filtroPeriodoSelect) filtroPeriodoSelect.value = 'month';
    filtroMesInput.value = mesAtualLocal();
    atualizarControlesPeriodo();
    carregarDashboard();
});

filtroPeriodoSelect?.addEventListener("change", () => {
    atualizarControlesPeriodo();
    carregarDashboard();
});
filtroMesInput?.addEventListener("change", () => {
    atualizarControlesPeriodo();
    carregarDashboard();
});
filtroAnoInput?.addEventListener("change", () => {
    atualizarControlesPeriodo();
    carregarDashboard();
});

// Cards velhos ao voltar para a tela: o botão "voltar" (bfcache) e
// abas que ficaram abertas restauram a página sem refazer a consulta —
// o usuário editava a venda e o dashboard continuava mostrando os
// números de antes. Recarrega sempre que a tela volta a ser exibida.
window.addEventListener('pageshow', (e) => {
    if (e.persisted) carregarDashboard();
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') carregarDashboard();
});

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
    verificarSessao();
    inicializarBuscaHeader();
});

function inicializarBuscaHeader() {
    const input = document.getElementById('buscaGlobalHeader');
    const resultsBox = document.getElementById('headerSearchResults');
    if (!input || !resultsBox) return;

    const atalhos = [
        { titulo: 'Vendas', sub: 'Histórico e gestão de vendas', href: 'vendas', tags: 'venda faturamento receita pedido' },
        { titulo: 'Nova venda', sub: 'Registrar uma nova venda agora', href: 'nova-venda', tags: 'nova venda adicionar registrar' },
        { titulo: 'Clientes', sub: 'Base de clientes cadastrados', href: 'clientes', tags: 'cliente contato cadastro' },
        { titulo: 'Novo cliente', sub: 'Cadastrar novo cliente', href: 'novo-cliente', tags: 'novo cliente adicionar' },
        { titulo: 'Produtos', sub: 'Catálogo, preços e estoque', href: 'produtos', tags: 'produto item servico estoque' },
        { titulo: 'Gastos', sub: 'Despesas e custos operacionais', href: 'gastos', tags: 'gasto despesa custo saida' },
        { titulo: 'Contas', sub: 'Contas bancárias e saldos', href: 'contas', tags: 'conta banco saldo carteira' },
        { titulo: 'Devedores / Pendentes', sub: 'Cobranças e valores a receber em Vendas', href: 'vendas', tags: 'devedor pendente receber cobranca' },
        { titulo: 'FinMEI IA', sub: 'Assistente inteligente para seu MEI', href: 'ia', tags: 'ia assistente chat ajuda' },
        { titulo: 'Obrigações do MEI', sub: 'DAS, DASN-SIMEI, limites e calendário fiscal', href: 'mei', tags: 'mei obrigacoes das dasn simei limite faturamento imposto nota fiscal' },
        { titulo: 'Meu perfil', sub: 'Dados da conta e preferências', href: 'perfil', tags: 'perfil conta configuracoes' },
        { titulo: 'Ver Planos', sub: 'Assinatura e recursos Premium', href: 'planos', tags: 'plano premium assinatura' }
    ];

    const renderizar = (termo) => {
        const q = termo.trim().toLowerCase();
        if (!q) {
            resultsBox.hidden = true;
            resultsBox.innerHTML = '';
            return;
        }
        const matches = atalhos.filter(item =>
            item.titulo.toLowerCase().includes(q) ||
            item.sub.toLowerCase().includes(q) ||
            item.tags.includes(q)
        ).slice(0, 6);

        if (!matches.length) {
            resultsBox.innerHTML = '<div class="header-search-empty">Nenhum atalho encontrado</div>';
            resultsBox.hidden = false;
            return;
        }

        resultsBox.innerHTML = matches.map(m => `
            <a href="${m.href}" class="header-search-item">
                <span class="header-search-item-title">${esc(m.titulo)}</span>
                <span class="header-search-item-sub">${esc(m.sub)}</span>
            </a>
        `).join('');
        resultsBox.hidden = false;
    };

    input.addEventListener('input', () => renderizar(input.value));
    input.addEventListener('focus', () => {
        if (input.value.trim()) renderizar(input.value);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const firstLink = resultsBox.querySelector('a.header-search-item');
            if (firstLink) {
                e.preventDefault();
                window.location.href = firstLink.getAttribute('href');
            }
        } else if (e.key === 'Escape') {
            resultsBox.hidden = true;
            input.blur();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-search-wrap')) {
            resultsBox.hidden = true;
        }
    });
}

window.abrirRelatorioAnalitico = async function() {
    const statusObj = await verificarStatusPlano();
    if (!statusObj.premium) {
        mostrarModal('Recurso Premium', 'O módulo de Relatórios de BI Avançados está disponível apenas para assinantes Premium. Faça o upgrade agora!', 'alerta');
        setTimeout(() => { window.location.href = "planos"; }, 2000);
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        mostrarModal('Faça login', 'Por favor, faça login para acessar seus relatórios.');
        setTimeout(() => { window.location.href = "login"; }, 2000);
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