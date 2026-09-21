const SESSION_KEY = 'finmei_admin_session';
let supabase = null;

document.addEventListener('DOMContentLoaded', () => {
  supabase = window.finmeiSupabase;
});

/* Sessão e autenticação */

let SESSION = null;

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  supabase?.auth.signOut();
  location.href = 'admin-login.html';
}

// Protege o painel e exige usuário administrador.
async function requireAdmin() {
  if (!supabase) {
    location.href = 'admin-login.html';
    return false;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    location.href = 'admin-login.html';
    return false;
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;

    const { data: profile, error: profileError } = await supabase
      .from('perfis')
      .select('nome_completo, email, role')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    if (profile.role !== 'admin') {
      logout();
      return false;
    }

    SESSION = { token: session.access_token, user: { ...user, ...profile } };

    const n = document.getElementById('adminName');
    if (n) n.textContent = profile.nome_completo || user.email;

    const i = document.getElementById('adminInitial');
    if (i) i.textContent = (profile.nome_completo || user.email).charAt(0).toUpperCase();

    return true;
  } catch (e) {
    return false;
  }
}

// Login do administrador.
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');

  if (!email || !pass) {
    msg.className = 'form-msg err';
    msg.textContent = 'Informe e-mail e senha.';
    return;
  }

  msg.className = 'form-msg';
  msg.textContent = 'Entrando...';

  try {
    if (!supabase) throw new Error('Supabase não foi carregado.');

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pass
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await supabase
      .from('perfis')
      .select('nome_completo, email, role')
      .eq('id', data.user.id)
      .single();

    if (profileError || profile?.role !== 'admin') {
      await supabase.auth.signOut();
      msg.className = 'form-msg err';
      msg.textContent = 'Acesso bloqueado. Esta conta não possui permissão de administrador.';
      return;
    }

    SESSION = {
      token: data.session.access_token,
      user: { ...data.user, ...profile }
    };

    saveSession(SESSION);
    location.href = 'admin.html';
  } catch (e) {
    msg.className = 'form-msg err';
    msg.textContent = e.message || 'Credenciais inválidas.';
  }
}

/* Helpers */

const brl = v =>
  v == null
    ? '—'
    : v.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });

const pct = v =>
  v.toLocaleString('pt-BR', {
    maximumFractionDigits: 1
  }) + '%';

const subStatusLabel = {
  active: 'Ativa',
  expired: 'Expirada',
  blocked: 'Bloqueada',
  trial: 'Teste'
};

const payStatusLabel = {
  approved: 'Aprovado',
  pending: 'Pendente',
  refused: 'Recusado',
  cancelled: 'Cancelado',
  rejected: 'Recusado',
  refunded: 'Cancelado',
  charged_back: 'Cancelado',
  in_process: 'Pendente'
};

function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;

  t.textContent = msg;
  t.className = type;
  t.style.opacity = '1';

  clearTimeout(t._h);
  t._h = setTimeout(() => {
    t.style.opacity = '0';
  }, 2600);
}

function statusPill(cls, label) {
  // Antes: .replace(/^s/, ''), que removia o primeiro "s" de
  // qualquer valor — 'success' virava 'st-uccess'. Só o prefixo
  // legado "s-" deve sair.
  const statusClass = String(cls).replace(/^s-/, '');
  return `<span class="status st-${statusClass}">${label}</span>`;
}

function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* Modal */

function openModal() {
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

window._confirmFn = null;
function confirmAction(title, text, confirmLabel, fn) {
  window._confirmFn = fn;
  document.getElementById('modalTitle').textContent = title;

  document.getElementById('modalBody').innerHTML = `
    <div class="confirm-text">${text}</div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="closeModal();window._confirmFn()">${confirmLabel}</button>
    </div>
  `;

  openModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const ov = document.getElementById('modalOverlay');

  if (ov) {
    ov.addEventListener('click', e => {
      if (e.target.id === 'modalOverlay') closeModal();
    });
  }
});

/* Gráficos */

let charts = {};

function destroyCharts() {
  Object.values(charts).forEach(c => c && c.destroy());
  charts = {};
}

const cv = () => getComputedStyle(document.documentElement);
const ctext = () => cv().getPropertyValue('--text-faint');
const cgrid = () => cv().getPropertyValue('--border');
const csurf = () => cv().getPropertyValue('--surface');
const caccent = () => cv().getPropertyValue('--accent');
const cpos = () => cv().getPropertyValue('--positive');
const cneg = () => cv().getPropertyValue('--negative');

const baseOpts = e =>
  Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: ctext(),
          boxWidth: 12,
          boxHeight: 12,
          usePointStyle: true
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: cgrid()
        },
        ticks: {
          color: ctext()
        }
      },
      y: {
        grid: {
          color: cgrid()
        },
        ticks: {
          color: ctext()
        }
      }
    }
  }, e);

function mk(id, cfg) {
  const el = document.getElementById(id);

  if (el) {
    charts[id] = new Chart(el, cfg);
  }
}

function makeRevChart(labels, data) {
  mk('chRev', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data,
        borderColor: caccent(),
        backgroundColor: caccent(),
        tension: .35,
        fill: true,
        pointRadius: 3,
        borderWidth: 2
      }]
    },
    options: baseOpts({
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: ctext()
          }
        },
        y: {
          grid: {
            color: cgrid()
          },
          ticks: {
            color: ctext(),
            callback: v => 'R$ ' + v
          }
        }
      }
    })
  });
}

function makeUsersChart(labels, data) {
  mk('chUsers', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Usuários',
        data,
        backgroundColor: caccent(),
        borderRadius: 4
      }]
    },
    options: baseOpts({
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: ctext()
          }
        },
        y: {
          grid: {
            color: cgrid()
          },
          ticks: {
            color: ctext(),
            precision: 0
          }
        }
      }
    })
  });
}

function makeSubsChart(labels, data) {
  mk('chSubs', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [cpos(), cneg()],
        borderColor: csurf(),
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: ctext(),
            boxWidth: 12,
            usePointStyle: true
          }
        }
      }
    }
  });
}

function makePlansChart(labels, data) {
  mk('chPlans', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [caccent(), '#8b5cf6', '#22c55e', '#64748b'],
        borderColor: csurf(),
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: ctext(),
            boxWidth: 12,
            usePointStyle: true
          }
        }
      }
    }
  });
}

/* Navegação */

const contentEl = document.getElementById('content');

const TITLES = {
  dashboard: ['Dashboard', 'Visão geral do sistema'],
  usuarios: ['Usuários', 'Gerencie os usuários cadastrados'],
  assinaturas: ['Assinaturas', 'Gerencie as assinaturas do sistema'],
  pagamentos: ['Pagamentos', 'Acompanhe os pagamentos realizados'],
  contas: ['Contas Financeiras', 'Gerencie contas de todos os usuários'],
  gateway: ['Configurações de pagamento', 'Integração com o Mercado Pago'],
  planos: ['Planos e limites', 'Limites de uso por plano'],
  iaconfig: ['Configuração de IA', 'Provedores, limites e uso da inteligência artificial'],
};

const navItems = document.querySelectorAll('.nav-item[data-page]');

function navigate(page) {
  navItems.forEach(a => {
    a.classList.toggle('active', a.getAttribute('data-page') === page);
  });

  const [t, s] = TITLES[page] || TITLES.dashboard;

  document.getElementById('pageTitle').textContent = t;
  document.getElementById('pageSub').textContent = s;

  renderPage(page);
  closeSidebar();
  window.scrollTo(0, 0);
}

navItems.forEach(a => {
  a.addEventListener('click', () => {
    navigate(a.getAttribute('data-page'));
  });
});

function renderPage(page) {
  destroyCharts();

  const reg = {
    dashboard: renderDashboard,
    usuarios: renderUsuarios,
    assinaturas: renderAssinaturas,
    pagamentos: renderPagamentos,
    contas: renderContas,
    gateway: renderGateway,
    planos: renderPlanoLimites,
    iaconfig: renderAIConfig,
  };

  reg[page]();
}

/* Dashboard */

async function loadAdminDashboard() {
  const [profilesResult, salesResult, expensesResult] = await Promise.all([
    supabase.from('perfis').select('id, nome_completo, email, plano, criado_em, expira_em, role'),
    supabase.from('vendas').select('user_id, valor, status, created_at'),
    supabase.from('despesas').select('user_id, valor, data')
  ]);

  const firstError = profilesResult.error || salesResult.error || expensesResult.error;
  if (firstError) throw firstError;

  const profiles = profilesResult.data || [];
  const sales = salesResult.data || [];
  const expenses = expensesResult.data || [];
  const approvedSales = sales.filter(s => s.status === 'pago' || s.status === 'recebido');
  const revenue = approvedSales.reduce((sum, sale) => sum + Number(sale.valor || 0), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.valor || 0), 0);
  const activeProfiles = profiles.filter(profile =>
    profile.plano === 'premium' &&
    profile.expira_em &&
    new Date(profile.expira_em) >= new Date()
  );
  const premiumProfiles = profiles.filter(profile => profile.plano === 'premium');
  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];

  return {
    totalUsers: profiles.length,
    activeSubs: activeProfiles.length,
    expiredSubs: Math.max(premiumProfiles.length - activeProfiles.length, 0),
    revenue,
    totalSubRev: revenue,
    totalPayments: approvedSales.length,
    revByMonth: monthLabels.map(() => 0),
    usersByMonth: monthLabels.map(() => 0),
    planCounts: Object.entries(profiles.reduce((counts, profile) => {
      const plan = profile.plano || 'gratuito';
      counts[plan] = (counts[plan] || 0) + 1;
      return counts;
    }, {})).map(([plan_name, c]) => ({ plan_name, c })),
    userRevenue: profiles.map(profile => ({
      user_id: profile.id,
      name: profile.nome_completo || profile.email || 'Sem nome',
      plan_name: profile.plano || 'gratuito',
      status: subscriptionFromProfile(profile).status,
      value: 0,
      rev: approvedSales
        .filter(sale => sale.user_id === profile.id)
        .reduce((sum, sale) => sum + Number(sale.valor || 0), 0)
    })),
    expenseTotal
  };
}

