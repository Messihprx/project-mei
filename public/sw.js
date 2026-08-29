// ============================================================
// Service Worker do FinMEI
//
// Objetivo: abrir instantâneo na segunda visita e mostrar uma tela
// decente sem internet, em vez do erro do navegador.
//
// Regra que não pode ser quebrada: DADO FINANCEIRO NUNCA É
// CACHEADO. Tudo que fala com o Supabase passa direto pela rede.
// O cache guarda só a "casca" do app (HTML, CSS, JS, ícones).
// ============================================================

// A base sai do próprio endereço do service worker, não de uma barra
// fixa. Publicado no Netlify (public/ vira a raiz) resolve para "/";
// aberto localmente a partir da raiz do repositório, resolve para
// "/public/". Sem configuração e sem mexer no código ao publicar.
const BASE = new URL('./', self.location.href);
const paraUrl = (caminho) => new URL(caminho, BASE).href;

const VERSAO = 'finmei-v1';
const CACHE_CASCA = `casca-${VERSAO}`;
const OFFLINE_URL = paraUrl('offline.html');
const ADMIN_URL = paraUrl('admin/');

// Arquivos da casca. Se algum falhar, a instalação não é abortada:
// um 404 aqui não pode impedir o app de funcionar.
const CASCA = [
  'offline.html',
  'css/style.css',
  'manifest.json',
  'icon_mei.ico',
].map(paraUrl);

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_CASCA);
    await Promise.allSettled(CASCA.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(
      nomes.filter(n => n !== CACHE_CASCA).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Só o que é seguro guardar
function podeCachear(url) {
  if (url.origin !== self.location.origin) return false;
  if (!url.href.startsWith(BASE.href)) return false;      // fora do escopo do app
  if (url.href.startsWith(ADMIN_URL)) return false;       // painel admin fora do cache
  return /\.(css|js|png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase (dados, auth, storage, edge functions): sempre rede.
  // Nada de saldo, venda ou cliente parando em cache.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Navegação: rede primeiro, tela offline como último recurso.
  // Nunca servimos uma página do app pelo cache, para o usuário não
  // ver números velhos achando que são os de agora.
  if (req.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE_CASCA);
        return (await cache.match(OFFLINE_URL)) || new Response(
          'Você está offline.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Estáticos: cache primeiro, revalidando em segundo plano.
  if (podeCachear(url)) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE_CASCA);
      const emCache = await cache.match(req);

      const daRede = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      }).catch(() => null);

      return emCache || (await daRede) || new Response('', { status: 504 });
    })());
  }
});
