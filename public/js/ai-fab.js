import { supabase } from './auth.js';
import { lerStreamIA } from './dom-utils.js';

const FAB_HTML = `
<style>
  /* ========== FAB BUTTON ========== */
  #aiFab{
    position:fixed;bottom:28px;right:28px;width:54px;height:54px;
    border-radius:16px;
    background:linear-gradient(135deg,#1fa6fc 0%,#6c5ce7 50%,#a855f7 100%);
    color:#fff;border:none;cursor:pointer;
    box-shadow:0 4px 24px rgba(31,166,252,.35),0 0 0 0 rgba(31,166,252,.2);
    z-index:70;display:flex;align-items:center;justify-content:center;
    transition:all .25s cubic-bezier(.4,0,.2,1);
  }
  #aiFab:hover{
    transform:translateY(-3px) scale(1.05);
    box-shadow:0 8px 32px rgba(31,166,252,.45),0 0 0 6px rgba(31,166,252,.1);
  }
  #aiFab:active{transform:translateY(-1px) scale(1.02)}
  #aiFab.hidden{display:none}
  #aiFab svg{width:22px;height:22px;transition:transform .2s}
  #aiFab:hover svg{transform:rotate(-8deg) scale(1.05)}
  #aiFab.pulse{animation:fabPulse 2s ease-in-out infinite}
  @keyframes fabPulse{
    0%,100%{box-shadow:0 4px 24px rgba(31,166,252,.35),0 0 0 0 rgba(31,166,252,.2)}
    50%{box-shadow:0 4px 24px rgba(31,166,252,.35),0 0 0 10px rgba(31,166,252,0)}
  }

  /* ========== PANEL ========== */
  #aiPanel{
    position:fixed;bottom:96px;right:28px;width:390px;height:580px;
    background:#0d1525;
    border:1px solid rgba(148,163,184,.1);
    border-radius:20px;
    box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.03) inset;
    z-index:71;display:none;flex-direction:column;overflow:hidden;
    animation:panelIn .3s cubic-bezier(.16,1,.3,1);
  }
  #aiPanel.open{display:flex;z-index:999990}
  @keyframes panelIn{
    from{opacity:0;transform:translateY(16px) scale(.97)}
    to{opacity:1;transform:translateY(0) scale(1)}
  }

  /* ========== HEADER ========== */
  #aiPanelHead{
    display:flex;align-items:center;justify-content:space-between;
    padding:16px 20px;
    background:linear-gradient(135deg,rgba(31,166,252,.06) 0%,rgba(108,92,231,.06) 100%);
    border-bottom:1px solid rgba(148,163,184,.08);
    flex-shrink:0;
  }
  #aiPanelHead .ai-header-left{display:flex;align-items:center;gap:10px}
  #aiPanelHead .ai-header-icon{
    width:34px;height:34px;border-radius:10px;
    background:linear-gradient(135deg,#1fa6fc,#6c5ce7);
    display:flex;align-items:center;justify-content:center;
    color:#fff;flex-shrink:0;
  }
  #aiPanelHead .ai-header-icon svg{width:16px;height:16px}
  #aiPanelHead .ai-header-text span{
    font-size:14px;font-weight:700;color:#f1f5f9;display:block;line-height:1.2
  }
  #aiPanelHead .ai-header-text small{
    font-size:11px;color:#64748b
  }
  #aiPanelHead .ai-header-actions{display:flex;gap:2px}
  #aiPanelHead .ai-header-actions button{
    background:none;border:none;color:#64748b;
    width:30px;height:30px;border-radius:8px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    transition:all .15s;
  }
  #aiPanelHead .ai-header-actions button:hover{
    background:rgba(255,255,255,.06);color:#f1f5f9
  }
  #aiPanelHead .ai-header-actions button svg{width:16px;height:16px}

  /* ========== LIMITS BAR ========== */
  #aiLimitsBar{
    padding:10px 20px;
    background:rgba(15,23,42,.5);
    border-bottom:1px solid rgba(148,163,184,.06);
    font-size:11.5px;color:#64748b;
    display:flex;align-items:center;gap:6px;
    flex-shrink:0;
  }
  #aiLimitsBar .limit-dot{
    width:6px;height:6px;border-radius:50%;
    background:#22c55e;flex-shrink:0;
  }
  #aiLimitsBar .limit-dot.warn{background:#f59e0b}
  #aiLimitsBar .limit-dot.danger{background:#ef4444}
  #aiLimitsBar b{color:#e2e8f0;font-weight:600}
  #aiLimitsBar .limit-divider{
    width:1px;height:12px;background:rgba(148,163,184,.15);margin:0 4px
  }

  /* ========== SESSIONS BAR ========== */
  #aiSessionsBar{
    display:flex;gap:6px;
    padding:10px 20px;
    border-bottom:1px solid rgba(148,163,184,.06);
    overflow-x:auto;overflow-y:hidden;
    scrollbar-width:none;
    flex-shrink:0;
    background:rgba(13,21,37,.3);
  }
  #aiSessionsBar::-webkit-scrollbar{display:none}
  .ai-session-chip{
    flex-shrink:0;
    padding:6px 14px;border-radius:10px;
    font-size:11.5px;font-weight:500;
    cursor:pointer;
    background:rgba(30,48,69,.6);
    color:#94a3b8;
    border:1px solid rgba(148,163,184,.08);
    transition:all .15s;
    max-width:130px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    display:flex;align-items:center;gap:6px;
  }
  .ai-session-chip:hover{
    border-color:rgba(148,163,184,.2);
    color:#e2e8f0;
    background:rgba(30,48,69,.9);
  }
  .ai-session-chip.active{
    background:linear-gradient(135deg,rgba(31,166,252,.15),rgba(108,92,231,.12));
    color:#1fa6fc;
    border-color:rgba(31,166,252,.3);
    font-weight:600;
  }
  .ai-session-chip .chip-close{
    width:14px;height:14px;border-radius:4px;
    display:flex;align-items:center;justify-content:center;
    opacity:0;transition:all .15s;flex-shrink:0;
    background:none;border:none;color:inherit;padding:0;
    cursor:pointer;
  }
  .ai-session-chip:hover .chip-close{opacity:.6}
  .ai-session-chip .chip-close:hover{opacity:1;background:rgba(239,68,68,.2);color:#ef4444}
  .ai-session-chip .chip-close svg{width:10px;height:10px}
  .ai-session-chip .chip-label{
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    flex:1;min-width:0;
  }
  .ai-session-chip .chip-rename{
    width:16px;height:16px;border-radius:4px;
    display:none;align-items:center;justify-content:center;
    background:none;border:none;color:#94a3b8;padding:0;cursor:pointer;
    flex-shrink:0;transition:all .15s;
  }
  .ai-session-chip:hover .chip-rename{display:flex}
  .ai-session-chip .chip-rename:hover{color:#1fa6fc;background:rgba(31,166,252,.15)}
  .ai-session-chip .chip-rename svg{width:10px;height:10px}
  .ai-session-new{
    border-style:dashed;border-color:rgba(148,163,184,.15);
    color:#64748b;font-weight:600;
  }
  .ai-session-new:hover{border-color:rgba(31,166,252,.4);color:#1fa6fc}

  /* ========== MESSAGES ========== */
  #aiChatMessages{
    flex:1;overflow-y:auto;overflow-x:hidden;
    padding:20px;
    display:flex;flex-direction:column;gap:12px;
    background:
      radial-gradient(ellipse at 20% 80%,rgba(31,166,252,.03) 0%,transparent 50%),
      radial-gradient(ellipse at 80% 20%,rgba(108,92,231,.03) 0%,transparent 50%),
      #0d1525;
  }
  #aiChatMessages::-webkit-scrollbar{width:5px}
  #aiChatMessages::-webkit-scrollbar-track{background:transparent}
  #aiChatMessages::-webkit-scrollbar-thumb{background:rgba(148,163,184,.15);border-radius:10px}
  #aiChatMessages::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,.25)}

  .ai-msg{
    max-width:82%;
    padding:12px 16px;
    border-radius:16px;
    font-size:13.5px;line-height:1.6;
    word-break:break-word;
    animation:msgFade .25s ease;
  }
  @keyframes msgFade{
    from{opacity:0;transform:translateY(6px)}
    to{opacity:1;transform:translateY(0)}
  }
  .ai-msg.user{
    align-self:flex-end;
    background:linear-gradient(135deg,#1fa6fc,#0b6fd1);
    color:#fff;
    border-bottom-right-radius:6px;
    box-shadow:0 2px 12px rgba(31,166,252,.2);
  }
  .ai-msg.assistant{
    align-self:flex-start;
    background:rgba(30,48,69,.7);
    color:#e2e8f0;
    border-bottom-left-radius:6px;
    border:1px solid rgba(148,163,184,.08);
  }
  .ai-msg.error{
    align-self:center;
    background:rgba(239,68,68,.1);
    color:#f87171;font-size:12px;
    border:1px solid rgba(239,68,68,.15);
  }

  /* Welcome */
  .ai-welcome{
    flex:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    text-align:center;padding:24px 20px;
  }
  .ai-welcome-icon{
    width:60px;height:60px;border-radius:16px;
    background:linear-gradient(135deg,#1fa6fc,#6c5ce7);
    display:flex;align-items:center;justify-content:center;
    color:#fff;margin-bottom:16px;
    box-shadow:0 8px 32px rgba(31,166,252,.25);
  }
  .ai-welcome-icon svg{width:28px;height:28px}
  .ai-welcome h3{
    font-size:17px;font-weight:700;color:#f1f5f9;
    margin-bottom:6px;
  }
  .ai-welcome p{
    font-size:13px;color:#64748b;max-width:280px;
    line-height:1.6;margin-bottom:20px;
  }
  .ai-welcome-chips{
    display:flex;flex-wrap:wrap;gap:6px;justify-content:center;
  }
  .ai-welcome-chip{
    padding:8px 14px;border-radius:10px;
    font-size:12px;cursor:pointer;
    background:rgba(30,48,69,.5);
    color:#94a3b8;
    border:1px solid rgba(148,163,184,.08);
    transition:all .15s;
  }
  .ai-welcome-chip:hover{
    border-color:rgba(31,166,252,.3);
    color:#1fa6fc;
    background:rgba(31,166,252,.06);
  }

  /* Typing */
  .ai-typing{display:flex;gap:4px;padding:4px 0}
  .ai-typing span{
    width:6px;height:6px;border-radius:50%;
    background:#64748b;
    animation:aiDot 1.2s infinite;
  }
  .ai-typing span:nth-child(2){animation-delay:.2s}
  .ai-typing span:nth-child(3){animation-delay:.4s}
  @keyframes aiDot{
    0%,80%,100%{opacity:.25;transform:scale(.8)}
    40%{opacity:1;transform:scale(1.1)}
  }

  /* ========== INPUT ========== */
  #aiChatInput{
    display:flex;gap:8px;
    padding:14px 20px;
    border-top:1px solid rgba(148,163,184,.06);
    background:rgba(13,21,37,.6);
    flex-shrink:0;
  }
  #aiChatInput input{
    flex:1;
    background:rgba(30,48,69,.5);
    border:1px solid rgba(148,163,184,.1);
    border-radius:12px;
    padding:11px 16px;
    color:#f1f5f9;font-size:13px;font-family:inherit;
    transition:all .2s;
  }
  #aiChatInput input:focus{
    outline:none;
    border-color:rgba(31,166,252,.4);
    box-shadow:0 0 0 3px rgba(31,166,252,.08);
    background:rgba(30,48,69,.7);
  }
  #aiChatInput input::placeholder{color:#475569}
  #aiChatInput button{
    background:linear-gradient(135deg,#1fa6fc,#6c5ce7);
    color:#fff;border:none;border-radius:12px;
    padding:11px 18px;font-size:13px;font-weight:600;
    cursor:pointer;white-space:nowrap;
    transition:all .2s;
    box-shadow:0 2px 12px rgba(31,166,252,.2);
  }
  #aiChatInput button:hover{
    transform:translateY(-1px);
    box-shadow:0 4px 16px rgba(31,166,252,.3);
  }
  #aiChatInput button:active{transform:translateY(0)}
  #aiChatInput button:disabled{opacity:.4;cursor:not-allowed;transform:none}

  /* ========== EMPTY STATE ========== */
  .ai-empty{
    flex:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    color:#475569;font-size:12px;gap:8px;
  }
  .ai-empty svg{width:28px;height:28px;opacity:.3}

  /* ========== RESPONSIVE ========== */
  @media(max-width:480px){
    #aiPanel{
      right:10px;left:10px;width:auto;
      bottom:88px;height:calc(100vh - 110px);
      border-radius:16px;
    }
    #aiFab{bottom:20px;right:20px}
  }
</style>

<button id="aiFab" title="FinMEI IA">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
</button>

<div id="aiPanel">
  <div id="aiPanelHead">
    <div class="ai-header-left">
      <div class="ai-header-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z"/></svg>
      </div>
      <div class="ai-header-text">
        <span>FinMEI IA</span>
        <small>Assistente financeiro</small>
      </div>
    </div>
    <div class="ai-header-actions">
      <button id="aiNewChat" title="Nova conversa">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button id="aiPanelClose" title="Fechar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </div>
  <div id="aiLimitsBar">
    <span class="limit-dot"></span>
    <span>Carregando...</span>
  </div>
  <div id="aiSessionsBar"></div>
  <div id="aiChatMessages"></div>
  <div id="aiChatInput">
    <input type="text" id="aiMsgInput" placeholder="Pergunte sobre seus dados..." autocomplete="off">
    <button id="aiSendBtn">Enviar</button>
  </div>
</div>

<!-- Modal Renomear Sessão -->
<div id="aiRenameModal" style="display:none;position:fixed;inset:0;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,.5);backdrop-filter:blur(4px)">
  <div style="background:#0f172a;border:1px solid rgba(148,163,184,.12);border-radius:14px;padding:24px;width:90%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
    <h3 style="margin:0 0 16px;font-size:15px;color:#e2e8f0;font-weight:600">Renomear conversa</h3>
    <form id="aiRenameForm">
      <input type="text" id="aiRenameInput" maxlength="50" placeholder="Nome da conversa"
        style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.6);color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button type="button" id="aiRenameCancel" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(148,163,184,.15);background:transparent;color:#94a3b8;cursor:pointer;font-size:12px">Cancelar</button>
        <button type="submit" style="padding:8px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#1fa6fc,#6c5ce7);color:#fff;cursor:pointer;font-size:12px;font-weight:600">Salvar</button>
      </div>
    </form>
  </div>
</div>
`;

