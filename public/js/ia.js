import { supabase } from './auth.js';

const IA_URL = 'https://grszaitpgnyrbxktxauc.supabase.co/functions/v1/ai-chat';

let chatSending = false;
let currentSessionId = null;
let sessions = [];
let pendingDeleteSessionId = null;

function simpleMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<strong style="font-size:15px;display:block;margin:12px 0 6px">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:16px;display:block;margin:14px 0 6px">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:17px;display:block;margin:16px 0 8px">$1</strong>')
    .replace(/^\- (.+)$/gm, '• $1')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appendMessage(role, content) {
  const container = document.getElementById('chatMessages');
  const welcome = document.getElementById('chatWelcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatar = role === 'user' ? 'V' : 'IA';
  const html = role === 'user' ? escHtml(content) : simpleMarkdown(content);

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble"><p>${html}</p></div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="msg-avatar">IA</div>
    <div class="msg-bubble">
      <div class="msg-typing"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function updateUsage(used, limit) {
  const el = document.getElementById('chatUsage');
  const countEl = document.getElementById('usageCount');
  const limitEl = document.getElementById('usageLimit');
  const remainingEl = document.getElementById('usageRemaining');
  if (el) el.style.display = 'block';
  if (countEl) countEl.textContent = used;
  if (limitEl) limitEl.textContent = limit;
  if (remainingEl) remainingEl.textContent = Math.max(0, limit - used);
}

async function loadUsage() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const [{ data: profile }, { data: limits }] = await Promise.all([
      supabase.from('perfis').select('plano, ai_daily_limit').eq('id', session.user.id).single(),
      supabase.from('ai_limits').select('plan_type, daily_messages').in('plan_type', ['gratuito', 'premium', 'admin'])
    ]);
    const plan = profile?.plano || 'gratuito';
    const planLimit = (limits || []).find(limit => limit.plan_type === plan)?.daily_messages || 10;
    const limit = profile?.ai_daily_limit ?? planLimit;
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabase.from('ai_usage')
      .select('messages_used').eq('user_id', session.user.id).eq('usage_date', today).maybeSingle();

    updateUsage(usage?.messages_used || 0, limit);
  } catch (e) {
    console.error('Erro ao carregar uso da IA:', e);
  }
}

function showLimitMsg(msg) {
  const el = document.getElementById('limitMsg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideLimitMsg() {
  const el = document.getElementById('limitMsg');
  if (el) el.style.display = 'none';
}

function setLoading(on) {
  chatSending = on;
  const btn = document.getElementById('chatSendBtn');
  const input = document.getElementById('chatInput');
  if (btn) btn.disabled = on;
  if (input) input.disabled = on;
}

function autoResize() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendSuggestion(text) {
  const input = document.getElementById('chatInput');
  if (input) input.value = text;
  sendMessage();
}

// ==================== SESSIONS ====================

async function loadSessions() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from('ai_sessions')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Erro ao carregar sessões:', error);
      return;
    }

    sessions = data || [];
    renderSessions();
  } catch (e) {
    console.error('Erro loadSessions:', e);
  }
}

