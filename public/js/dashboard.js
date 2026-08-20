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
            if (saudacaoElem) saudacaoElem.textContent = `Olá, ${primeiroNome}!`;
            
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
            cardSaldo.style.color = saldoGeral < 0 ? 'var(--cor-erro)' : 'var(--cor-sucesso)';
        }

        renderizarMovimentacoes(vendasMes, gastosMes);
        atualizarListaHistorica(vendasHisto, gastosHisto);

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
        lista.innerHTML = '<p style="text-align:center; color:var(--texto-secundario); padding: 1rem;">Nenhuma movimentação no mês.</p>';
        return;
    }

    lista.innerHTML = movs.slice(0, 5).map(m => `
        <div class="item-venda">
            <span>${m.t} <br><small>${formatarData(m.d)}</small></span>
            <span style="color: ${m.s === 'gasto' ? 'var(--cor-erro)' : (m.s === 'pago' ? 'var(--cor-sucesso)' : 'orange')}">
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
        container.innerHTML = '<p style="text-align:center; color:var(--texto-secundario); padding: 1rem;">Sem histórico disponível.</p>';
        return;
    }

    container.innerHTML = mesesLabels.map(mes => {
        const lucro = (entradas[mes] || 0) - (saidas[mes] || 0);
        return `
            <div class="lucro-mes-item" style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--borda-cor); padding: 0.8rem 0;">
                <span style="text-transform: capitalize;">${mes}</span>
                <span style="color: ${lucro >= 0 ? 'var(--cor-sucesso)' : 'var(--cor-erro)'}; font-weight: 700;">
                    R$ ${lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
            </div>
        `;
    }).join('');
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