let chatHistory = [];
let isLoading = false;
let currentSessionId = null;
let sessions = [];

async function loadSessions() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from('ai_sessions')
      .select('id, title, updated_at')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })
      .limit(15);
    sessions = data || [];
    renderSessions();
  } catch {}
}

function renderSessions() {
  const bar = document.getElementById('aiSessionsBar');
  if (!bar) return;

  if (!sessions.length) {
    bar.innerHTML = `<button class="ai-session-chip ai-session-new" onclick="aiNewChat()">+ Nova conversa</button>`;
    return;
  }

  // Chips com data-* em vez de onclick inline: o título ia escapado
  // para HTML e voltava com &quot; no campo de renomear.
  bar.innerHTML =
    `<button class="ai-session-chip ai-session-new" data-chip-acao="nova">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Nova
    </button>` +
    sessions.map(s => `
      <button class="ai-session-chip ${s.id === currentSessionId ? 'active' : ''}" data-chip="${escHtml(s.id)}" title="${escHtml(s.title)}">
        <span class="chip-label">${escHtml(s.title)}</span>
        <span class="chip-rename" data-chip-acao="renomear" title="Renomear">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>
        </span>
        <span class="chip-close" data-chip-acao="excluir" title="Excluir">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </span>
      </button>
    `).join('');

  if (!bar._delegado) {
    bar._delegado = true;
    bar.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-chip-acao]');
      if (acao && acao.dataset.chipAcao === 'nova') { window.aiNewChat(); return; }

      const chip = e.target.closest('[data-chip]');
      if (!chip) return;
      const sessao = sessions.find(x => x.id === chip.dataset.chip)
        || { id: chip.dataset.chip, title: '' };

      if (!acao) { window.aiSwitchSession(sessao.id); return; }

      e.stopPropagation();
      if (acao.dataset.chipAcao === 'renomear') {
        window.aiRenameSession(sessao.id, sessao.title || '');
      } else if (acao.dataset.chipAcao === 'excluir') {
        window.aiDeleteSession(sessao.id);
      }
    });
  }

  // Auto-scroll to active
  const active = bar.querySelector('.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

window.aiNewChat = async () => {
  currentSessionId = null;
  chatHistory = [];
  renderChatHistory();
  renderSessions();
  document.getElementById('aiMsgInput')?.focus();
};

window.aiSwitchSession = async (id) => {
  currentSessionId = id;
  renderSessions();
  await loadSessionMessages(id);
};

window.aiDeleteSession = async (id) => {
  if (!confirm('Excluir esta conversa?')) return;
  try {
    const { error } = await supabase.from('ai_sessions').delete().eq('id', id);
    if (error) throw error;
    if (currentSessionId === id) {
      currentSessionId = null;
      chatHistory = [];
      renderChatHistory();
    }
    await loadSessions();
  } catch (e) {
    console.error('Erro ao excluir:', e);
  }
};

window.aiRenameSession = async (id, currentTitle) => {
  const modal = document.getElementById('aiRenameModal');
  const input = document.getElementById('aiRenameInput');
  const form = document.getElementById('aiRenameForm');
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
      const { error } = await supabase.from('ai_sessions').update({ title: newTitle }).eq('id', id);
      if (error) throw error;
      const session = sessions.find(s => s.id === id);
      if (session) session.title = newTitle;
      renderSessions();
    } catch (e) {
      console.error('Erro ao renomear:', e);
    }

    modal.style.display = 'none';
  };

  const handleCancel = () => {
    modal.style.display = 'none';
  };

  form.removeEventListener('submit', handleSubmit);
  form.addEventListener('submit', handleSubmit);

  const cancelBtn = document.getElementById('aiRenameCancel');
  if (cancelBtn) {
    cancelBtn.removeEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
  }

  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
};