async function renderDashboard() {
  contentEl.innerHTML = '<div class="loading">Carregando dashboard...</div>';

  try {
    const d = await loadAdminDashboard();

    const monthLabels = ['Jan/25', 'Fev/25', 'Mar/25', 'Abr/25', 'Mai/25', 'Jun/25'];
    const activeSubs = d.activeSubs;
    const expiredSubs = d.expiredSubs;
    const appPays = d.totalPayments;

    contentEl.innerHTML = `
      <div class="grid grid-4">
        <div class="card metric-card m-acc">
          <div class="metric-label">Usuários cadastrados</div>
          <div class="metric-value">${d.totalUsers}</div>
          <div class="metric-foot">Contas registradas no sistema</div>
        </div>

        <div class="card metric-card m-pos">
          <div class="metric-label">Assinaturas ativas</div>
          <div class="metric-value">${activeSubs}</div>
          <div class="metric-foot">Inclui período de teste</div>
        </div>

        <div class="card metric-card m-neg">
          <div class="metric-label">Assinaturas expiradas</div>
          <div class="metric-value">${expiredSubs}</div>
          <div class="metric-foot">Fora do período vigente</div>
        </div>

        <div class="card metric-card m-acc">
          <div class="metric-label">Faturamento geral</div>
          <div class="metric-value">${brl(d.revenue)}</div>
          <div class="metric-foot">Pagamentos aprovados</div>
        </div>

        <div class="card metric-card m-pos">
          <div class="metric-label">Recebido via assinaturas</div>
          <div class="metric-value">${brl(d.totalSubRev)}</div>
          <div class="metric-foot">Receita recorrente estimada</div>
        </div>

        <div class="card metric-card m-acc">
          <div class="metric-label">Pagamentos realizados</div>
          <div class="metric-value">${appPays}</div>
          <div class="metric-foot">Total de transações</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card chart-card">
          <div class="chart-head">
            <div class="chart-title">Faturamento ao longo do tempo</div>
          </div>
          <div class="chart-box">
            <canvas id="chRev"></canvas>
          </div>
        </div>

        <div class="card chart-card">
          <div class="chart-head">
            <div class="chart-title">Usuários cadastrados</div>
          </div>
          <div class="chart-box">
            <canvas id="chUsers"></canvas>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card chart-card">
          <div class="chart-head">
            <div class="chart-title">Assinaturas ativas × expiradas</div>
          </div>
          <div class="chart-box">
            <canvas id="chSubs"></canvas>
          </div>
        </div>

        <div class="card chart-card">
          <div class="chart-head">
            <div class="chart-title">Distribuição das assinaturas por plano</div>
          </div>
          <div class="chart-box">
            <canvas id="chPlans"></canvas>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="chart-head">
          <div class="chart-title">Receita gerada por usuário</div>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Plano</th>
                <th>Status</th>
                <th class="num">Valor da assinatura</th>
                <th class="num">Receita gerada</th>
              </tr>
            </thead>
            <tbody>
              ${d.userRevenue.map(r => `
                <tr class="row-click" onclick="openUser(${r.user_id})">
                  <td class="cell-strong">${esc(r.name)}</td>
                  <td>${esc(r.plan_name)}</td>
                  <td>${statusPill('s' + r.status, subStatusLabel[r.status] || r.status)}</td>
                  <td class="num">${brl(r.value)}</td>
                  <td class="num ${r.rev > 0 ? 'pos' : ''}">${brl(r.rev)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    makeRevChart(monthLabels, d.revByMonth);
    makeUsersChart(monthLabels, d.usersByMonth);
    makeSubsChart(['Ativas', 'Expiradas'], [activeSubs, expiredSubs]);
    makePlansChart(
      d.planCounts.map(x => x.plan_name),
      d.planCounts.map(x => x.c)
    );
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message || 'Erro ao carregar dashboard.')}</div>`;
  }
}

/* Usuários */

let userSearch = '';
let userFilterPlan = '';
let PLANS = [];

async function loadPlans() {
  PLANS = [
    { id: 'gratuito', name: 'Gratuito', price: 0 },
    { id: 'premium', name: 'Premium', price: 15.90 }
  ];
}

function dateLabel(value) {
  if (!value) return '—';
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return date.toLocaleDateString('pt-BR');
}

function subscriptionFromProfile(profile) {
  const plan = String(profile.plano || 'gratuito').toLowerCase();
  const dateOnly = String(profile.expira_em || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const expires = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59)
    : (profile.expira_em ? new Date(profile.expira_em) : null);
  const expired = expires && expires < new Date();
  const status = profile.assinatura_status === 'blocked'
    ? 'blocked'
    : (profile.assinatura_status === 'expired' || (plan === 'premium' && expired)
    ? 'expired'
    : (plan === 'premium'
      ? 'active'
      : (profile.assinatura_status || 'trial')));

  return {
    plan,
    value: planPrice(plan),
    status,
    start: dateLabel(profile.criado_em),
    end: dateLabel(profile.expira_em)
  };
}

async function loadAdminUsers() {
  let query = supabase
    .from('perfis')
    .select('id, nome_completo, email, plano, criado_em, expira_em, role, assinatura_status, ai_daily_limit')
    .order('criado_em', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  const today = new Date().toISOString().split('T')[0];
  const ids = (data || []).map(profile => profile.id);
  const [{ data: usage }, { data: limits }] = await Promise.all([
    ids.length ? supabase.from('ai_usage').select('user_id, messages_used').in('user_id', ids).eq('usage_date', today) : { data: [] },
    supabase.from('ai_limits').select('plan_type, daily_messages')
  ]);
  const usageByUser = new Map((usage || []).map(row => [row.user_id, row.messages_used || 0]));
  const limitByPlan = new Map((limits || []).map(row => [row.plan_type, row.daily_messages]));

  return (data || []).map(profile => ({
    id: profile.id,
    name: profile.nome_completo || profile.email || 'Sem nome',
    email: profile.email || '—',
    role: profile.role || 'user',
    created: dateLabel(profile.criado_em),
    sub: subscriptionFromProfile(profile),
    aiUsed: usageByUser.get(profile.id) || 0,
    aiLimit: profile.ai_daily_limit ?? limitByPlan.get(profile.plano) ?? 10,
    lastPay: null
  }));
}

const planName = id =>
  PLANS.find(p => p.id === id)?.name || id || '—';

const planPrice = id =>
  PLANS.find(p => p.id === id)?.price || 0;

function filterUsers(users) {
  let result = users;
  if (userSearch) {
    const q = userSearch.toLowerCase();
    result = result.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }
  if (userFilterPlan) {
    result = result.filter(u => u.sub.plan === userFilterPlan);
  }
  return result;
}

function userTableRows(users) {
  if (!users.length) {
    return `<tr><td colspan="11" style="text-align:center;color:var(--text-faint);padding:30px">Nenhum usuário encontrado.</td></tr>`;
  }
  return users.map(u => {
    const s = u.sub;
    const lp = u.lastPay;
    const payCls = lp ? 's' + lp.status : 's-cancelled';
    const payLbl = lp ? payStatusLabel[lp.status] || lp.status : '—';
    return `
      <tr class="row-click" onclick="openUser('${u.id}')">
        <td class="cell-strong">${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>${u.created}</td>
        <td>${s ? esc(planName(s.plan)) : '—'}</td>
        <td class="num">${s ? brl(s.value) : '—'}</td>
        <td>${s ? statusPill('s' + s.status, subStatusLabel[s.status] || s.status) : '—'}</td>
        <td>${s ? s.start : '—'}</td>
        <td>${s ? s.end : '—'}</td>
        <td>${statusPill(payCls, payLbl)}</td>
        <td class="num">${u.aiUsed}/${u.aiLimit}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openUser('${u.id}')">Detalhes</button>
        </td>
      </tr>
    `;
  }).join('');
}

let allUsersCache = [];

function updateUsersTable() {
  const filtered = filterUsers(allUsersCache);
  const tbody = document.querySelector('#usuariosTable tbody');
  if (tbody) tbody.innerHTML = userTableRows(filtered);
  const desc = document.getElementById('usuariosDesc');
  if (desc) desc.textContent = `${filtered.length} usuário(s) encontrado(s). Clique em um usuário para ver os detalhes.`;
}

function onUserSearch(value) {
  userSearch = value;
  updateUsersTable();
  const input = document.getElementById('userSearchInput');
  if (input) { input.focus(); input.selectionStart = input.selectionEnd = value.length; }
}

function onUserFilterPlan(value) {
  userFilterPlan = value;
  updateUsersTable();
}

async function renderUsuarios() {
  contentEl.innerHTML = '<div class="loading">Carregando usuários...</div>';

  try {
    allUsersCache = await loadAdminUsers();
    const users = filterUsers(allUsersCache);

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Usuários</div>
          <div class="page-desc" id="usuariosDesc">
            ${users.length} usuário(s) encontrado(s). Clique em um usuário para ver os detalhes.
          </div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7"/>
            <path stroke-linecap="round" d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            id="userSearchInput"
            placeholder="Buscar por nome ou e-mail..."
            value="${esc(userSearch)}"
            oninput="onUserSearch(this.value)"
          >
        </div>
        <select onchange="onUserFilterPlan(this.value)">
          <option value="">Todos os planos</option>
          ${PLANS.map(p => `
            <option value="${p.id}" ${userFilterPlan === p.id ? 'selected' : ''}>
              ${esc(p.name)}
            </option>
          `).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="openNovoUsuario()" style="margin-left:auto">
          + Novo usuário
        </button>
      </div>

      <div class="table-wrap table-scroll" id="usuariosTable">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Cadastro</th>
              <th>Plano</th>
              <th class="num">Valor</th>
              <th>Status assinatura</th>
              <th>Início</th>
              <th>Expiração</th>
              <th>Status pagamento</th>
              <th class="num">IA hoje</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>${userTableRows(users)}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

function openNovoUsuario() {
  document.getElementById('modalTitle').textContent = 'Novo usuário';

  document.getElementById('modalBody').innerHTML = `
    <div class="confirm-text">Preencha os dados para cadastrar um novo usuário.</div>

    <div class="field">
      <label>Nome</label>
      <input id="nuNome" placeholder="Nome completo">
    </div>

    <div class="field">
      <label>E-mail</label>
      <input id="nuEmail" type="email" placeholder="email@exemplo.com">
    </div>

    <div class="field">
      <label>Senha</label>
      <input id="nuPass" type="password" placeholder="••••••••">
    </div>

    <div class="field">
      <label>Papel</label>
      <select id="nuRole">
        <option value="user">Usuário comum</option>
        <option value="admin">Administrador</option>
      </select>
    </div>

    <div class="field">
      <label>Plano inicial</label>
      <select id="nuPlan">
        ${PLANS.map(p => `
          <option value="${p.id}">
            ${esc(p.name)} — ${p.price > 0 ? brl(p.price) + '/mês' : 'R$ 0'}
          </option>
        `).join('')}
      </select>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="criarUsuario()">Cadastrar usuário</button>
    </div>
  `;

  openModal();
}

async function criarUsuario() {
  const name = document.getElementById('nuNome').value.trim();
  const email = document.getElementById('nuEmail').value.trim();
  const password = document.getElementById('nuPass').value;
  const role = document.getElementById('nuRole').value;
  const plan = document.getElementById('nuPlan').value;

  if (!name || !email || !password) {
    toast('Preencha nome, e-mail e senha.', 'err');
    return;
  }

  try {
    const { error } = await supabase.functions.invoke('admin-users', {
      body: { name, email, password, role, plan }
    });
    if (error) throw error;

    closeModal();
    toast('Usuário criado com sucesso.');
    renderUsuarios();
  } catch (e) {
    toast(e.message || 'Erro ao criar usuário.', 'err');
  }
}

async function openUser(id) {
  contentEl.innerHTML = '<div class="loading">Carregando usuário...</div>';

  try {
    const [{ data: profile, error: profileError }, { data: payments, error: paymentsError }] = await Promise.all([
      supabase.from('perfis').select('id, nome_completo, email, plano, criado_em, expira_em, role, assinatura_status, ai_daily_limit').eq('id', id).single(),
      supabase.from('pagamentos').select('payment_id, valor, criado_em, status, gateway').eq('user_id', id).order('criado_em', { ascending: false })
    ]);

    if (profileError || paymentsError) throw profileError || paymentsError;

    const today = new Date().toISOString().split('T')[0];
    const [{ data: usage }, { data: planLimit }] = await Promise.all([
      supabase.from('ai_usage').select('messages_used').eq('user_id', id).eq('usage_date', today).maybeSingle(),
      supabase.from('ai_limits').select('daily_messages').eq('plan_type', profile.plano || 'gratuito').maybeSingle()
    ]);

    const u = {
      id: profile.id,
      name: profile.nome_completo || profile.email || 'Sem nome',
      email: profile.email || '—',
      role: profile.role || 'user',
      created: dateLabel(profile.criado_em),
      sub: subscriptionFromProfile(profile),
      aiUsed: usage?.messages_used || 0,
      aiPlanLimit: planLimit?.daily_messages || 10,
      aiLimit: profile.ai_daily_limit ?? planLimit?.daily_messages ?? 10,
      payments: (payments || []).map(payment => ({
        tx: payment.payment_id,
        value: Number(payment.valor || 0),
        date: dateLabel(payment.criado_em),
        status: payment.status === 'authorized' ? 'approved' : payment.status,
        gateway: payment.gateway
      }))
    };
    const s = u.sub;
    const pl = s ? planName(s.plan) : '—';
    const pays = u.payments || [];
    const lastPay = pays[0] || null;

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div>
            <a class="btn btn-secondary btn-sm" onclick="renderUsuarios()">← Voltar</a>
          </div>

          <div class="page-title" style="margin-top:10px">
            ${esc(u.name)}
          </div>

          <div class="page-desc">${esc(u.email)}</div>
        </div>

        <button
          class="btn btn-danger btn-sm"
          onclick="confirmAction(
            'Excluir usuário',
            'Deseja realmente excluir o usuário <b>${esc(u.name)}</b>? Essa ação não poderá ser desfeita.',
            'Excluir',
            () => delUser('${u.id}')
          )"
        >
          Excluir usuário
        </button>
      </div>

      <div class="detail-grid">
        <div class="card detail-card">
          <h4>Dados do usuário</h4>

          <div class="d-row">
            <span class="k">Nome</span>
            <span class="v">${esc(u.name)}</span>
          </div>

          <div class="d-row">
            <span class="k">E-mail</span>
            <span class="v">${esc(u.email)}</span>
          </div>

          <div class="d-row">
            <span class="k">Papel</span>
            <span class="v">${u.role === 'admin' ? 'Administrador' : 'Usuário comum'}</span>
          </div>

          <div class="d-row">
            <span class="k">Data de cadastro</span>
            <span class="v">${u.created}</span>
          </div>
        </div>

        <div class="card detail-card">
          <h4>Assinatura atual</h4>

          ${s ? `
            <div class="d-row">
              <span class="k">Plano</span>
              <span class="v">${esc(pl)}</span>
            </div>

            <div class="d-row">
              <span class="k">Valor</span>
              <span class="v">${brl(s.value)}</span>
            </div>

            <div class="d-row">
              <span class="k">Status</span>
              <span class="v">${statusPill('s' + s.status, subStatusLabel[s.status] || s.status)}</span>
            </div>

            <div class="d-row">
              <span class="k">Início</span>
              <span class="v">${s.start}</span>
            </div>

            <div class="d-row">
              <span class="k">Expiração</span>
              <span class="v">${s.end}</span>
            </div>
          ` : `
            <div style="color:var(--text-faint)">Sem assinatura.</div>
          `}
        </div>

        <div class="card detail-card">
          <h4>Uso da IA hoje</h4>
          <div class="d-row">
            <span class="k">Mensagens usadas</span>
            <span class="v">${u.aiUsed}</span>
          </div>
          <div class="d-row">
            <span class="k">Limite efetivo</span>
            <span class="v">${u.aiUsed}/${u.aiLimit}</span>
          </div>
          <div class="d-row">
            <span class="k">Limite do plano</span>
            <span class="v">${u.aiPlanLimit}</span>
          </div>
          <div class="d-row">
            <span class="k">Personalizado</span>
            <span class="v">${profile.ai_daily_limit === null ? 'Não' : 'Sim'}</span>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card detail-card">
          <h4>Última transação</h4>

          ${lastPay ? `
            <div class="d-row">
              <span class="k">Transação</span>
              <span class="v">${esc(lastPay.tx)}</span>
            </div>

            <div class="d-row">
              <span class="k">Valor</span>
              <span class="v">${brl(lastPay.value)}</span>
            </div>

            <div class="d-row">
              <span class="k">Data</span>
              <span class="v">${lastPay.date}</span>
            </div>

            <div class="d-row">
              <span class="k">Status</span>
              <span class="v">${statusPill('s' + lastPay.status, payStatusLabel[lastPay.status] || lastPay.status)}</span>
            </div>

            <div class="d-row">
              <span class="k">Gateway</span>
              <span class="v">${esc(lastPay.gateway)}</span>
            </div>
          ` : `
            <div style="color:var(--text-faint)">Nenhum pagamento registrado.</div>
          `}
        </div>

        <div class="card detail-card">
          <h4>Histórico de pagamentos</h4>

          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th class="num">Valor</th>
                  <th>Status</th>
                  <th>Transação</th>
                </tr>
              </thead>

              <tbody>
                ${pays.map(p => `
                  <tr>
                    <td>${p.date}</td>
                    <td class="num">${brl(p.value)}</td>
                    <td>${statusPill('s' + p.status, payStatusLabel[p.status] || p.status)}</td>
                    <td>${esc(p.tx)}</td>
                  </tr>
                `).join('') || `
                  <tr>
                    <td colspan="4" style="color:var(--text-faint)">Sem pagamentos.</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px">
          Gerenciar assinatura
        </h4>

        <div class="action-list">
          <button class="btn btn-secondary btn-sm" onclick="openEdit('plano','${u.id}')">
            Alterar plano
          </button>

          ${s && s.plan === 'premium' ? `
            <button class="btn btn-secondary btn-sm" onclick="openEdit('expiracao','${u.id}')">
              Alterar expiração
            </button>
          ` : ''}

          <button class="btn btn-secondary btn-sm" onclick="openEdit('ia_limite','${u.id}')">
            Alterar limite da IA
          </button>

          ${s && s.status !== 'blocked' ? `
            <button
              class="btn btn-danger btn-sm"
              onclick="confirmAction(
                'Bloquear assinatura',
                'Bloquear a assinatura de <b>${esc(u.name)}</b>?',
                'Bloquear',
                () => setStatus('${u.id}','blocked')
              )"
            >
              Bloquear
            </button>
          ` : ''}

          ${s && s.status !== 'expired' ? `
            <button
              class="btn btn-danger btn-sm"
              onclick="confirmAction(
                'Desativar assinatura',
                'Desativar (expirar) a assinatura de <b>${esc(u.name)}</b>?',
                'Desativar',
                () => setStatus('${u.id}','expired')
              )"
            >
              Desativar
            </button>
          ` : ''}
        </div>

      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

function openEdit(kind, userId) {
  const u = null;
  let inner = '';
  let title = '';

  if (kind === 'plano') {
    title = 'Alterar plano';

    inner = `
      <div class="confirm-text">Alterar o plano do usuário.</div>

      <div class="field">
        <label>Novo plano</label>
        <select id="editPlan">
          ${PLANS.map(p => `
            <option value="${p.id}">
              ${esc(p.name)} — ${p.price > 0 ? brl(p.price) + '/mês' : 'R$ 0'}
            </option>
          `).join('')}
        </select>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="applyEdit('plano','${userId}')">
          Salvar alteração
        </button>
      </div>
    `;
  } else if (kind === 'expiracao') {
    title = 'Alterar expiração';

    inner = `
      <div class="confirm-text">
        Alterar a data de expiração da assinatura (dd/mm/aaaa).
      </div>

      <div class="field">
        <label>Nova data de expiração</label>
        <input id="editEnd" type="date">
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="applyEdit('expiracao','${userId}')">
          Salvar alteração
        </button>
      </div>
    `;
  } else if (kind === 'ia_limite') {
    title = 'Alterar limite da IA';

    inner = `
      <div class="confirm-text">Defina o máximo de mensagens que este usuário pode enviar por dia.</div>

      <div class="field">
        <label>Mensagens por dia</label>
        <input id="editAiLimit" type="number" min="0" max="9999" placeholder="Usar limite do plano">
        <small style="display:block;margin-top:6px;color:var(--text-faint)">Deixe vazio para usar o limite definido pelo plano.</small>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="applyEdit('ia_limite','${userId}')">
          Salvar alteração
        </button>
      </div>
    `;
  }

  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = inner;

  openModal();
}

async function applyEdit(kind, userId) {
  let body = {};

  if (kind === 'plano') {
    const sel = document.getElementById('editPlan');
    body.plan = sel.value;
    body.value = planPrice(sel.value);
  } else if (kind === 'expiracao') {
    body.end = document.getElementById('editEnd').value;
  } else if (kind === 'ia_limite') {
    const value = document.getElementById('editAiLimit').value.trim();
    if (value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 9999)) {
      toast('Informe um limite inteiro entre 0 e 9999, ou deixe vazio.', 'err');
      return;
    }
    body.ai_daily_limit = value === '' ? null : Number(value);
  }

  closeModal();

  try {
    if (kind === 'expiracao') {
      const { data: profile, error: profileError } = await supabase
        .from('perfis')
        .select('plano')
        .eq('id', userId)
        .single();
      if (profileError) throw profileError;
      if (profile.plano !== 'premium') {
        toast('A expiração só pode ser alterada para usuários premium.', 'err');
        openUser(userId);
        return;
      }
    }

    const profileUpdate = {};
    if (kind === 'plano') {
      profileUpdate.plano = body.plan;
      profileUpdate.assinatura_status = body.plan === 'premium' ? 'active' : 'trial';
    }
    if (kind === 'expiracao') profileUpdate.expira_em = body.end;
    if (kind === 'ia_limite') profileUpdate.ai_daily_limit = body.ai_daily_limit;

    const { error } = await supabase.from('perfis').update(profileUpdate).eq('id', userId);
    if (error) throw error;

    toast('Alteração realizada com sucesso.');
    await openUser(userId);
  } catch (e) {
    toast(e.message || 'Erro ao salvar.', 'err');
    await openUser(userId);
  }
}

async function setStatus(userId, status) {
  try {
    const { error } = await supabase
      .from('perfis')
      .update({ assinatura_status: status })
      .eq('id', userId);
    if (error) throw error;

    toast('Assinatura atualizada.');
    await openUser(userId);
  } catch (e) {
    toast(e.message || 'Erro ao atualizar.', 'err');
    await openUser(userId);
  }
}

async function delUser(userId) {
  try {
    const { error } = await supabase.functions.invoke('admin-users', {
      method: 'DELETE',
      body: { id: userId }
    });
    if (error) throw error;

    toast('Usuário excluído.');
    renderUsuarios();
  } catch (e) {
    toast(e.message || 'Erro ao excluir.', 'err');
  }
}

/* Assinaturas */

let subSearch = '';
let subFilterStatus = '';

function filterSubs(subs) {
  let result = subs;
  if (subSearch) {
    const q = subSearch.toLowerCase();
    result = result.filter(s => s.name.toLowerCase().includes(q));
  }
  if (subFilterStatus) {
    result = result.filter(s => s.status === subFilterStatus);
  }
  return result;
}

function subTableRows(subs) {
  if (!subs.length) {
    return `<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:30px">Nenhuma assinatura encontrada.</td></tr>`;
  }
  return subs.map(s => `
    <tr class="row-click" onclick="openUser('${s.id}')">
      <td class="cell-strong">${esc(s.name)}</td>
      <td>${esc(s.planName)}</td>
      <td class="num">${brl(s.value)}</td>
      <td>${statusPill('s' + s.status, subStatusLabel[s.status] || s.status)}</td>
      <td>${s.start}</td>
      <td>${s.end}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openUser('${s.id}')">Gerenciar</button>
      </td>
    </tr>
  `).join('');
}

let allSubsCache = [];

function updateSubsTable() {
  const filtered = filterSubs(allSubsCache);
  const tbody = document.querySelector('#assinaturasTable tbody');
  if (tbody) tbody.innerHTML = subTableRows(filtered);
  const desc = document.getElementById('assinaturasDesc');
  if (desc) desc.textContent = `${filtered.length} assinatura(s) encontrada(s).`;
}

function onSubSearch(value) {
  subSearch = value;
  updateSubsTable();
  const input = document.getElementById('subSearchInput');
  if (input) { input.focus(); input.selectionStart = input.selectionEnd = value.length; }
}

function onSubFilterStatus(value) {
  subFilterStatus = value;
  updateSubsTable();
}

async function renderAssinaturas() {
  contentEl.innerHTML = '<div class="loading">Carregando assinaturas...</div>';

  try {
    const allUsers = await loadAdminUsers();
    allSubsCache = allUsers
      .filter(user => user.sub.plan === 'premium')
      .map(user => ({
        id: user.id,
        name: user.name,
        planName: planName(user.sub.plan),
        value: user.sub.value,
        status: user.sub.status,
        start: user.sub.start,
        end: user.sub.end
      }));

    const subs = filterSubs(allSubsCache);
    const active = allSubsCache.filter(s => s.status === 'active').length;
    const trial = allSubsCache.filter(s => s.status === 'trial').length;
    const inactive = allSubsCache.filter(s => s.status === 'expired' || s.status === 'blocked').length;

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Assinaturas</div>
          <div class="page-desc" id="assinaturasDesc">${subs.length} assinatura(s) encontrada(s).</div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="card metric-card m-pos">
          <div class="metric-label">Ativas</div>
          <div class="metric-value">${active}</div>
        </div>
        <div class="card metric-card m-acc">
          <div class="metric-label">Em teste</div>
          <div class="metric-value">${trial}</div>
        </div>
        <div class="card metric-card m-neg">
          <div class="metric-label">Expiradas / bloqueadas</div>
          <div class="metric-value">${inactive}</div>
        </div>
      </div>

      <div class="toolbar" style="margin-top:24px">
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7"/>
            <path stroke-linecap="round" d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            id="subSearchInput"
            placeholder="Buscar por nome..."
            value="${esc(subSearch)}"
            oninput="onSubSearch(this.value)"
          >
        </div>
        <select onchange="onSubFilterStatus(this.value)">
          <option value="">Todos os status</option>
          <option value="active" ${subFilterStatus === 'active' ? 'selected' : ''}>Ativa</option>
          <option value="trial" ${subFilterStatus === 'trial' ? 'selected' : ''}>Teste</option>
          <option value="expired" ${subFilterStatus === 'expired' ? 'selected' : ''}>Expirada</option>
          <option value="blocked" ${subFilterStatus === 'blocked' ? 'selected' : ''}>Bloqueada</option>
        </select>
      </div>

      <div class="table-wrap table-scroll" id="assinaturasTable">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Plano</th>
              <th class="num">Valor</th>
              <th>Status</th>
              <th>Início</th>
              <th>Expiração</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>${subTableRows(subs)}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

/* Pagamentos */

let payFilter = '';

async function renderPagamentos() {
  contentEl.innerHTML = '<div class="loading">Carregando pagamentos...</div>';

  try {
    let paymentQuery = supabase
      .from('pagamentos')
      .select('id, payment_id, user_id, valor, plano, status, gateway, criado_em')
      .order('criado_em', { ascending: false });

    if (payFilter) paymentQuery = paymentQuery.eq('status', payFilter);

    const [{ data: payments, error: paymentError }, { data: profiles, error: profileError }] = await Promise.all([
      paymentQuery,
      supabase.from('perfis').select('id, nome_completo, email')
    ]);

    if (paymentError || profileError) throw paymentError || profileError;

    const profileById = Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
    const rows = (payments || []).map(payment => ({
      user_id: payment.user_id,
      user_name: profileById[payment.user_id]?.nome_completo || profileById[payment.user_id]?.email || 'Sem nome',
      value: Number(payment.valor || 0),
      plan: payment.plano,
      date: dateLabel(payment.criado_em),
      status: payment.status === 'authorized' ? 'approved' : payment.status,
      tx: payment.payment_id,
      gateway: payment.gateway
    }));

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Pagamentos</div>
          <div class="page-desc">${rows.length} pagamento(s) no total.</div>
        </div>
      </div>

      <div class="toolbar">
        <select onchange="payFilter=this.value;renderPagamentos();">
          <option value="">Todos os status</option>
          <option value="approved" ${payFilter === 'approved' ? 'selected' : ''}>Aprovado</option>
          <option value="pending" ${payFilter === 'pending' ? 'selected' : ''}>Pendente</option>
          <option value="refused" ${payFilter === 'refused' ? 'selected' : ''}>Recusado</option>
          <option value="cancelled" ${payFilter === 'cancelled' ? 'selected' : ''}>Cancelado</option>
        </select>
      </div>

      <div class="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th class="num">Valor</th>
              <th>Plano</th>
              <th>Data</th>
              <th>Status</th>
              <th>Transação</th>
              <th>Gateway</th>
            </tr>
          </thead>

          <tbody>
            ${rows.map(p => `
              <tr class="row-click" onclick="openUser('${p.user_id}')">
                <td class="cell-strong">${esc(p.user_name)}</td>
                <td class="num">${brl(p.value)}</td>
                <td>${esc(p.plan)}</td>
                <td>${p.date}</td>
                <td>${statusPill('s' + p.status, payStatusLabel[p.status] || p.status)}</td>
                <td>${esc(p.tx)}</td>
                <td>${esc(p.gateway)}</td>
              </tr>
            `).join('') || `
              <tr>
                <td colspan="7" style="text-align:center;color:var(--text-faint);padding:30px">
                  Nenhum pagamento encontrado.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

/* Gateway */

let gatewayConfig = null;

async function loadGatewayConfig() {
  try {
    const { data, error } = await supabase.functions.invoke('mp-config', {
      method: 'GET'
    });
    if (error) throw error;
    gatewayConfig = data;
    return data;
  } catch (e) {
    console.error("Erro ao carregar config do gateway:", e.message);
    gatewayConfig = null;
    return null;
  }
}

async function saveGatewayConfig() {
  const payload = {
    access_token: document.getElementById('gwAccessToken')?.value?.trim() || '',
    webhook_secret: document.getElementById('gwWebhookSecret')?.value?.trim() || '',
    public_key: document.getElementById('gwPublicKey')?.value?.trim() || '',
    webhook_url: document.getElementById('gwWebhookUrl')?.value?.trim() || '',
    success_url: document.getElementById('gwSuccessUrl')?.value?.trim() || '',
    failure_url: document.getElementById('gwFailureUrl')?.value?.trim() || '',
    pending_url: document.getElementById('gwPendingUrl')?.value?.trim() || '',
    price: parseFloat(document.getElementById('gwPrice')?.value) || 15.90,
    plan_name: document.getElementById('gwPlanName')?.value?.trim() || 'premium',
    plan_description: document.getElementById('gwPlanDesc')?.value?.trim() || 'Assinatura Premium FinMEI',
    max_installments: parseInt(document.getElementById('gwInstallments')?.value) || 12,
    active: document.getElementById('gwActive')?.checked ?? true,
    recurring_active: document.getElementById('gwRecurring')?.checked ?? false,
    back_url_assinatura: document.getElementById('gwBackAssinatura')?.value?.trim() || '',
  };

  try {
    const { data, error } = await supabase.functions.invoke('mp-config', {
      method: 'POST',
      body: payload
    });
    if (error) throw error;

    gatewayConfig = data;
    toast('Configurações salvas com sucesso.');
    renderGateway();
  } catch (e) {
    toast(e.message || 'Erro ao salvar configurações.', 'err');
  }
}

/* Contas Financeiras (admin) */

let contasCache = [];
let contasUsuarioFiltro = '';

async function renderContas() {
  contentEl.innerHTML = '<div class="loading">Carregando contas...</div>';

  try {
    const { data: usuarios, error: uErr } = await supabase
      .from('perfis').select('id, nome_completo, email').order('nome_completo');
    if (uErr) throw uErr;

    const { data: contas, error: cErr } = await supabase
      .from('contas').select('*').order('created_at', { ascending: false });
    if (cErr) throw cErr;

    const userMap = {};
    (usuarios || []).forEach(u => { userMap[u.id] = u; });

    contasCache = (contas || []).map(c => ({
      ...c,
      _user: userMap[c.user_id] || null
    }));
    const lista = contasUsuarioFiltro
      ? contasCache.filter(c => c.user_id === contasUsuarioFiltro)
      : contasCache;

    const userOptions = (usuarios || [])
      .map(u => `<option value="${u.id}" ${contasUsuarioFiltro === u.id ? 'selected' : ''}>${esc(u.nome_completo || u.email)}</option>`)
      .join('');

    const totalContas = lista.length;
    const totalSaldo = lista.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Contas Financeiras</div>
          <div class="page-desc">${totalContas} conta(s) encontrada(s) · Saldo total: ${brl(totalSaldo)}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7"/>
            <path stroke-linecap="round" d="M21 21l-4.3-4.3"/>
          </svg>
          <input id="contaSearchInput" placeholder="Buscar por nome..." oninput="onContaSearch(this.value)">
        </div>
        <select onchange="onContaFilterUser(this.value)">
          <option value="">Todos os usuários</option>
          ${userOptions}
        </select>
      </div>

      <div class="table-wrap table-scroll" id="contasTable">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Nome</th>
              <th>Instituição</th>
              <th>Tipo</th>
              <th>Finalidade</th>
              <th class="num">Saldo Inicial</th>
              <th class="num">Saldo Atual</th>
              <th>Status</th>
              <th>Cadastro</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="contasTableBody">${contasTableRows(lista)}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

function contasTableRows(lista) {
  if (!lista.length) {
    return '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-faint)">Nenhuma conta encontrada.</td></tr>';
  }

  const tipoLabels = {
    banco_pj: 'Banco PJ', banco_pf: 'Banco PF', poupanca: 'Poupança',
    caixa: 'Caixa', carteira_digital: 'Carteira Digital', outro: 'Outro'
  };
  const finLabels = { negocio: 'Negócio', pessoal: 'Pessoal', misto: 'Misto' };

  return lista.map(c => {
    const nome = c._user?.nome_completo || c._user?.email || '—';
    return `<tr>
      <td>${esc(nome)}</td>
      <td><b>${esc(c.nome)}</b></td>
      <td>${esc(c.instituicao || '—')}</td>
      <td>${tipoLabels[c.tipo] || c.tipo}</td>
      <td>${finLabels[c.finalidade] || c.finalidade}</td>
      <td class="num">${brl(c.saldo_inicial)}</td>
      <td class="num" style="font-weight:700;color:${Number(c.saldo_atual) >= 0 ? 'var(--positive)' : 'var(--negative)'}">${brl(c.saldo_atual)}</td>
      <td>${c.ativo ? statusPill('success', 'Ativa') : statusPill('muted', 'Inativa')}</td>
      <td>${c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="adminEditarConta('${c.id}')" style="margin-right:4px">Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="adminInativarConta('${c.id}','${esc(c.nome)}')" style="margin-right:4px">
          ${c.ativo ? 'Inativar' : 'Ativar'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="adminExcluirConta('${c.id}','${esc(c.nome)}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

function onContaSearch(v) {
  const termo = v.toLowerCase();
  const lista = contasCache.filter(c => {
    if (contasUsuarioFiltro && c.user_id !== contasUsuarioFiltro) return false;
    return c.nome.toLowerCase().includes(termo)
      || (c.instituicao || '').toLowerCase().includes(termo)
      || (c._user?.nome_completo || '').toLowerCase().includes(termo)
      || (c._user?.email || '').toLowerCase().includes(termo);
  });
  document.getElementById('contasTableBody').innerHTML = contasTableRows(lista);
}
window.onContaSearch = onContaSearch;

function onContaFilterUser(userId) {
  contasUsuarioFiltro = userId;
  renderContas();
}
window.onContaFilterUser = onContaFilterUser;

function adminEditarConta(id) {
  const c = contasCache.find(x => x.id === id);
  if (!c) return;

  document.getElementById('modalTitle').textContent = 'Editar Conta';
  document.getElementById('modalBody').innerHTML = `
    <div class="field">
      <label>Nome</label>
      <input id="editNome" value="${esc(c.nome)}">
    </div>
    <div class="field">
      <label>Instituição</label>
      <input id="editInst" value="${esc(c.instituicao || '')}">
    </div>
    <div class="field">
      <label>Tipo</label>
      <select id="editTipo">
        ${['banco_pj','banco_pf','poupanca','caixa','carteira_digital','outro'].map(t =>
          `<option value="${t}" ${c.tipo === t ? 'selected' : ''}>${t.replace(/_/g,' ')}</option>`
        ).join('')}
      </select>
    </div>
    <div class="field">
      <label>Finalidade</label>
      <select id="editFin">
        ${['negocio','pessoal','misto'].map(f =>
          `<option value="${f}" ${c.finalidade === f ? 'selected' : ''}>${f}</option>`
        ).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="salvarContaAdmin('${c.id}')">Salvar</button>
    </div>
  `;
  openModal();
}
window.adminEditarConta = adminEditarConta;

async function salvarContaAdmin(id) {
  const nome = document.getElementById('editNome').value.trim();
  if (!nome) { toast('Nome é obrigatório.', 'err'); return; }

  try {
    const { error } = await supabase.from('contas').update({
      nome,
      instituicao: document.getElementById('editInst').value.trim() || null,
      tipo: document.getElementById('editTipo').value,
      finalidade: document.getElementById('editFin').value,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    if (error) throw error;
    closeModal();
    toast('Conta atualizada com sucesso.');
    renderContas();
  } catch (e) {
    toast(e.message || 'Erro ao atualizar.', 'err');
  }
}
window.salvarContaAdmin = salvarContaAdmin;

function adminInativarConta(id, nome) {
  const c = contasCache.find(x => x.id === id);
  const acao = c?.ativo ? 'inativar' : 'ativar';
  confirmAction(
    `${acao.charAt(0).toUpperCase() + acao.slice(1)} conta`,
    `Deseja ${acao} a conta "<b>${esc(nome)}</b>"?`,
    acao.charAt(0).toUpperCase() + acao.slice(1),
    async () => {
      try {
        const { error } = await supabase.from('contas').update({
          ativo: !c.ativo,
          updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
        toast(`Conta ${acao === 'inativar' ? 'inativada' : 'reativada'}.`);
        renderContas();
      } catch (e) {
        toast(e.message || 'Erro ao processar.', 'err');
      }
    }
  );
}
window.adminInativarConta = adminInativarConta;

function adminExcluirConta(id, nome) {
  confirmAction(
    'Excluir conta permanentemente',
    `Tem certeza que deseja excluir a conta "<b>${esc(nome)}</b>"?<br><br>Se houver movimentações vinculadas, o vínculo será removido (os registros serão mantidos).`,
    'Excluir',
    async () => {
      try {
        const { error } = await supabase.from('contas').delete().eq('id', id);
        if (error) throw error;
        toast('Conta excluída permanentemente.');
        renderContas();
      } catch (e) {
        toast(e.message || 'Erro ao excluir.', 'err');
      }
    }
  );
}
window.adminExcluirConta = adminExcluirConta;

async function renderGateway() {
  contentEl.innerHTML = '<div class="loading">Carregando configurações...</div>';

  try {
    const config = await loadGatewayConfig();

    const isActive = config?.active ?? false;
    const hasToken = !!(config?.access_token_masked);
    const webhookOk = !!(config?.webhook_url);
    const assinaturaOk = !!(config?.webhook_secret_masked);

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Configurações de pagamento</div>
          <div class="page-desc">Integração com o Mercado Pago para processar assinaturas.</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          ${statusPill(
            isActive && hasToken ? 'active' : 'pending',
            isActive && hasToken ? 'Gateway ativo' : 'Gateway inativo'
          )}
        </div>
      </div>

      <!-- Status cards -->
      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="card metric-card m-${isActive && hasToken ? 'pos' : 'warn'}">
          <div class="metric-label">Status do gateway</div>
          <div class="metric-value" style="font-size:16px">${isActive && hasToken ? 'Conectado' : 'Não configurado'}</div>
          <div class="metric-foot">${hasToken ? 'Access token configurado' : 'Insira o access token abaixo'}</div>
        </div>

        <div class="card metric-card m-${webhookOk && assinaturaOk ? 'pos' : (webhookOk ? 'warn' : 'neg')}">
          <div class="metric-label">Webhook</div>
          <div class="metric-value" style="font-size:16px">${
            !webhookOk ? 'Pendente' : (assinaturaOk ? 'Configurado' : 'Sem verificação')
          }</div>
          <div class="metric-foot">${
            !webhookOk ? 'Configure a URL de notificação'
              : (assinaturaOk ? 'Notificações verificadas por assinatura'
                              : 'Falta a chave secreta — as notificações são aceitas sem conferir a origem')
          }</div>
        </div>

        <div class="card metric-card m-acc">
          <div class="metric-label">Preço do plano</div>
          <div class="metric-value" style="font-size:16px">R$ ${config?.price ?? '15,90'}</div>
          <div class="metric-foot">${config?.plan_name ?? 'premium'} / mês</div>
        </div>
      </div>

      <div class="grid grid-2">
        <!-- Credenciais -->
        <div class="card">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
            Credenciais do Mercado Pago
          </h4>

          <div class="field">
            <label>Access Token</label>
            <div style="position:relative">
              <input
                id="gwAccessToken"
                type="password"
                placeholder="${config?.access_token_masked || 'APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}"
                autocomplete="off"
                style="width:100%;padding-right:40px"
              >
              <button type="button" id="gwTokenOlho"
                onclick="revelarSegredoGateway('access_token', 'gwAccessToken', 'gwTokenOlho')"
                style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:13px;padding:4px" title="Mostrar o token salvo">👁</button>
            </div>
            <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px">
              ${config?.access_token_masked
                ? `Salvo: ${esc(config.access_token_masked)} — Deixe vazio para manter o atual`
                : 'Obtido no Painel do Desenvolvedor → Credenciais'}
            </div>
          </div>

          <div class="field">
            <label>Public Key</label>
            <input
              id="gwPublicKey"
              type="text"
              placeholder="${config?.public_key || 'APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}"
              autocomplete="off"
            >
            <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px">
              ${config?.public_key
                ? `Salvo: ${esc(config.public_key.substring(0, 20))}...`
                : 'Usada no frontend para checkout (opcional)'}
            </div>
          </div>

          <div class="field">
            <label>Chave secreta do Webhook</label>
            <div style="position:relative">
              <input
                id="gwWebhookSecret"
                type="password"
                placeholder="${config?.webhook_secret_masked || 'Cole a chave secreta gerada no painel do MP'}"
                autocomplete="off"
                style="width:100%;padding-right:40px"
              >
              <button type="button" id="gwSecretOlho"
                onclick="revelarSegredoGateway('webhook_secret', 'gwWebhookSecret', 'gwSecretOlho')"
                style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:13px;padding:4px" title="Mostrar a chave salva">👁</button>
            </div>
            <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px">
              ${config?.webhook_secret_masked
                ? `Salvo: ${esc(config.webhook_secret_masked)} — Deixe vazio para manter a atual`
                : 'Painel do Desenvolvedor → Webhooks → "Chave secreta". Sem ela, o sistema não consegue confirmar que a notificação veio mesmo do Mercado Pago.'}
            </div>
          </div>

          <div style="margin-top:8px;padding:12px;background:var(--accent-soft);border:1px solid rgba(31,166,252,.18);border-radius:8px;font-size:12px;color:var(--accent-strong)">
            <strong>Como obter as credenciais:</strong><br>
            1. Acesse <a href="https://www.mercadopago.com.br/developers/pt/docs" target="_blank" style="text-decoration:underline">mercadopago.com.br/developers</a><br>
            2. Vá em <b>Credenciais</b> → copie o <b>Access Token</b> (produção)
          </div>
        </div>

        <!-- Configurações gerais -->
        <div class="card">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
            Configurações do plano
          </h4>

          <div class="field">
            <label>Nome do plano</label>
            <input id="gwPlanName" type="text" value="${esc(config?.plan_name ?? 'premium')}" placeholder="premium">
          </div>

          <div class="field">
            <label>Descrição (aparece no checkout)</label>
            <input id="gwPlanDesc" type="text" value="${esc(config?.plan_description ?? 'Assinatura Premium FinMEI')}" placeholder="Assinatura Premium FinMEI">
          </div>

          <div class="field">
            <label>Preço mensal (R$)</label>
            <input id="gwPrice" type="number" step="0.01" min="1" value="${config?.price ?? 15.90}" placeholder="15.90">
          </div>

          <div class="field">
            <label>Parcelas máximas</label>
            <input id="gwInstallments" type="number" min="1" max="12" value="${config?.max_installments ?? 12}" placeholder="12">
          </div>

          <div class="field" style="flex-direction:row;align-items:center;gap:10px;margin-top:4px">
            <input
              id="gwActive"
              type="checkbox"
              ${isActive ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent)"
            >
            <label for="gwActive" style="text-transform:none;font-size:13.5px;color:var(--text);cursor:pointer">
              Gateway ativo (aceitar pagamentos)
            </label>
          </div>

          <div class="field" style="flex-direction:row;align-items:center;gap:10px;margin-top:4px">
            <input
              id="gwRecurring"
              type="checkbox"
              ${config?.recurring_active ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent)"
            >
            <label for="gwRecurring" style="text-transform:none;font-size:13.5px;color:var(--text);cursor:pointer">
              Assinatura recorrente no cartão (renova sozinha todo mês)
            </label>
          </div>

          <div style="font-size:12px;color:var(--text-faint);line-height:1.6;margin-top:4px">
            O Mercado Pago só faz cobrança recorrente no <b>cartão de crédito</b> —
            PIX e boleto não podem ser recorrentes. Com esta opção ligada, a tela de
            planos oferece as duas formas: assinatura no cartão e pagamento avulso de
            30 dias no PIX. Ao cancelar, o acesso continua até o fim do período pago.
          </div>
        </div>
      </div>

      <!-- URLs de redirecionamento -->
      <div class="card" style="margin-top:16px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          URLs de notificação e redirecionamento
        </h4>

        <div class="grid grid-2">
          <div class="field">
            <label>Webhook URL (notificação de pagamento)</label>
            <input id="gwWebhookUrl" type="url" value="${esc(config?.webhook_url ?? '')}"
              placeholder="https://seudominio.supabase.co/functions/v1/mp-webhook">
            <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px">
              O Mercado Pago envia notificações de pagamento para esta URL
            </div>
          </div>

          <div class="field">
            <label>URL de sucesso (após pagamento)</label>
            <input id="gwSuccessUrl" type="url" value="${esc(config?.success_url ?? '')}"
              placeholder="https://seudominio.com/checkout_sucesso.html">
          </div>

          <div class="field">
            <label>URL de erro (falha no pagamento)</label>
            <input id="gwFailureUrl" type="url" value="${esc(config?.failure_url ?? '')}"
              placeholder="https://seudominio.com/checkout_erro.html">
          </div>

          <div class="field">
            <label>URL pendente (pagamento aguardando)</label>
            <input id="gwPendingUrl" type="url" value="${esc(config?.pending_url ?? '')}"
              placeholder="https://seudominio.com/checkout_pendente.html">
          </div>
        </div>

        <div style="margin-top:8px;padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text-faint)">
          <strong>Dica:</strong> Configure a Webhook URL também no painel do Mercado Pago em <b>Configurações → Webhooks</b>.
          Endpoint: <code style="background:var(--surface-3);padding:2px 6px;border-radius:4px">https://seudominio.supabase.co/functions/v1/mp-webhook</code>
        </div>
      </div>

      <!-- Botões de ação -->
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
        <button class="btn btn-secondary" onclick="renderGateway()">
          Cancelar
        </button>
        <button class="btn btn-primary" onclick="saveGatewayConfig()" style="width:auto;padding:10px 24px">
          Salvar configurações
        </button>
      </div>

      <!-- Fluxo de pagamento -->
      <div class="card" style="margin-top:20px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:14px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          Como funciona o fluxo
        </h4>

        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--text-soft)">
          <div style="flex:1;min-width:200px;padding:12px;background:var(--surface-2);border-radius:8px">
            <strong style="color:var(--text)">1. Usuário clica em assinar</strong><br>
            O frontend chama a Edge Function <code>mp-checkout</code>
          </div>
          <div style="flex:1;min-width:200px;padding:12px;background:var(--surface-2);border-radius:8px">
            <strong style="color:var(--text)">2. Checkout criado</strong><br>
            O sistema cria a preferência no Mercado Pago e redireciona
          </div>
          <div style="flex:1;min-width:200px;padding:12px;background:var(--surface-2);border-radius:8px">
            <strong style="color:var(--text)">3. Pagamento processado</strong><br>
            O MP notifica via webhook e ativa o plano automaticamente
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

/* IA Config */

const AI_PRESETS = {
  openai: { name: 'OpenAI', api_url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', type: 'openai', color: '#10a37f', icon: 'AI' },
  gemini: { name: 'Google Gemini', api_url: '', model: 'gemini-2.5-flash', type: 'gemini', color: '#4285f4', icon: 'G' },
  groq: { name: 'Groq', api_url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', type: 'openai', color: '#f55036', icon: '⚡' },
  openrouter: { name: 'OpenRouter', api_url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct', type: 'openai', color: '#6366f1', icon: 'OR' },
  nvidia: { name: 'NVIDIA NIM', api_url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.3-70b-instruct', type: 'openai', color: '#76b900', icon: 'N' },
  together: { name: 'Together AI', api_url: 'https://api.together.xyz/v1/chat/completions', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', type: 'openai', color: '#6366f1', icon: 'T' },
  cerebras: { name: 'Cerebras', api_url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama-3.3-70b', type: 'openai', color: '#8b5cf6', icon: 'C' },
  huggingface: { name: 'Hugging Face', api_url: 'https://api-inference.huggingface.co/v1/chat/completions', model: 'meta-llama/Llama-3.3-70B-Instruct', type: 'openai', color: '#ffd21e', icon: 'HF' },
  anthropic: { name: 'Anthropic', api_url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514', type: 'anthropic', color: '#d97757', icon: 'A', auth_header: 'x-api-key', auth_prefix: '' },
  // LiteLLM e Ollama falam o dialeto da OpenAI, então não precisam
  // de adapter — só do endereço certo.
  litellm: { name: 'LiteLLM', api_url: 'http://localhost:4000/v1/chat/completions', model: 'gpt-4o', type: 'openai', color: '#22c55e', icon: 'LL' },
  ollama: { name: 'Ollama (local)', api_url: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1', type: 'openai', color: '#64748b', icon: 'OL', auth_prefix: '' },
};

let aiProvidersList = [];
let aiDeletedProviders = [];

function renderProviderCard(p, idx) {
  const preset = AI_PRESETS[p.provider_name] || {};
  const isCustom = !AI_PRESETS[p.provider_name];
  return `
    <div style="padding:16px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border);margin-bottom:12px" id="providerCard_${idx}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:7px;background:${preset.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${preset.icon || '?'}</div>
          <strong style="font-size:14px">${esc(p.provider_name)}</strong>
          <span style="font-size:11px;color:var(--text-faint);background:var(--surface-3);padding:2px 8px;border-radius:4px">${p.provider_type}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <input id="aiActive_${idx}" type="checkbox" ${p.active ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
          <button class="btn btn-danger btn-sm" onclick="removeProvider(${idx})" style="padding:4px 8px;font-size:11px">✕</button>
        </div>
      </div>
      <div class="field">
        <label>API Key</label>
        <div style="position:relative">
          <!-- Campo sempre vazio: a chave salva não volta do servidor,
               nem em claro nem mascarada. Vazio = manter a atual. -->
          <input id="aiKey_${idx}" type="password" value="" placeholder="${p.api_key ? 'Chave salva — preencha só para trocar' : 'Cole sua API Key aqui'}" autocomplete="off" style="width:100%;padding-right:40px">
          <button type="button" id="aiKeyOlho_${idx}" onclick="toggleKeyVis(${idx})" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:13px;padding:4px" title="Mostrar a chave salva">👁</button>
        </div>
        ${p.api_key ? '<div style="font-size:11px;color:var(--positive);margin-top:3px">✓ Chave configurada</div>' : '<div style="font-size:11px;color:var(--text-faint);margin-top:3px">Nenhuma chave salva</div>'}
      </div>
      <div class="field">
        <label>URL da API</label>
        <input id="aiUrl_${idx}" type="text" value="${esc(p.api_url)}" placeholder="https://api.exemplo.com/v1/chat/completions">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="field">
          <label>Modelo</label>
          <div style="display:flex;gap:6px">
            <input id="aiModel_${idx}" type="text" list="aiModelos_${idx}" value="${esc(p.model)}" placeholder="model-name" style="flex:1;min-width:0">
            <button type="button" class="btn btn-secondary btn-sm" onclick="buscarModelos(${idx})"
              title="Buscar os modelos disponíveis nesta conta" style="white-space:nowrap">Buscar</button>
          </div>
          <!-- datalist e não select: quem tem um modelo que a API não
               lista (deployment do Azure, alias do LiteLLM) continua
               podendo digitar à mão. -->
          <datalist id="aiModelos_${idx}"></datalist>
          <div id="aiModelosMsg_${idx}" style="font-size:11px;color:var(--text-faint);margin-top:3px"></div>
        </div>
        <div class="field">
          <label>Prioridade</label>
          <input id="aiPriority_${idx}" type="number" min="0" value="${p.priority ?? 0}">
        </div>
        <div class="field">
          <label>Tokens máx</label>
          <input id="aiTokensMax_${idx}" type="number" min="100" max="128000" value="${p.max_tokens ?? 2000}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <label>Tipo</label>
          <select id="aiType_${idx}">
            <option value="openai" ${p.provider_type === 'openai' ? 'selected' : ''}>OpenAI-compatible</option>
            <option value="gemini" ${p.provider_type === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="anthropic" ${p.provider_type === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
          </select>
        </div>
        <div class="field">
          <label>Temperatura</label>
          <input id="aiTemp_${idx}" type="number" min="0" max="2" step="0.1" value="${p.temperature ?? 0.7}">
        </div>
      </div>

      <details class="avancado">
        <summary>Autenticação e headers avançados</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field">
            <label>Header de auth</label>
            <input id="aiAuthHeader_${idx}" type="text" value="${esc(p.auth_header ?? 'Authorization')}" placeholder="Authorization">
          </div>
          <div class="field">
            <label>Prefixo</label>
            <input id="aiAuthPrefix_${idx}" type="text" value="${esc(p.auth_prefix ?? 'Bearer ')}" placeholder="Bearer ">
          </div>
        </div>
        <div class="field">
          <label>Headers extras (JSON)</label>
          <textarea id="aiExtraHeaders_${idx}" class="form-input" placeholder='{"X-Title": "FinMEI"}'>${esc(
            typeof p.extra_headers === 'string'
              ? p.extra_headers
              : (p.extra_headers && Object.keys(p.extra_headers).length ? JSON.stringify(p.extra_headers, null, 2) : '')
          )}</textarea>
        </div>
        <div class="field">
          <label>URL de modelos</label>
          <input id="aiModelsUrl_${idx}" type="text" value="${esc(p.models_url || '')}" placeholder="Vazio = derivada da URL da API">
        </div>
        <div style="font-size:11.5px;color:var(--text-faint);line-height:1.6">
          É por aqui que entram os endpoints fora do padrão: o Azure OpenAI usa
          <code>api-key</code> com prefixo vazio, gateways corporativos costumam usar
          <code>X-Api-Key</code>, e o Ollama local não pede chave nenhuma.
        </div>
      </details>
    </div>
  `;
}

function promptAction(title, placeholder, confirmLabel, fn) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = `
    <input type="text" id="modalInput" class="form-input" placeholder="${placeholder}" style="width:100%;margin-bottom:16px" autofocus>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="modalConfirmBtn">${confirmLabel}</button>
    </div>
  `;
  openModal();
  const input = document.getElementById('modalInput');
  const btn = document.getElementById('modalConfirmBtn');
  input.focus();
  btn.onclick = () => { const v = input.value.trim(); if (v) { closeModal(); fn(v); } };
  input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
}

function addProviderFromPreset(name) {
  const preset = AI_PRESETS[name];
  if (!preset) return;
  const exists = aiProvidersList.find(p => p.provider_name === name);
  if (exists) { toast('Este provedor já foi adicionado.', 'err'); return; }
  aiProvidersList.push({
    _novo: true,
    provider_name: name,
    provider_type: preset.type,
    api_key: '',
    api_url: preset.api_url,
    model: preset.model,
    max_tokens: 2000,
    temperature: 0.7,
    priority: aiProvidersList.length,
    active: false,
    auth_header: preset.auth_header ?? 'Authorization',
    auth_prefix: preset.auth_prefix ?? 'Bearer ',
    extra_headers: {},
    models_url: '',
  });
  refreshProvidersList();
}

function addCustomProvider() {
  promptAction('Novo provedor personalizado', 'Ex: minha-api, openai-local...', 'Adicionar', (name) => {
    const exists = aiProvidersList.find(p => p.provider_name === name.toLowerCase());
    if (exists) { toast('Já existe um provedor com esse nome.', 'err'); return; }
    aiProvidersList.push({
      _novo: true,
      provider_name: name.toLowerCase(),
      provider_type: 'openai',
      api_key: '',
      api_url: '',
      model: '',
      max_tokens: 2000,
      temperature: 0.7,
      priority: aiProvidersList.length,
      active: false,
    });
    refreshProvidersList();
  });
}

function removeProvider(idx) {
  const p = aiProvidersList[idx];
  const name = p?.provider_name || 'desconhecido';
  confirmAction(
    'Excluir provedor',
    `Tem certeza que deseja excluir <b>${esc(name)}</b>?<br><br>Isso é <b>irreversível</b>. A API Key configurada será perdida se você salvar sem este provedor.`,
    'Excluir',
    () => {
      // Só entra na fila de exclusão quem já existe no banco. Antes
      // a guarda testava um prefixo '_new_' que nunca era usado.
      if (p?.provider_name && !p._novo) {
        aiDeletedProviders.push(p.provider_name);
      }
      aiProvidersList.splice(idx, 1);
      refreshProvidersList();
    }
  );
}

// ============================================================
// Revelar segredos
//
// Nenhuma chave vem junto com o carregamento da tela: o servidor só
// devolve "tem chave salva" ou não. Ao clicar no olho, pedimos aquele
// segredo específico numa chamada própria — assim ele não fica indo e
// voltando (nem parando no DOM) toda vez que a página é aberta.
// ============================================================

// Alterna entre esconder e mostrar. Na primeira vez que mostra, busca
// o valor real no servidor.
async function toggleKeyVis(idx) {
  const input = document.getElementById(`aiKey_${idx}`);
  const botao = document.getElementById(`aiKeyOlho_${idx}`);
  if (!input) return;

  // Já está visível: só esconder.
  if (input.type === 'text') {
    input.type = 'password';
    if (botao) botao.textContent = '👁';
    return;
  }

  const p = aiProvidersList[idx];
  const temChaveSalva = Boolean(p?.api_key);
  const digitando = input.value.trim().length > 0;

  // Se o admin está digitando uma chave nova, mostra o que ele digitou.
  if (digitando || !temChaveSalva) {
    input.type = 'text';
    if (botao) botao.textContent = '🙈';
    return;
  }

  if (botao) botao.textContent = '…';
  try {
    const { data, error } = await supabase.functions.invoke('ai-config', {
      method: 'POST',
      body: { action: 'reveal_key', provider_name: p.provider_name },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    input.value = data?.api_key || '';
    input.type = 'text';
    if (botao) botao.textContent = '🙈';

    if (!data?.api_key) toast('Este provedor não tem chave salva.', 'err');
  } catch (e) {
    if (botao) botao.textContent = '👁';
    toast(e.message || 'Não foi possível mostrar a chave.', 'err');
  }
}
window.toggleKeyVis = toggleKeyVis;

// Mesma ideia para os segredos do gateway de pagamento.
async function revelarSegredoGateway(campo, inputId, botaoId) {
  const input = document.getElementById(inputId);
  const botao = document.getElementById(botaoId);
  if (!input) return;

  if (input.type === 'text') {
    input.type = 'password';
    if (botao) botao.textContent = '👁';
    return;
  }

  if (input.value.trim()) {
    input.type = 'text';
    if (botao) botao.textContent = '🙈';
    return;
  }

  if (botao) botao.textContent = '…';
  try {
    const { data, error } = await supabase.functions.invoke('mp-config', {
      method: 'POST',
      body: { action: 'reveal', campo },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    input.value = data?.valor || '';
    input.type = 'text';
    if (botao) botao.textContent = '🙈';

    if (!data?.valor) toast('Nada salvo neste campo ainda.', 'err');
  } catch (e) {
    if (botao) botao.textContent = '👁';
    toast(e.message || 'Não foi possível mostrar o valor.', 'err');
  }
}
window.revelarSegredoGateway = revelarSegredoGateway;

function refreshProvidersList() {
  const container = document.getElementById('providersList');
  if (container) {
    container.innerHTML = aiProvidersList.length
      ? aiProvidersList.map((p, i) => renderProviderCard(p, i)).join('')
      : '<div style="text-align:center;color:var(--text-faint);padding:20px">Nenhum provedor adicionado. Use os botões abaixo para adicionar.</div>';
  }
}

// Temperatura era gravada fixa em 0.7 e não tinha campo na tela,
// mesmo existindo a coluna no banco.
function lerTemperatura(idx, atual) {
  const v = parseFloat(document.getElementById(`aiTemp_${idx}`)?.value);
  if (!Number.isFinite(v) || v < 0 || v > 2) return atual ?? 0.7;
  return v;
}

// JSON inválido não pode virar erro no banco: avisa e mantém o que
// já estava salvo.
function lerHeadersExtras(idx) {
  const el = document.getElementById(`aiExtraHeaders_${idx}`);
  const texto = (el?.value || '').trim();
  if (!texto) return {};
  try {
    const obj = JSON.parse(texto);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('não é um objeto');
    return obj;
  } catch (e) {
    toast(`Headers extras inválidos no provedor ${idx + 1}: ${e.message}`, 'err');
    throw new Error(`headers_invalidos_${idx}`);
  }
}

function collectProvidersFromUI() {
  return aiProvidersList.map((p, idx) => ({
    provider_name: p.provider_name,
    provider_type: document.getElementById(`aiType_${idx}`)?.value || p.provider_type,
    api_key: document.getElementById(`aiKey_${idx}`)?.value?.trim() || '',
    api_url: document.getElementById(`aiUrl_${idx}`)?.value?.trim() || p.api_url,
    model: document.getElementById(`aiModel_${idx}`)?.value?.trim() || p.model,
    max_tokens: parseInt(document.getElementById(`aiTokensMax_${idx}`)?.value) || 2000,
    temperature: lerTemperatura(idx, p.temperature),
    auth_header: document.getElementById(`aiAuthHeader_${idx}`)?.value?.trim() || 'Authorization',
    auth_prefix: document.getElementById(`aiAuthPrefix_${idx}`)?.value ?? 'Bearer ',
    extra_headers: lerHeadersExtras(idx),
    models_url: document.getElementById(`aiModelsUrl_${idx}`)?.value?.trim() || null,
    // parseInt devolve NaN (não null) quando o campo está vazio, então
    // o ?? nunca agia e a prioridade ia como NaN para o banco.
    priority: Number.isFinite(parseInt(document.getElementById(`aiPriority_${idx}`)?.value))
      ? parseInt(document.getElementById(`aiPriority_${idx}`).value)
      : idx,
    active: document.getElementById(`aiActive_${idx}`)?.checked ?? false,
  }));
}

async function saveAIConfig() {
  // collectProvidersFromUI lança quando os headers extras não são um
  // JSON válido — o toast já foi mostrado, aqui só interrompemos.
  let providers;
  try {
    providers = collectProvidersFromUI();
  } catch {
    return;
  }
  const limits = ['gratuito', 'premium', 'admin'].map(plan => ({
    plan_type: plan,
    daily_messages: parseInt(document.getElementById(`aiLimit_${plan}`)?.value) || 20,
    max_tokens_per_message: parseInt(document.getElementById(`aiTokens_${plan}`)?.value) || 1500,
    max_history_messages: parseInt(document.getElementById(`aiHistory_${plan}`)?.value) || 20,
  }));

  try {
    const { error } = await supabase.functions.invoke('ai-config', {
      method: 'POST',
      body: { providers, limits, delete_providers: aiDeletedProviders }
    });
    if (error) throw error;
    aiDeletedProviders = [];
    toast('Configurações de IA salvas com sucesso.');
    renderAIConfig();
  } catch (e) {
    toast(e.message || 'Erro ao salvar.', 'err');
  }
}

async function loadAIConfig() {
  try {
    const { data, error } = await supabase.functions.invoke('ai-config', { method: 'GET' });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Erro ao carregar config de IA:', e);
    return null;
  }
}

// A aba de IA ficou com quatro telas. Em vez de uma página gigante
// que busca tudo de uma vez, cada sub-aba carrega os próprios dados
// quando é aberta.
let aiSubAba = 'provedores';

const AI_SUBABAS = [
  ['provedores',  'Provedores'],
  ['playground',  'Playground'],
  ['diagnostico', 'Diagnóstico'],
  ['erros',       'Erros'],
];

function barraSubAbas() {
  return `<div class="subtabs">    ${AI_SUBABAS.map(([id, rotulo]) => `
      <button class="subtab ${aiSubAba === id ? 'active' : ''}" onclick="irParaSubAba('${id}')">${rotulo}</button>
    `).join('')}
  </div>`;
}

function irParaSubAba(id) {
  aiSubAba = id;
  renderAIConfig();
}
window.irParaSubAba = irParaSubAba;

async function renderAIConfig() {
  const telas = {
    provedores: renderAIProvedores,
    playground: renderAIPlayground,
    diagnostico: renderAIDiagnostico,
    erros: renderAIErros,
  };
  await (telas[aiSubAba] || renderAIProvedores)();
}

async function renderAIProvedores() {
  contentEl.innerHTML = '<div class="loading">Carregando configurações de IA...</div>';

  try {
    const data = await loadAIConfig();
    if (!data) throw new Error('Falha ao carregar configurações');

    const providers = data.providers || [];
    const limits = data.limits || [];
    const usage = data.usage || [];

    aiProvidersList = providers.map(p => ({ ...p }));
    // Zera a fila de exclusão: sair da aba e voltar não pode manter
    // uma remoção pendente que o admin já abandonou.
    aiDeletedProviders = [];
    const getLimit = (plan) => limits.find(l => l.plan_type === plan) || {};

    const totalUsage = usage.reduce((sum, u) => sum + (u.messages_used || 0), 0);
    const uniqueUsers = new Set(usage.map(u => u.user_id)).size;
    const activeProviders = providers.filter(p => p.active);

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Configuração de IA</div>
          <div class="page-desc">Provedores, limites e uso do assistente inteligente.</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveAIConfig()" style="width:auto">
          Salvar configurações
        </button>
      </div>

      ${barraSubAbas()}

      <!-- Stats -->
      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="card metric-card m-acc">
          <div class="metric-label">Mensagens esta semana</div>
          <div class="metric-value">${totalUsage}</div>
          <div class="metric-foot">De ${uniqueUsers} usuário(s)</div>
        </div>
        <div class="card metric-card m-${activeProviders.length ? 'pos' : 'neg'}">
          <div class="metric-label">Provedores ativos</div>
          <div class="metric-value">${activeProviders.length}</div>
          <div class="metric-foot">${activeProviders.map(p => p.provider_name).join(', ') || 'Nenhum'}</div>
        </div>
        <div class="card metric-card m-acc">
          <div class="metric-label">Provedores totais</div>
          <div class="metric-value">${providers.length}</div>
          <div class="metric-foot">Configurados no sistema</div>
        </div>
      </div>

      <!-- Provedores -->
      <div class="card" style="margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          Provedores de IA
        </h4>

        <div id="providersList">
          ${aiProvidersList.length
            ? aiProvidersList.map((p, i) => renderProviderCard(p, i)).join('')
            : '<div style="text-align:center;color:var(--text-faint);padding:20px">Nenhum provedor adicionado. Use os botões abaixo para adicionar.</div>'
          }
        </div>

        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <div style="font-size:12px;color:var(--text-faint);margin-bottom:10px">Adicionar provedor:</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${Object.entries(AI_PRESETS).map(([key, p]) => `
              <button class="btn btn-secondary btn-sm" onclick="addProviderFromPreset('${key}')" style="font-size:12px;padding:6px 12px">
                <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${p.color};color:#fff;text-align:center;line-height:18px;font-size:10px;font-weight:700;margin-right:4px">${p.icon}</span>
                ${p.name}
              </button>
            `).join('')}
            <button class="btn btn-secondary btn-sm" onclick="addCustomProvider()" style="font-size:12px;padding:6px 12px;border-style:dashed">
              + Custom URL
            </button>
          </div>
        </div>

        <div style="margin-top:12px;padding:12px;background:var(--accent-soft);border:1px solid rgba(31,166,252,.18);border-radius:8px;font-size:12px;color:var(--accent-strong)">
          <strong>Fallback automático:</strong> Se um provedor falhar, o sistema tenta o próximo na fila (ordenado por prioridade). Provedores com API compatível com OpenAI usam o tipo "openai-compatible".
        </div>
      </div>

      <!-- Limites por plano -->
      <div class="card" style="margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          Limites por plano
        </h4>

        <div class="table-wrap table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plano</th>
                <th class="num">Mensagens/dia</th>
                <th class="num">Tokens/mensagem</th>
                <th class="num">Histórico (msgs)</th>
              </tr>
            </thead>
            <tbody>
              ${['gratuito', 'premium', 'admin'].map(plan => {
                const l = getLimit(plan);
                return `
                  <tr>
                    <td class="cell-strong" style="text-transform:capitalize">${plan}</td>
                    <td class="num">
                      <input id="aiLimit_${plan}" type="number" min="1" max="999" value="${l.daily_messages ?? 20}"
                        style="width:80px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;color:var(--text)">
                    </td>
                    <td class="num">
                      <input id="aiTokens_${plan}" type="number" min="100" max="8000" value="${l.max_tokens_per_message ?? 1500}"
                        style="width:80px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;color:var(--text)">
                    </td>
                    <td class="num">
                      <input id="aiHistory_${plan}" type="number" min="2" max="50" value="${l.max_history_messages ?? 20}"
                        style="width:80px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;color:var(--text)">
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Uso recente -->
      <div class="card">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:14px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          Uso recente (7 dias)
        </h4>

        <div class="table-wrap table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Data</th>
                <th class="num">Mensagens</th>
                <th class="num">Tokens</th>
              </tr>
            </thead>
            <tbody>
              ${usage.length ? usage.map(u => `
                <tr>
                  <td class="cell-strong">${esc(u.perfis?.nome_completo || u.perfis?.email || '—')}</td>
                  <td>${dateLabel(u.usage_date)}</td>
                  <td class="num">${u.messages_used}</td>
                  <td class="num">${u.tokens_used}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;color:var(--text-faint);padding:24px">
                    Nenhum uso registrado.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading err">${esc(e.message)}</div>`;
  }
}

/* Sidebar e inicialização */

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelector('.brand').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('open');
  }
});

document.querySelector('.topbar-title').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('open');
  }
});

// Protege o painel e abre a página inicial.
async function init() {
  const ok = await requireAdmin();

  if (ok) {
    document.getElementById('app').classList.add('show')
    
    await loadPlans();

    const qUser = queryParam('user');

    if (qUser) {
      navigate('usuarios');
      openUser(qUser);
    } else {
      navigate('dashboard');
    }
  }
}

// Se já estiver autenticado como admin, vai direto para o painel.
async function checkSession() {
  // Executa somente na página de login.
  if (!location.pathname.endsWith('admin-login.html')) return;

  if (!supabase) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from('perfis')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profile?.role === 'admin') {
      location.href = 'admin.html';
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('DOMContentLoaded', checkSession);
/* ============================================================
   Planos e limites
   Os limites do plano gratuito viviam cravados no JavaScript do
   navegador. Agora estão na tabela plano_limites, aplicados por
   trigger no Postgres, e editáveis aqui.

   Sem edge function: a tabela não guarda segredo nenhum, só
   números. O RLS (plano_limites_admin_all) garante que apenas
   admin escreve.
   ============================================================ */

let planoLimitesCache = [];

async function loadPlanoLimites() {
  const [limitesRes, perfisRes] = await Promise.all([
    supabase.from('plano_limites').select('*').order('plan_type'),
    supabase.from('perfis').select('plano, expira_em, criado_em, role')
  ]);
  if (limitesRes.error) throw limitesRes.error;
  return {
    limites: limitesRes.data || [],
    perfis: perfisRes.data || []
  };
}

function inputLimite(id, valor) {
  const v = (valor === null || valor === undefined) ? '' : valor;
  return `<input id="${id}" type="number" min="0" step="1" value="${v}" placeholder="ilimitado"
    style="width:110px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;color:var(--text)">`;
}

async function savePlanoLimites() {
  // Campo vazio grava NULL, que limite_disponivel() lê como ilimitado.
  const num = (id) => {
    const el = document.getElementById(id);
    if (!el || el.value.trim() === '') return null;
    const n = parseInt(el.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const linhas = planoLimitesCache.map(l => ({
    plan_type: l.plan_type,
    max_clientes: num('plClientes_' + l.plan_type),
    max_movimentacoes: num('plMov_' + l.plan_type),
    max_produtos: num('plProdutos_' + l.plan_type),
    trial_dias: num('plTrial_' + l.plan_type) ?? 0,
    active: document.getElementById('plAtivo_' + l.plan_type)?.checked ?? true,
  }));

  try {
    for (const linha of linhas) {
      const { error } = await supabase
        .from('plano_limites')
        .update({
          max_clientes: linha.max_clientes,
          max_movimentacoes: linha.max_movimentacoes,
          max_produtos: linha.max_produtos,
          trial_dias: linha.trial_dias,
          active: linha.active,
        })
        .eq('plan_type', linha.plan_type);
      if (error) throw error;
    }
    toast('Limites salvos. Passam a valer no próximo cadastro.');
    renderPlanoLimites();
  } catch (e) {
    toast(e.message || 'Erro ao salvar os limites.', 'err');
  }
}

async function renderPlanoLimites() {
  contentEl.innerHTML = '<div class="loading">Carregando limites...</div>';

  try {
    const { limites, perfis } = await loadPlanoLimites();
    planoLimitesCache = limites;

    const agora = Date.now();
    const contarPlano = (tipo) => perfis.filter(p => {
      if (p.role === 'admin') return tipo === 'admin';
      if (tipo === 'premium') {
        return p.plano === 'premium' && (!p.expira_em || new Date(p.expira_em).getTime() > agora);
      }
      if (tipo === 'gratuito') {
        const vencido = p.plano === 'premium' && p.expira_em && new Date(p.expira_em).getTime() <= agora;
        return p.plano !== 'premium' || vencido;
      }
      return false;
    }).length;

    const ordem = ['gratuito', 'premium', 'admin'];
    const porTipo = (t) => limites.find(l => l.plan_type === t) || { plan_type: t };

    contentEl.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Planos e limites</div>
          <div class="page-desc">Quanto cada plano pode cadastrar no sistema.</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="savePlanoLimites()" style="width:auto">
          Salvar configurações
        </button>
      </div>

      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="card metric-card m-acc">
          <div class="metric-label">No plano gratuito</div>
          <div class="metric-value">${contarPlano('gratuito')}</div>
          <div class="metric-foot">Usuários sujeitos aos limites</div>
        </div>
        <div class="card metric-card m-pos">
          <div class="metric-label">Premium ativos</div>
          <div class="metric-value">${contarPlano('premium')}</div>
          <div class="metric-foot">Sem limite de cadastro</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Administradores</div>
          <div class="metric-value">${contarPlano('admin')}</div>
          <div class="metric-foot">Acesso irrestrito</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
          Limites por plano
        </h4>

        <div class="table-wrap table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plano</th>
                <th class="num">Clientes</th>
                <th class="num">Movimentações</th>
                <th class="num">Produtos</th>
                <th class="num">Dias de teste</th>
                <th class="num">Ativo</th>
              </tr>
            </thead>
            <tbody>
              ${ordem.map(tipo => {
                const l = porTipo(tipo);
                return `
                  <tr>
                    <td class="cell-strong" style="text-transform:capitalize">${esc(tipo)}</td>
                    <td class="num">${inputLimite('plClientes_' + tipo, l.max_clientes)}</td>
                    <td class="num">${inputLimite('plMov_' + tipo, l.max_movimentacoes)}</td>
                    <td class="num">${inputLimite('plProdutos_' + tipo, l.max_produtos)}</td>
                    <td class="num">${inputLimite('plTrial_' + tipo, l.trial_dias ?? 0)}</td>
                    <td class="num">
                      <input id="plAtivo_${tipo}" type="checkbox" ${l.active !== false ? 'checked' : ''}>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:14px;font-size:12px;color:var(--text-faint);line-height:1.6">
          <b>Campo vazio = ilimitado.</b> "Movimentações" soma vendas e gastos.
          "Dias de teste" só tem efeito no plano gratuito.<br>
          Reduzir um limite <b>não apaga</b> nada de quem já passou dele — só impede
          novos cadastros até o usuário voltar para dentro do limite.
        </div>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = '<div class="card"><p style="color:var(--negative)">Erro ao carregar: '
      + esc(e.message) + '</p><p style="font-size:12px;color:var(--text-faint);margin-top:8px">'
      + 'Rode o script <code>sql/plano_limites.sql</code> no Supabase antes de usar esta tela.</p></div>';
  }
}

window.savePlanoLimites = savePlanoLimites;

/* ============================================================
   Playground, diagnóstico e log de erros da IA
   ============================================================ */

// Cabeçalho compartilhado pelas sub-abas
function cabecalhoIA(titulo, descricao, acoes) {
  return `
    <div class="page-head">
      <div>
        <div class="page-title">${esc(titulo)}</div>
        <div class="page-desc">${esc(descricao)}</div>
      </div>
      ${acoes || ''}
    </div>
    ${barraSubAbas()}
  `;
}

// Lê os provedores direto do banco (sem a chave — ela nunca sai do
// servidor). Usado pelo playground e pelo seletor de modelos.
async function carregarProvedoresSalvos() {
  const data = await loadAIConfig();
  return data?.providers || [];
}

async function chamarDiagnostico(body) {
  // O diagnóstico vive dentro da própria ai-chat: publicando pelo painel
  // do Supabase não dá para compartilhar código entre funções, e assim o
  // teste roda exatamente o mesmo arquivo que atende os usuários.
  const { data, error } = await supabase.functions.invoke('ai-chat', { body });
  if (error) throw error;
  if (data?.error && !data.linhas && !data.modelos) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------
// Buscar modelos do provedor (botão no card)
// ---------------------------------------------------------------
async function buscarModelos(idx) {
  const p = aiProvidersList[idx];
  if (!p) return;

  const msg = document.getElementById(`aiModelosMsg_${idx}`);
  const lista = document.getElementById(`aiModelos_${idx}`);
  if (msg) { msg.textContent = 'Buscando...'; msg.style.color = 'var(--text-faint)'; }

  // Manda a config que está na TELA, não a salva: dá para buscar os
  // modelos de um provedor recém-colado, antes de gravar.
  const provider = {
    provider_name: p.provider_name,
    provider_type: document.getElementById(`aiType_${idx}`)?.value || p.provider_type,
    api_url: document.getElementById(`aiUrl_${idx}`)?.value?.trim() || p.api_url,
    api_key: document.getElementById(`aiKey_${idx}`)?.value?.trim() || '',
    models_url: document.getElementById(`aiModelsUrl_${idx}`)?.value?.trim() || null,
  };

  try {
    const r = await chamarDiagnostico({ action: 'list_models', provider });

    if (r.error) {
      if (msg) {
        msg.textContent = r.error + (r.detalhe ? ` — ${String(r.detalhe).slice(0, 120)}` : '');
        msg.style.color = 'var(--negative)';
      }
      return;
    }

    if (lista) {
      lista.innerHTML = (r.modelos || []).map(m => `<option value="${esc(m)}"></option>`).join('');
    }
    if (msg) {
      msg.textContent = `${r.total} modelo(s) — clique no campo para ver a lista. Você também pode digitar um nome que não esteja aí.`;
      msg.style.color = 'var(--positive)';
    }
  } catch (e) {
    if (msg) { msg.textContent = e.message; msg.style.color = 'var(--negative)'; }
  }
}
window.buscarModelos = buscarModelos;

// ---------------------------------------------------------------
// Playground
// ---------------------------------------------------------------
let pgProvedores = [];

async function renderAIPlayground() {
  contentEl.innerHTML = '<div class="loading">Carregando provedores...</div>';

  try {
    pgProvedores = await carregarProvedoresSalvos();

    contentEl.innerHTML = cabecalhoIA(
      'Playground',
      'Teste um provedor e um modelo sem passar pelo chat dos usuários.'
    ) + `
      ${pgProvedores.length ? '' : `
        <div class="card"><p style="color:var(--text-faint)">
          Nenhum provedor cadastrado ainda. Vá em <b>Provedores</b> e adicione um.
        </p></div>`}

      ${pgProvedores.length ? `
      <div class="grid grid-2">
        <div class="card">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
            Requisição
          </h4>

          <div class="field">
            <label>Provedor</label>
            <select id="pgProvider">
              ${pgProvedores.map((p, i) => `
                <option value="${i}">${esc(p.provider_name)} — ${esc(p.provider_type)}${p.active ? '' : ' (inativo)'}</option>
              `).join('')}
            </select>
          </div>

          <div class="field">
            <label>Modelo (vazio = o do cadastro)</label>
            <input id="pgModel" type="text" placeholder="${esc(pgProvedores[0]?.model || 'model-name')}">
          </div>

          <div class="field">
            <label>Mensagem</label>
            <textarea id="pgMensagem" class="form-input" style="min-height:90px">Quanto eu faturei esse mês?</textarea>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
            ${[
              'Responda apenas: ok',
              'Quanto eu faturei esse mês?',
              'Me dá um resumo do negócio',
              'Cadastra um gasto de 80 reais em aluguel',
            ].map(t => `
              <button class="btn btn-secondary btn-sm" style="font-size:11.5px"
                onclick="document.getElementById('pgMensagem').value=${JSON.stringify(t).replace(/"/g, '&quot;')}">${esc(t)}</button>
            `).join('')}
          </div>

          <div class="field" style="flex-direction:row;align-items:flex-start;gap:10px">
            <input id="pgContexto" type="checkbox" checked style="width:16px;height:16px;margin-top:2px;accent-color:var(--accent)">
            <label for="pgContexto" style="text-transform:none;font-size:13px;color:var(--text);cursor:pointer;letter-spacing:0">
              Usar contexto e tools reais
              <div style="font-size:11.5px;color:var(--text-faint);font-weight:400;margin-top:2px">
                Desmarcado, faz só um ping para validar chave, URL e modelo.
                Marcado, roda com o mesmo system prompt e as mesmas tools do chat —
                é o que de fato reproduz o comportamento real.
              </div>
            </label>
          </div>

          <button class="btn btn-primary" onclick="rodarPlayground()">Enviar</button>
        </div>

        <div class="card">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
            Resposta
          </h4>
          <div id="pgResultado" class="console-box c-dim">Nenhum teste rodado ainda.</div>
        </div>
      </div>` : ''}
    `;
  } catch (e) {
    contentEl.innerHTML = cabecalhoIA('Playground', 'Teste um provedor e um modelo.')
      + `<div class="card"><p style="color:var(--negative)">Erro: ${esc(e.message)}</p></div>`;
  }
}

async function rodarPlayground() {
  const caixa = document.getElementById('pgResultado');
  const idx = parseInt(document.getElementById('pgProvider')?.value ?? '0');
  const p = pgProvedores[idx];
  if (!p || !caixa) return;

  const modelo = document.getElementById('pgModel')?.value?.trim() || '';
  const mensagem = document.getElementById('pgMensagem')?.value?.trim() || '';
  const comContexto = document.getElementById('pgContexto')?.checked ?? false;

  caixa.className = 'console-box c-dim';
  caixa.textContent = 'Enviando...';

  try {
    const r = await chamarDiagnostico({
      action: 'test_provider',
      provider: p,
      model: modelo,
      mensagem,
      com_contexto: comContexto,
    });

    if (!r.ok) {
      caixa.className = 'console-box err';
      caixa.innerHTML = [
        `<span class="c-err"><b>FALHOU</b></span> em ${r.ms}ms`,
        `provedor : ${esc(r.provider || p.provider_name)}`,
        `modelo   : ${esc(r.model || modelo || p.model)}`,
        `http     : ${r.http_status ?? 'sem resposta (rede/DNS/URL)'}`,
        '',
        '<b>Erro devolvido pelo provedor</b>',
        esc(String(r.erro || '').slice(0, 4000)),
      ].join('\n');
      return;
    }

    caixa.className = 'console-box ok';
    caixa.innerHTML = [
      `<span class="c-ok"><b>OK</b></span> em ${r.ms}ms · ${r.tokens || 0} tokens`,
      `provedor : ${esc(r.provider || p.provider_name)}`,
      `modelo   : ${esc(r.model || '')}`,
      r.tools_chamadas?.length
        ? `tools    : ${esc(r.tools_chamadas.join(', '))}`
        : '<span class="c-dim">tools    : nenhuma chamada</span>',
      '',
      '<b>Resposta</b>',
      esc(r.texto || '(vazio)'),
      '',
      r.tools_chamadas?.length
        ? '<span class="c-dim">O modelo pediu as tools acima. No chat real elas seriam executadas e a resposta final viria depois — aqui paramos na primeira rodada.</span>'
        : '',
    ].filter(Boolean).join('\n');

  } catch (e) {
    caixa.className = 'console-box err';
    caixa.innerHTML = `<span class="c-err"><b>ERRO</b></span>\n${esc(e.message)}`;
  }
}
window.rodarPlayground = rodarPlayground;

// ---------------------------------------------------------------
// Diagnóstico das tools
// ---------------------------------------------------------------
async function renderAIDiagnostico() {
  contentEl.innerHTML = cabecalhoIA(
    'Diagnóstico',
    'Executa cada tool da IA na sua conta de administrador e mostra o que aconteceu.'
  ) + `
    <div class="card" style="margin-bottom:16px">
      <div class="field" style="flex-direction:row;align-items:flex-start;gap:10px;margin-bottom:16px">
        <input id="dgEscrita" type="checkbox" style="width:16px;height:16px;margin-top:2px;accent-color:var(--accent)">
        <label for="dgEscrita" style="text-transform:none;font-size:13px;color:var(--text);cursor:pointer;letter-spacing:0">
          Incluir tools de escrita
          <div style="font-size:11.5px;color:var(--text-faint);font-weight:400;margin-top:2px">
            Cria um cliente, um gasto, uma venda e um produto marcados com
            <code>[TESTE]</code> <b>na sua conta</b> e apaga logo em seguida.
            É o que revela bloqueio por limite de plano ou por trigger —
            justamente os erros que hoje não aparecem em lugar nenhum.
          </div>
        </label>
      </div>

      <button class="btn btn-primary" onclick="rodarDiagnostico()" style="width:auto">Rodar diagnóstico</button>
    </div>

    <div class="card">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">
        Resultado
      </h4>
      <div id="dgResultado" class="console-box c-dim">Nenhum diagnóstico rodado ainda.</div>
    </div>
  `;
}

async function rodarDiagnostico() {
  const caixa = document.getElementById('dgResultado');
  const escrita = document.getElementById('dgEscrita')?.checked ?? false;
  if (!caixa) return;

  caixa.className = 'console-box c-dim';
  caixa.textContent = escrita ? 'Rodando leitura e escrita...' : 'Rodando tools de leitura...';

  try {
    const r = await chamarDiagnostico({ action: 'test_tools', incluir_escrita: escrita });

    const linhas = (r.linhas || []).map(l => {
      const marca = l.ok ? '<span class="c-ok">[ ok  ]</span>' : '<span class="c-err">[falha]</span>';
      const nome = String(l.tool).padEnd(26, ' ');
      const tempo = String(l.ms + 'ms').padStart(7, ' ');
      return marca + ' ' + esc(nome) + ' ' + tempo + '  ' + esc(l.mensagem || '');
    });

    caixa.className = 'console-box ' + (r.falhas ? 'err' : 'ok');
    caixa.innerHTML = linhas.concat([
      '',
      r.falhas
        ? '<span class="c-err"><b>' + r.falhas + ' de ' + r.total + ' falharam.</b></span>'
        : '<span class="c-ok"><b>Todas as ' + r.total + ' passaram.</b></span>',
    ]).join('\n');

  } catch (e) {
    caixa.className = 'console-box err';
    caixa.innerHTML = '<span class="c-err"><b>ERRO</b></span>\n' + esc(e.message);
  }
}
window.rodarDiagnostico = rodarDiagnostico;

// ---------------------------------------------------------------
// Log de erros
// ---------------------------------------------------------------
let erroFiltroTipo = '';
let errosCarregados = [];

const ROTULO_TIPO = {
  provider: 'Provedor',
  tool: 'Tool',
  args: 'Argumentos',
  fallback: 'Fallback',
  config: 'Configuração',
};

async function renderAIErros() {
  contentEl.innerHTML = '<div class="loading">Carregando log...</div>';

  try {
    let query = supabase
      .from('ai_error_logs')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(200);

    if (erroFiltroTipo) query = query.eq('tipo', erroFiltroTipo);

    const [logRes, resumoRes] = await Promise.all([query, supabase.rpc('resumo_ai_erros')]);

    if (logRes.error) throw logRes.error;
    errosCarregados = logRes.data || [];
    const resumo = resumoRes.data || {};

    const linhasTabela = errosCarregados.map((l, i) => `
      <tr class="row-click" onclick="verErro(${i})">
        <td style="white-space:nowrap">${esc(new Date(l.criado_em).toLocaleString('pt-BR'))}</td>
        <td>${statusPill(l.tipo === 'fallback' ? 'pending' : 'expired', ROTULO_TIPO[l.tipo] || l.tipo)}</td>
        <td>${esc(l.provider || '—')}</td>
        <td>${esc(l.tool_name || '—')}</td>
        <td class="num">${l.http_status ?? '—'}</td>
        <td>${esc(String(l.mensagem || '').slice(0, 90))}${String(l.mensagem || '').length > 90 ? '…' : ''}</td>
      </tr>
    `).join('');

    const tabela = errosCarregados.length ? `
      <div class="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Quando</th><th>Tipo</th><th>Provedor</th>
              <th>Tool</th><th>HTTP</th><th>Mensagem</th>
            </tr>
          </thead>
          <tbody>${linhasTabela}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;font-size:11.5px;color:var(--text-faint)">
        Clique numa linha para ver o detalhe completo. Mostrando as ${errosCarregados.length} mais recentes.
      </div>
    ` : `
      <p style="color:var(--text-faint);text-align:center;padding:30px 0">
        Nenhuma falha registrada${erroFiltroTipo ? ' com esse filtro' : ''}.
      </p>`;

    contentEl.innerHTML = cabecalhoIA(
      'Erros da IA',
      'Falhas de provedor, de tool e de argumentos — com o motivo real.',
      '<button class="btn btn-secondary btn-sm" onclick="limparLogsIA()" style="width:auto">Limpar antigos</button>'
    ) + `
      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="card metric-card m-${resumo.ultimas_24h ? 'neg' : 'pos'}">
          <div class="metric-label">Falhas nas últimas 24h</div>
          <div class="metric-value">${resumo.ultimas_24h ?? 0}</div>
          <div class="metric-foot">${resumo.ultimos_7d ?? 0} nos últimos 7 dias</div>
        </div>
        <div class="card metric-card m-warn">
          <div class="metric-label">Provedor que mais falha</div>
          <div class="metric-value" style="font-size:16px">${esc(resumo.provedor_pior || '—')}</div>
          <div class="metric-foot">Nos últimos 7 dias</div>
        </div>
        <div class="card metric-card m-warn">
          <div class="metric-label">Tool que mais falha</div>
          <div class="metric-value" style="font-size:16px">${esc(resumo.tool_pior || '—')}</div>
          <div class="metric-foot">Nos últimos 7 dias</div>
        </div>
      </div>

      <div class="toolbar" style="margin-bottom:14px">
        <select class="select" onchange="filtrarErros(this.value)">
          <option value="">Todos os tipos</option>
          ${Object.entries(ROTULO_TIPO).map(([v, r]) =>
            `<option value="${v}" ${erroFiltroTipo === v ? 'selected' : ''}>${r}</option>`
          ).join('')}
        </select>
      </div>

      <div class="card">${tabela}</div>
    `;
  } catch (e) {
    contentEl.innerHTML = cabecalhoIA('Erros da IA', 'Falhas de provedor, de tool e de argumentos.')
      + '<div class="card"><p style="color:var(--negative)">Erro ao carregar: ' + esc(e.message)
      + '</p><p style="font-size:12px;color:var(--text-faint);margin-top:8px">'
      + 'Rode o script <code>sql/ai_logs.sql</code> no Supabase antes de usar esta tela.</p></div>';
  }
}

function filtrarErros(tipo) {
  erroFiltroTipo = tipo;
  renderAIErros();
}
window.filtrarErros = filtrarErros;

function verErro(i) {
  const l = errosCarregados[i];
  if (!l) return;

  const linhas = [
    'quando   : ' + new Date(l.criado_em).toLocaleString('pt-BR'),
    'tipo     : ' + (ROTULO_TIPO[l.tipo] || l.tipo),
    'provedor : ' + (l.provider || '—'),
    'modelo   : ' + (l.model || '—'),
    'tool     : ' + (l.tool_name || '—'),
    'http     : ' + (l.http_status ?? '—'),
    'usuário  : ' + (l.user_id || '—'),
    '',
    'mensagem',
    l.mensagem || '',
  ];

  if (l.detalhe) linhas.push('', 'detalhe', JSON.stringify(l.detalhe, null, 2));

  document.getElementById('modalTitle').textContent = 'Detalhe da falha';
  document.getElementById('modalBody').innerHTML =
    '<div class="console-box" style="max-height:420px">' + esc(linhas.join('\n')) + '</div>';
  openModal();
}
window.verErro = verErro;

function limparLogsIA() {
  confirmAction(
    'Limpar logs antigos',
    'Apaga as falhas com mais de <b>30 dias</b>. As recentes ficam.',
    'Limpar',
    async () => {
      try {
        const { data, error } = await supabase.rpc('limpar_ai_logs', { p_dias: 30 });
        if (error) throw error;
        toast((data ?? 0) + ' registro(s) removido(s).');
        renderAIErros();
      } catch (e) {
        toast(e.message || 'Erro ao limpar.', 'err');
      }
    }
  );
}
window.limparLogsIA = limparLogsIA;
