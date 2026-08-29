import { supabase } from './auth.js';
import { lerStreamIA } from './dom-utils.js';

const IA_URL = `${supabase.supabaseUrl}/functions/v1/ai-chat`;

let chatSending = false;
let currentSessionId = null;
let sessions = [];
let pendingDeleteSessionId = null;

// Escapa ANTES de aplicar o markdown. Sem isso, qualquer HTML que
// a IA repetisse do texto do usuário era renderizado de verdade.
function simpleMarkdown(text) {
  return escHtml(text)
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

// Durante as ações da IA os pontinhos dão lugar ao que está sendo
// feito ("Consultando suas vendas..."), para o usuário não olhar
// para um spinner mudo por 15-30s.
function atualizarStatusDigitando(texto) {
  const el = document.getElementById('typingIndicator');
  if (!el) return;
  const bolha = el.querySelector('.msg-bubble');
  if (bolha) {
    bolha.innerHTML = `<p style="opacity:.75;font-style:italic">${escHtml(texto)}</p>`;
  }
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

    // O limite vem pronto do banco. Calculando aqui pelo perfis.plano,
    // a tela ignorava que admin usa o plano 'admin' e que premium
    // vencido volta ao gratuito — mostrava um número e o servidor
    // aplicava outro.
    const { data: uso, error } = await supabase.rpc('meu_uso_plano');
    if (error) throw error;

    updateUsage(uso?.ia?.usado ?? 0, uso?.ia?.max ?? 10);
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

  // Botões carregam só o id. O título sai do array em memória —
  // antes ele era escapado para HTML e depois passado ao renomear,
  // então uma conversa chamada Venda "grande" abria o campo com
  // &quot; no lugar das aspas.
  list.innerHTML = sessions.map(s => {
    return `
      <div class="chat-session-item ${s.id === currentSessionId ? 'active' : ''}" data-sessao="${escHtml(s.id)}">
        <span class="chat-session-title">${escHtml(s.title)}</span>
        <button class="chat-session-rename" data-sessao-acao="renomear" title="Renomear">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>
        </button>
        <button class="chat-session-delete" data-sessao-acao="excluir" title="Excluir conversa">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
  }).join('');

  if (!list._delegado) {
    list._delegado = true;
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.chat-session-item');
      if (!item) return;
      const sessao = sessions.find(x => x.id === item.dataset.sessao)
        || { id: item.dataset.sessao, title: '' };

      const botao = e.target.closest('[data-sessao-acao]');
      if (!botao) { window._ia_switchSession(sessao.id); return; }

      e.stopPropagation();
      if (botao.dataset.sessaoAcao === 'renomear') {
        window._ia_renameSession(sessao.id, sessao.title || '');
      } else {
        window._ia_deleteSession(sessao.id);
      }
    });
  }
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
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({ message, session_id: currentSessionId, stream: true }),
    });

    // Erro antes do stream começar (limite diário, plano expirado...)
    if (!res.ok) {
      removeTyping();
      const data = await res.json().catch(() => ({}));
      if (data.limitReached || data.planExpired) showLimitMsg(data.error);
      appendMessage('assistant', data.error || 'Erro ao processar mensagem.');
      return;
    }

    // O servidor pode responder em JSON (modo antigo) se o streaming
    // estiver indisponível — tratamos os dois casos.
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('text/event-stream')) {
      removeTyping();
      const data = await res.json();
      appendMessage('assistant', data.content || data.error || 'Sem resposta.');
      if (data.usage) updateUsage(data.usage.messages_used, data.usage.messages_limit);
      if (data.session_id && data.session_id !== currentSessionId) {
        currentSessionId = data.session_id;
        await loadSessions();
      }
      return;
    }

    // Streaming: a bolha nasce vazia e vai sendo preenchida.
    let bolha = null;
    let texto = '';

    const escrever = (novoTexto) => {
      texto = novoTexto;
      if (!bolha) {
        removeTyping();
        bolha = appendMessage('assistant', '');
      }
      const corpo = bolha.querySelector('.msg-bubble');
      if (corpo) corpo.innerHTML = `<p>${simpleMarkdown(texto)}</p>`;
      const container = document.getElementById('chatMessages');
      if (container) container.scrollTop = container.scrollHeight;
    };

    let novaSessao = null;

    await lerStreamIA(res, {
      onSession: (id) => { novaSessao = id; },
      onStatus: (t) => atualizarStatusDigitando(t),
      onDelta: (t) => escrever(texto + t),
      onReplace: (t) => escrever(t),
      // Provedor caiu no meio: joga fora o pedaço já exibido para o
      // próximo não escrever grudado no texto do anterior.
      onReset: () => escrever(''),
      onError: (erro) => {
        removeTyping();
        if (!bolha) appendMessage('assistant', erro || 'Erro ao processar mensagem.');
        else escrever(erro || 'Erro ao processar mensagem.');
      },
      onDone: async (evento) => {
        removeTyping();
        escrever(evento.content || texto);
        if (evento.usage) updateUsage(evento.usage.messages_used, evento.usage.messages_limit);
        const id = evento.session_id || novaSessao;
        if (id && id !== currentSessionId) {
          currentSessionId = id;
          await loadSessions();
        }
      },
    });

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