async function loadSessionMessages(sessionId) {
  try {
    const { data } = await supabase
      .from('ai_conversations')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    chatHistory = (data || []).map(m => ({ role: m.role, content: m.content }));
    renderChatHistory();
  } catch {}
}

function renderChatHistory() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  if (!chatHistory.length) {
    container.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-welcome-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z"/></svg>
        </div>
        <h3>FinMEI IA</h3>
        <p>Seu assistente financeiro. Consulte vendas, gastos, cadastre registros e muito mais.</p>
        <div class="ai-welcome-chips">
          <button class="ai-welcome-chip" onclick="aiSuggestion('Quanto eu faturei esse mês?')">Faturamento</button>
          <button class="ai-welcome-chip" onclick="aiSuggestion('Me dá um resumo do negócio')">Resumo</button>
          <button class="ai-welcome-chip" onclick="aiSuggestion('Quais são meus top gastos?')">Top gastos</button>
          <button class="ai-welcome-chip" onclick="aiSuggestion('Cadastra um gasto de 80 reais em aluguel')">Cadastrar gasto</button>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  for (const msg of chatHistory) {
    const div = document.createElement('div');
    div.className = `ai-msg ${msg.role}`;
    div.textContent = msg.content;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

window.aiSuggestion = (text) => {
  const input = document.getElementById('aiMsgInput');
  if (input) input.value = text;
  sendMessage();
};

function addMsg(role, content) {
  const container = document.getElementById('aiChatMessages');
  // Remove welcome if present
  const welcome = container.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = content;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function init() {
  if (document.getElementById('aiFab')) return;
  document.body.insertAdjacentHTML('beforeend', FAB_HTML);

  const fab = document.getElementById('aiFab');
  const panel = document.getElementById('aiPanel');
  const closeBtn = document.getElementById('aiPanelClose');
  const newChatBtn = document.getElementById('aiNewChat');
  const sendBtn = document.getElementById('aiSendBtn');
  const msgInput = document.getElementById('aiMsgInput');

  fab.addEventListener('click', async () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      await loadSessions();
      renderChatHistory();
      loadLimits();
      msgInput.focus();
      fab.classList.remove('pulse');
    }
  });

  closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  newChatBtn.addEventListener('click', () => window.aiNewChat());

  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  loadLimits();
}

async function loadLimits() {
  const bar = document.getElementById('aiLimitsBar');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      bar.innerHTML = '<span class="limit-dot" style="background:#f59e0b"></span><span>Faça <b>login</b> para usar a IA</span>';
      return;
    }

    // Mesma fonte que o servidor usa para decidir o limite.
    const { data: uso } = await supabase.rpc('meu_uso_plano');
    const plan = uso?.plano || 'gratuito';
    const msgUsed = uso?.ia?.usado ?? 0;
    const msgMax = uso?.ia?.max ?? 10;
    const pct = msgMax > 0 ? (msgUsed / msgMax) : 0;

    let dotClass = '';
    if (pct >= 0.9) dotClass = 'danger';
    else if (pct >= 0.6) dotClass = 'warn';

    bar.innerHTML = `
      <span class="limit-dot ${dotClass}"></span>
      <span><b>${plan}</b></span>
      <span class="limit-divider"></span>
      <span>Mensagens: <b>${msgUsed}/${msgMax}</b></span>
    `;
  } catch {
    bar.innerHTML = '<span class="limit-dot"></span><span>Plano: <b>gratuito</b> | Mensagens: <b>0/10</b></span>';
  }
}