function renderSessions() {
  const list = document.getElementById('sessionsList');
  if (!list) return;

  if (sessions.length === 0) {
    list.innerHTML = '<div style="padding:12px;color:var(--texto-faint);font-size:12px;text-align:center">Nenhuma conversa ainda</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const date = s.updated_at ? new Date(s.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
    return `
      <div class="chat-session-item ${s.id === currentSessionId ? 'active' : ''}" onclick="window._ia_switchSession('${s.id}')">
        <span class="chat-session-title">${escHtml(s.title)}</span>
        <button class="chat-session-rename" onclick="event.stopPropagation();window._ia_renameSession('${s.id}','${escHtml(s.title).replace(/'/g, "\\'")}')" title="Renomear">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>
        </button>
        <button class="chat-session-delete" onclick="event.stopPropagation();window._ia_deleteSession('${s.id}')" title="Excluir conversa">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
  }).join('');
}

window._ia_createNewSession = async () => {
  currentSessionId = null;
  const container = document.getElementById('chatMessages');
  container.innerHTML = `
    <div class="chat-welcome" id="chatWelcome">
      <div class="ai-icon-lg">
        <i data-lucide="sparkles" style="width:36px;height:36px"></i>
      </div>
      <h2>Olá! Sou o FinMEI IA</h2>
      <p>Seu assistente financeiro inteligente. Posso consultar suas vendas, gastos, criar registros e muito mais. É só pedir!</p>
      <div class="chat-suggestions">
        <button onclick="window._ia_sendSuggestion('Quanto eu faturei esse mês?')">Quanto faturei esse mês?</button>
        <button onclick="window._ia_sendSuggestion('Cadastra um gasto de 80 reais em aluguel')">Cadastrar gasto</button>
        <button onclick="window._ia_sendSuggestion('Me dá um resumo do meu negócio')">Resumo do negócio</button>
        <button onclick="window._ia_sendSuggestion('Quais são meus top gastos?')">Top gastos</button>
      </div>
    </div>
  `;
  lucide.createIcons();
  renderSessions();
  document.getElementById('chatInput')?.focus();
};

window._ia_switchSession = async (id) => {
  currentSessionId = id;
  renderSessions();
  await loadSessionMessages(id);
};

window._ia_deleteSession = async (id) => {
  const modal = document.getElementById('deleteSessionModal');
  if (!modal) return;

  pendingDeleteSessionId = id;
  modal.style.display = 'flex';
};

async function confirmDeleteSession() {
  const id = pendingDeleteSessionId;
  const modal = document.getElementById('deleteSessionModal');
  if (!id || !modal) return;

  pendingDeleteSessionId = null;
  modal.style.display = 'none';

  try {
    const { error } = await supabase
      .from('ai_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao excluir sessão:', error);
      window.mostrarModal?.('Erro ao excluir', 'Não foi possível excluir a conversa. Tente novamente.', 'erro');
      return;
    }

    if (currentSessionId === id) {
      currentSessionId = null;
      window._ia_createNewSession();
    }
    await loadSessions();
  } catch (e) {
    console.error('Erro deleteSession:', e);
    window.mostrarModal?.('Erro ao excluir', 'Não foi possível excluir a conversa. Tente novamente.', 'erro');
  }
}

window._ia_cancelDeleteSession = () => {
  pendingDeleteSessionId = null;
  const modal = document.getElementById('deleteSessionModal');
  if (modal) modal.style.display = 'none';
};

window._ia_confirmDeleteSession = confirmDeleteSession;

window._ia_renameSession = async (id, currentTitle) => {
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  const form = document.getElementById('renameForm');
  if (!modal || !input || !form) return;

  input.value = currentTitle;
  modal.style.display = 'flex';
  input.focus();
  input.select();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newTitle = input.value.trim();
    if (!newTitle || newTitle === currentTitle) {
      modal.style.display = 'none';
      return;
    }

    try {
      const { error } = await supabase
        .from('ai_sessions')
        .update({ title: newTitle })
        .eq('id', id);

      if (error) {
        console.error('Erro ao renomear:', error);
        return;
      }

      const session = sessions.find(s => s.id === id);
      if (session) session.title = newTitle;
      renderSessions();
    } catch (e) {
      console.error('Erro renameSession:', e);
    }

    modal.style.display = 'none';
  };

  const handleCancel = () => {
    modal.style.display = 'none';
  };

  form.removeEventListener('submit', handleSubmit);
  form.addEventListener('submit', handleSubmit);

  const cancelBtn = document.getElementById('renameCancel');
  if (cancelBtn) {
    cancelBtn.removeEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
  }

  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
};

window._ia_sendSuggestion = (text) => {
  const input = document.getElementById('chatInput');
  if (input) input.value = text;
  sendMessage();
};

async function loadSessionMessages(sessionId) {
  try {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Erro ao carregar mensagens:', error);
      return;
    }

    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    for (const msg of (data || [])) {
      appendMessage(msg.role, msg.content);
    }
  } catch (e) {
    console.error('Erro loadSessionMessages:', e);
  }
}

// ==================== SEND MESSAGE ====================

async function sendMessage() {
  if (chatSending) return;

  const input = document.getElementById('chatInput');
  const message = input?.value?.trim();
  if (!message) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      appendMessage('assistant', 'Você precisa estar logado para usar o assistente. Faça login e tente novamente.');
      return;
    }

    input.value = '';
    autoResize();
    hideLimitMsg();
    appendMessage('user', message);
    setLoading(true);
    appendTyping();

    const res = await fetch(IA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdyd3phaXRwZ255cmJ4a3R4YXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyNDQwOTcsImV4cCI6MjA3MTgyMDA5N30.sEo1F8sOYnEhVlXPkTFnVnSa7eTNY4bNHczFPsEwVUE',
      },
      body: JSON.stringify({ message, session_id: currentSessionId }),
    });

    const data = await res.json();
    removeTyping();

    if (!res.ok) {
      if (data.limitReached) {
        showLimitMsg(data.error);
      }
      appendMessage('assistant', data.error || 'Erro ao processar mensagem.');
    } else {
      appendMessage('assistant', data.content);
      if (data.usage) {
        updateUsage(data.usage.messages_used, data.usage.messages_limit);
      }
      if (data.session_id && data.session_id !== currentSessionId) {
        currentSessionId = data.session_id;
        await loadSessions();
      }
    }
  } catch (e) {
    removeTyping();
    appendMessage('assistant', 'Erro de conexão. Verifique sua internet e tente novamente.');
    console.error('Erro sendMessage:', e);
  } finally {
    setLoading(false);
  }
}

// Expor funções para uso no HTML (inline onclick)
window.handleKeyDown = handleKeyDown;
window.createNewSession = window._ia_createNewSession;
window.switchSession = window._ia_switchSession;
window.deleteSession = window._ia_deleteSession;
window.renameSession = window._ia_renameSession;
window.sendSuggestion = window._ia_sendSuggestion;
window.sendMessage = sendMessage;

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chatInput');
  if (input) {
    input.addEventListener('input', autoResize);
  }
  loadSessions();
  loadUsage();
});
