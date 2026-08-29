// ============================================================
// Utilitários de DOM compartilhados
//
// O painel admin já escapava tudo (esc() em admin/js/admin.js),
// mas o app do cliente montava innerHTML com nome, descrição e
// observação vindos do banco sem escapar. Além do risco de XSS,
// isso quebrava na prática: uma venda chamada "Pão d'alho"
// derrubava o botão de editar, porque o valor era injetado
// dentro de onclick="...('${descricao}')".
//
// A solução é dupla: escapar texto e parar de gerar handler
// inline — os botões passam a usar data-* + delegação.
// ============================================================

/** Escapa texto para interpolar com segurança dentro de innerHTML. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Delegação de evento: um listener no container atende todos os
 * itens da lista, inclusive os que ainda vão ser renderizados.
 * O handler recebe (evento, elementoQueCasou).
 */
export function delegate(container, seletor, evento, handler) {
  if (!container) return;
  container.addEventListener(evento, (e) => {
    const alvo = e.target.closest(seletor);
    if (alvo && container.contains(alvo)) handler(e, alvo);
  });
}

/**
 * Protege contra CSV injection: uma célula começando com = + - @
 * é interpretada como fórmula pelo Excel/Sheets ao abrir o arquivo.
 */
export function csvCell(valor) {
  let s = String(valor ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  if (s.includes('"') || s.includes(';') || s.includes(',')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Monta um CSV com separador ; (padrão do Excel em pt-BR). */
export function montarCsv(cabecalho, linhas) {
  const head = cabecalho.map(csvCell).join(';');
  const body = linhas.map(l => l.map(csvCell).join(';')).join('\n');
  return head + '\n' + body + '\n';
}

// ==================== LEITURA DO STREAM (SSE) ====================
//
// A edge function responde em text/event-stream quando pedimos
// { stream: true }. Cada evento é um JSON numa linha "data: ".
//   status  -> o que está acontecendo ("Consultando suas vendas...")
//   delta   -> pedaço do texto, exibido na hora
//   replace -> troca o texto todo (quando a resposta final não veio
//              do modelo, e sim do resumo das ações executadas)
//   reset   -> descarta o que já foi escrito: o provedor falhou no
//              meio e outro vai recomeçar a resposta do zero
//   done    -> conteúdo final + contador de uso
export async function lerStreamIA(resposta, handlers) {
  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalizado = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      const t = linha.trim();
      if (!t.startsWith('data:')) continue;

      let evento;
      try { evento = JSON.parse(t.slice(5).trim()); } catch { continue; }

      switch (evento.type) {
        case 'session': handlers.onSession?.(evento.session_id); break;
        case 'status':  handlers.onStatus?.(evento.text); break;
        case 'delta':   handlers.onDelta?.(evento.text); break;
        case 'replace': handlers.onReplace?.(evento.text); break;
        case 'reset':   handlers.onReset?.(); break;
        case 'error':   handlers.onError?.(evento.error); finalizado = true; break;
        case 'done':    handlers.onDone?.(evento); finalizado = true; break;
      }
    }
  }

  if (!finalizado) handlers.onError?.('A conexão foi interrompida antes da resposta terminar.');
}

// ============================================================
// Paginação simples
//
// As listagens buscavam tudo sem .limit(). O PostgREST corta em
// 1000 linhas em silêncio, então acima disso a tela ficava
// incompleta sem nenhum aviso. Agora cada lista pede um lote e
// oferece "carregar mais".
// ============================================================

export const TAMANHO_PAGINA = 50;

/**
 * Acrescenta o botão "Carregar mais" quando o lote veio cheio
 * (sinal de que provavelmente há mais registros).
 *
 * @param {HTMLElement} container onde a lista foi renderizada
 * @param {number} recebidos      quantos vieram nesta consulta
 * @param {number} limiteAtual    limite usado na consulta
 * @param {Function} aoCarregarMais recebe o novo limite
 */
export function botaoCarregarMais(container, recebidos, limiteAtual, aoCarregarMais) {
  if (!container || recebidos < limiteAtual) return;

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'btn-carregar-mais';
  botao.textContent = 'Carregar mais';
  botao.style.cssText =
    'display:block;margin:16px auto 0;padding:10px 22px;border-radius:10px;' +
    'background:var(--fundo-card-2);color:var(--texto-secundario);' +
    'border:1px solid var(--borda-cor);cursor:pointer;font-size:0.85rem;font-weight:600;';

  botao.addEventListener('click', () => {
    botao.disabled = true;
    botao.textContent = 'Carregando...';
    aoCarregarMais(limiteAtual + TAMANHO_PAGINA);
  });

  container.appendChild(botao);
}