async function sendMessage() {
  if (isLoading) return;
  const input = document.getElementById('aiMsgInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMsg('user', text);

  isLoading = true;
  const sendBtn = document.getElementById('aiSendBtn');
  sendBtn.disabled = true;

  const caixa = document.getElementById('aiChatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'ai-msg assistant';
  typingDiv.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
  caixa.appendChild(typingDiv);
  caixa.scrollTop = caixa.scrollHeight;

  // Mostra o que a IA está fazendo em vez de um spinner mudo
  const mostrarStatus = (t) => {
    typingDiv.textContent = t;
    typingDiv.style.opacity = '0.75';
    typingDiv.style.fontStyle = 'italic';
    caixa.scrollTop = caixa.scrollHeight;
  };

  let bolha = null;
  let texto = '';
  const escrever = (novo) => {
    texto = novo;
    if (!bolha) {
      typingDiv.remove();
      bolha = addMsg('assistant', '');
    }
    bolha.textContent = texto;
    caixa.scrollTop = caixa.scrollHeight;
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Faça login para usar a IA');

    const res = await fetch(
      `${supabase.supabaseUrl}/functions/v1/ai-chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': supabase.supabaseKey,
        },
        body: JSON.stringify({ message: text, session_id: currentSessionId, stream: true }),
      }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `Erro ${res.status}`);
    }

    const tipo = res.headers.get('content-type') || '';

    // Servidor sem streaming: cai no modo JSON de antes
    if (!tipo.includes('text/event-stream')) {
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      typingDiv.remove();
      addMsg('assistant', data?.content || 'Sem resposta.');
      if (data.session_id && data.session_id !== currentSessionId) {
        currentSessionId = data.session_id;
        await loadSessions();
      }
      loadLimits();
      return;
    }

    let novaSessao = null;
    let houveErro = null;

    await lerStreamIA(res, {
      onSession: (id) => { novaSessao = id; },
      onStatus: mostrarStatus,
      onDelta: (t) => escrever(texto + t),
      onReplace: (t) => escrever(t),
      onReset: () => escrever(''),
      onError: (erro) => { houveErro = erro; },
      onDone: async (evento) => {
        escrever(evento.content || texto);
        const id = evento.session_id || novaSessao;
        if (id && id !== currentSessionId) {
          currentSessionId = id;
          await loadSessions();
        }
      },
    });

    if (houveErro) throw new Error(houveErro);
    loadLimits();

  } catch (e) {
    typingDiv.remove();
    if (bolha) bolha.remove();
    addMsg('error', e.message || 'Erro ao conectar com a IA.');
  } finally {
    isLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
