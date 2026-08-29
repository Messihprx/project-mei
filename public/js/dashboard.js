import { supabase } from './auth.js';
import { protegerAcao, verificarStatusPlano } from './planos.js';

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
async function carregarDashboard() {
    if (!filtroMesInput) return;
    const mesSel = filtroMesInput.value;
    if (!mesSel) return;

    const status = await verificarStatusPlano();
    const [ano, mes] = mesSel.split('-');
    const ultimoDia = new Date(ano, mes, 0).getDate();
    
    const inicioFiltroVendas = `${ano}-${mes}-01T00:00:00`;
    const fimFiltroVendas = `${ano}-${mes}-${ultimoDia}T23:59:59`;

    try {
        // 1. Busca os dados do mês
        const [resVendasMes, resGastosMes] = await Promise.all([
            supabase.from('vendas').select('*').gte('created_at', inicioFiltroVendas).lte('created_at', fimFiltroVendas),
            supabase.from('despesas').select('*').gte('data', `${ano}-${mes}-01`).lte('data', `${ano}-${mes}-${ultimoDia}`)
        ]);

        const vendasMes = resVendasMes.data || [];
        const gastosMes = resGastosMes.data || [];

        let vendasHisto = [];
        let gastosHisto = [];

        if (status.premium) {
            // Se for Premium, buscamos o HISTÓRICO REAL
            const [resHistoVendas, resHistoGastos] = await Promise.all([
                supabase.from('vendas').select('valor, created_at').eq('status', 'pago'),
                supabase.from('despesas').select('valor, data')
            ]);
            vendasHisto = resHistoVendas.data || [];
            gastosHisto = resHistoGastos.data || [];
        } else {
            // Se for Gratuito, histórico limitado ao mês (Versão Simples)
            vendasHisto = vendasMes.filter(v => v.status === 'pago');
            gastosHisto = gastosMes;
        }

        // --- CÁLCULOS DO MÊS ---
        let mEntradas = 0; 
        let mPendentes = 0;
        let mGastos = 0;

        vendasMes.forEach(v => {
            if (v.status === 'pago') mEntradas += (v.valor || 0);
            else mPendentes += (v.valor || 0);
        });
        
        gastosMes.forEach(g => mGastos += parseFloat(g.valor || 0));

        const mLucroReal = mEntradas - mGastos;

        // --- CÁLCULO TOTAL (HISTÓRICO) ---
        const totalVendasHistorico = vendasHisto.reduce((acc, v) => acc + (v.valor || 0), 0);
        const totalGastosHistorico = gastosHisto.reduce((acc, g) => acc + parseFloat(g.valor || 0), 0);
        const saldoGeral = totalVendasHistorico - totalGastosHistorico;

        // --- ATUALIZAR TELAS ---
        const atualizarTexto = (id, valor) => {
            const el = document.getElementById(id);
            if (el) el.textContent = `R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        };

        atualizarTexto("totalEntradas", mEntradas);
        atualizarTexto("totalSaidas", mPendentes);
        atualizarTexto("totalGastosDashboard", mGastos);
        atualizarTexto("lucroReal", mLucroReal);
        
        const cardSaldo = document.getElementById("saldoGeralTotal");
        if (cardSaldo) {
            cardSaldo.textContent = `R$ ${saldoGeral.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
            cardSaldo.style.color = saldoGeral < 0 ? 'var(--cor-erro)' : 'var(--cor-primaria-strong)';
        }

        renderizarMovimentacoes(vendasMes, gastosMes);
        atualizarListaHistorica(vendasHisto, gastosHisto);

        // --- RENDERIZAR GRÁFICOS ---
        renderizarGraficos(vendasMes, gastosMes, vendasHisto, gastosHisto);

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

function renderizarMovimentacoes(vendas, gastos) {
    const lista = document.getElementById("listaMovimentacoes");
    if (!lista) return;

    const movs = [
        ...vendas.map(v => ({ t: 'Venda', v: v.valor, d: v.created_at, s: v.status })),
        ...gastos.map(g => ({ t: g.descricao, v: parseFloat(g.valor), d: g.data + 'T12:00:00', s: 'gasto' }))
    ].sort((a, b) => new Date(b.d) - new Date(a.d));

    if (movs.length === 0) {
        lista.innerHTML = '<p style="text-align:center; color:var(--texto-faint); padding: 1rem;">Nenhuma movimentação no mês.</p>';
        return;
    }

    lista.innerHTML = movs.slice(0, 5).map(m => `
        <div class="item-venda" style="margin-bottom: 8px;">
            <span style="color: var(--texto-secundario); font-size: 0.85rem;">${m.t} <br><small style="color: var(--texto-faint);">${formatarData(m.d)}</small></span>
            <span style="color: ${m.s === 'gasto' ? 'var(--cor-erro)' : (m.s === 'pago' ? 'var(--cor-sucesso)' : 'var(--cor-alerta)')}; font-weight: 600;">
                ${m.s === 'gasto' ? '-' : ''} R$ ${parseFloat(m.v || 0).toFixed(2)}
            </span>
        </div>
    `).join('');
}

function atualizarListaHistorica(vendasPagas, todosGastos) {
    const container = document.getElementById("listaLucroMensal");
    if (!container) return;

    const entradas = {};

    vendasPagas.forEach(v => {
        const dataObj = v.created_at ? new Date(v.created_at) : new Date();
        const mesAno = dataObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        entradas[mesAno] = (entradas[mesAno] || 0) + (v.valor || 0);
    });

    const saidas = {};
    todosGastos.forEach(g => {
        const dataObj = new Date(g.data + 'T12:00:00');
        const mesAno = dataObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        saidas[mesAno] = (saidas[mesAno] || 0) + parseFloat(g.valor || 0);
    });

    const mesesLabels = [...new Set([...Object.keys(entradas), ...Object.keys(saidas)])];
    
    if (mesesLabels.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--texto-faint); padding: 1rem;">Sem histórico disponível.</p>';
        return;
    }

    container.innerHTML = mesesLabels.map(mes => {
        const lucro = (entradas[mes] || 0) - (saidas[mes] || 0);
        return `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--borda-cor); padding: 0.8rem 0;">
                <span style="color: var(--texto-secundario); text-transform: capitalize; font-size: 0.85rem;">${mes}</span>
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

function renderizarGraficos(vendasMes, gastosMes, vendasHisto, gastosHisto) {
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
                labels: {
                    color: textoCor,
                    boxWidth: 12,
                    boxHeight: 12,
                    usePointStyle: true
                }
            }
        },
        scales: {
            x: {
                grid: { color: gridCor },
                ticks: { color: textoCor }
            },
            y: {
                grid: { color: gridCor },
                ticks: {
                    color: textoCor,
                    callback: v => 'R$ ' + v
                }
            }
        }
    };

    // --- Gráfico Receitas × Despesas (Barras Mensais) ---
    const ctxRevExp = document.getElementById('chRevExp');
    if (ctxRevExp) {
        // Agrupar vendas pagas por mês (últimos 6 meses)
        const mesesMap = {};
        vendasHisto.forEach(v => {
            if (!v.created_at) return;
            const d = new Date(v.created_at);
            const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            if (!mesesMap[key]) mesesMap[key] = { receita: 0, despesa: 0 };
            mesesMap[key].receita += v.valor || 0;
        });
        gastosHisto.forEach(g => {
            if (!g.data) return;
            const d = new Date(g.data + 'T12:00:00');
            const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            if (!mesesMap[key]) mesesMap[key] = { receita: 0, despesa: 0 };
            mesesMap[key].despesa += parseFloat(g.valor || 0);
        });

        const mesesLabels = Object.keys(mesesMap).slice(-6);
        const receitasVals = mesesLabels.map(m => Math.round(mesesMap[m].receita));
        const despesasVals = mesesLabels.map(m => Math.round(mesesMap[m].despesa));

        charts['chRevExp'] = new Chart(ctxRevExp, {
            type: 'bar',
            data: {
                labels: mesesLabels,
                datasets: [
                    {
                        label: 'Receitas',
                        data: receitasVals,
                        backgroundColor: accentCor,
                        borderRadius: 4
                    },
                    {
                        label: 'Despesas',
                        data: despesasVals,
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

    // --- Gráfico Evolução do Lucro (Linha) ---
    const ctxProfit = document.getElementById('chProfit');
    if (ctxProfit) {
        const mesesMap = {};
        vendasHisto.forEach(v => {
            if (!v.created_at) return;
            const d = new Date(v.created_at);
            const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            if (!mesesMap[key]) mesesMap[key] = { receita: 0, despesa: 0 };
            mesesMap[key].receita += v.valor || 0;
        });
        gastosHisto.forEach(g => {
            if (!g.data) return;
            const d = new Date(g.data + 'T12:00:00');
            const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            if (!mesesMap[key]) mesesMap[key] = { receita: 0, despesa: 0 };
            mesesMap[key].despesa += parseFloat(g.valor || 0);
        });

        const mesesLabels = Object.keys(mesesMap).slice(-6);
        const lucroVals = mesesLabels.map(m => Math.round(mesesMap[m].receita - mesesMap[m].despesa));

        charts['chProfit'] = new Chart(ctxProfit, {
            type: 'line',
            data: {
                labels: mesesLabels,
                datasets: [{
                    label: 'Lucro',
                    data: lucroVals,
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

    // --- Gráfico Donut de Vendas por Produto ---
    const ctxDonut = document.getElementById('chDonut');
    if (ctxDonut) {
        const produtoMap = {};
        vendasMes.forEach(v => {
            const produto = v.descricao || 'Sem descrição';
            produtoMap[produto] = (produtoMap[produto] || 0) + parseFloat(v.valor || 0);
        });

        const produtos = Object.keys(produtoMap);
        const produtoVals = Object.values(produtoMap);
        const palette = [accentCor, '#8b5cf6', posCor, warnCor, '#ec4899', '#64748b', '#14b8a6', '#f97316'];

        if (produtos.length > 0) {
            charts['chDonut'] = new Chart(ctxDonut, {
                type: 'doughnut',
                data: {
                    labels: produtos,
                    datasets: [{
                        data: produtoVals,
                        backgroundColor: palette.slice(0, produtos.length),
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
                            labels: {
                                color: textoCor,
                                boxWidth: 12,
                                boxHeight: 12,
                                usePointStyle: true
                            }
                        }
                    }
                }
            });
        }
    }

    // --- Comparação com o Mês Anterior ---
    renderizarComparacao(vendasMes, gastosMes, vendasHisto, gastosHisto);
}

function renderizarComparacao(vendasMes, gastosMes, vendasHisto, gastosHisto) {
    const insightEl = document.getElementById('insightComparacao');
    const gridEl = document.getElementById('comparacaoGrid');
    if (!insightEl || !gridEl) return;

    // Calcular mês atual e anterior
    let mEntradasAtual = 0, mGastosAtual = 0;
    vendasMes.forEach(v => { if (v.status === 'pago') mEntradasAtual += (v.valor || 0); });
    gastosMes.forEach(g => { mGastosAtual += parseFloat(g.valor || 0); });
    const mLucroAtual = mEntradasAtual - mGastosAtual;

    // Mês anterior
    const agora = new Date();
    const mesAnt = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    const ultimoDiaAnt = new Date(mesAnt.getFullYear(), mesAnt.getMonth() + 1, 0).getDate();
    const inicioAnt = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth()+1).padStart(2,'0')}-01T00:00:00`;
    const fimAnt = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth()+1).padStart(2,'0')}-${ultimoDiaAnt}T23:59:59`;

    // Buscar dados do mês anterior
    const vendasAnt = vendasHisto.filter(v => {
        if (!v.created_at) return false;
        const d = new Date(v.created_at);
        return d >= new Date(inicioAnt) && d <= new Date(fimAnt);
    });
    const gastosAnt = gastosHisto.filter(g => {
        if (!g.data) return false;
        const d = new Date(g.data + 'T12:00:00');
        return d >= new Date(inicioAnt + 'T12:00:00') && d <= new Date(fimAnt + 'T12:00:00');
    });

    let mEntradasAnt = 0, mGastosAnt = 0;
    vendasAnt.forEach(v => { mEntradasAnt += v.valor || 0; });
    gastosAnt.forEach(g => { mGastosAnt += parseFloat(g.valor || 0); });
    const mLucroAnt = mEntradasAnt - mGastosAnt;

    const mesesPT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const mesAtualLabel = mesesPT[agora.getMonth()];
    const mesAntLabel = mesesPT[mesAnt.getMonth()];

    if (mLucroAnt === 0 && mLucroAtual === 0) {
        insightEl.innerHTML = '<i data-lucide="info"></i><div>Dados insuficientes para comparação entre meses.</div>';
        if (window.lucide) lucide.createIcons();
        gridEl.innerHTML = '';
        return;
    }

    const variacao = mLucroAnt > 0 ? ((mLucroAtual / mLucroAnt - 1) * 100) : (mLucroAtual > 0 ? 100 : 0);
    const variacaoReceita = mEntradasAnt > 0 ? ((mEntradasAtual / mEntradasAnt - 1) * 100) : 0;
    const margemAtual = mEntradasAtual > 0 ? (mLucroAtual / mEntradasAtual * 100) : 0;
    const margemAnt = mEntradasAnt > 0 ? (mLucroAnt / mEntradasAnt * 100) : 0;

    const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    const fmtBRL = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0 });

    insightEl.innerHTML = `
        <i data-lucide="info"></i>
        <div>
            Sua receita cresceu <strong>${fmtPct(variacaoReceita)}</strong> e seu lucro
            <strong>${fmtPct(variacao)}</strong> em relação a ${mesAntLabel}.
            A margem de lucro passou de <strong>${margemAnt.toFixed(1)}%</strong> para <strong>${margemAtual.toFixed(1)}%</strong>.
        </div>
    `;

    gridEl.innerHTML = `
        <div class="goal-stat">
            <div class="g-label">${mesAntLabel}</div>
            <div class="g-value">${fmtBRL(mLucroAnt)}</div>
        </div>
        <div class="goal-stat">
            <div class="g-label">${mesAtualLabel}</div>
            <div class="g-value pos">${fmtBRL(mLucroAtual)}</div>
        </div>
        <div class="goal-stat">
            <div class="g-label">Variação</div>
            <div class="g-value ${variacao >= 0 ? 'pos' : 'neg'}">${fmtPct(variacao)} (${fmtBRL(mLucroAtual - mLucroAnt)})</div>
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

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
        mostrarModal('Faça login', 'Por favor, faça login para acessar seus relatórios.');
        setTimeout(() => { window.location.href = "login.html"; }, 2000);
        return;
    }

    const urlStreamlit = "https://project-mei-app-dw-e5jih2p8ek6plegymc93ot.streamlit.app/"; 
    const linkFinal = `${urlStreamlit}?user_id=${user.id}`;
    window.open(linkFinal, '_blank');
}