# FinMEI

Sistema de gestão financeira para MEI (Microempreendedor Individual). Controle
de vendas, gastos, clientes, produtos e devedores, com dashboard, assistente de
IA que executa ações por conversa, relatórios de BI e assinatura paga.

---

## Como funciona, em uma frase

Um site estático (HTML + JavaScript puro, sem build) que fala direto com o
Supabase. Tudo que precisa de segredo ou de privilégio roda em Edge Functions.
Não há servidor próprio para manter.

```
navegador  ──►  Supabase (Postgres + Auth + Storage)
     │              ▲
     │              │ service role
     └──────►  Edge Functions  ──►  Mercado Pago / provedores de IA
```

**A regra que sustenta o resto:** o navegador nunca é fonte de verdade. Ele só
enxerga as linhas que o RLS deixa, e os limites do plano são aplicados por
trigger no banco — não por JavaScript. O que a tela faz é avisar antes, para a
pessoa não descobrir o bloqueio depois de digitar tudo.

---

## Stack

| Camada | O que é |
|---|---|
| Frontend | HTML + CSS + JavaScript ES modules. Sem framework, sem bundler, sem `npm install`. |
| Banco, auth e arquivos | Supabase (PostgreSQL com RLS) |
| Backend | Supabase Edge Functions (Deno / TypeScript) |
| Pagamento | Mercado Pago — assinatura recorrente no cartão e pagamento avulso no PIX |
| IA | Qualquer provedor compatível com OpenAI, mais Google Gemini e Anthropic nativos |
| Relatórios BI | App Streamlit separado ([app.py](app.py)) |
| Hospedagem | Netlify (publica a pasta `public/`) |

---

## Estrutura de pastas

```
public/              o site. É a raiz publicada no Netlify
  *.html             uma página por tela
  js/                um módulo por tela + utilitários compartilhados
  css/style.css      design system (tokens em :root)
  admin/             painel administrativo, isolado do resto
  manifest.json      PWA
  sw.js              service worker

supabase/functions/  Edge Functions, uma pasta por função
sql/                 scripts do banco, numerados no guia.md
email-templates/     HTML dos e-mails, colado no painel do Supabase
app.py               app de BI em Streamlit (deploy separado)
estrutura.sql        referência do schema atual (não é para rodar)
guia.md              como configurar e publicar
```

### Os módulos JavaScript

| Arquivo | Responsabilidade |
|---|---|
| [auth.js](public/js/auth.js) | Cliente Supabase, login/cadastro, proteção de rota, tradução de erros, modal |
| [planos.js](public/js/planos.js) | Estado do plano, limites, assinatura e cancelamento |
| [dom-utils.js](public/js/dom-utils.js) | `esc()`, delegação de evento, CSV seguro, leitura de stream, paginação |
| [dashboard.js](public/js/dashboard.js) | Tela inicial (consome uma RPC única) |
| vendas / gastos / clientes / produtos / devendo | Uma tela cada |
| [ia.js](public/js/ia.js) / [ai-fab.js](public/js/ai-fab.js) | Chat de IA: página cheia e botão flutuante |
| [admin/js/admin.js](public/admin/js/admin.js) | Painel inteiro, com roteamento próprio |

**Convenção importante:** os módulos de tela nunca montam HTML com dados do
banco sem passar por `esc()`, e os botões de lista usam `data-*` com delegação
de evento em vez de `onclick` inline. Handler inline com dado interpolado
quebra em nomes com apóstrofo e abre porta para XSS.

O painel admin é a exceção deliberada: ele usa `onclick` inline porque não é
módulo ES, então as funções precisam ser globais.

---

## Rodando local

Não há build. Sirva a pasta do projeto com qualquer servidor estático:

```bash
npx serve .          # ou a extensão Live Server do VS Code
```

Abra `http://127.0.0.1:5500` (ou a porta que aparecer). O `index.html` da raiz
detecta sozinho onde está e redireciona para `public/login.html`.

**Um passo obrigatório no Supabase**, senão o login com Google e os links de
e-mail falham só na sua máquina:

> Authentication → URL Configuration → Redirect URLs
> ```
> http://127.0.0.1:5500/public/**
> https://SEU-SITE.netlify.app/**
> ```

### Por que funciona local e publicado sem trocar nada

No Netlify a pasta `public/` vira a raiz do site (`/login.html`); local ela é
uma subpasta (`/public/login.html`). Nenhum caminho está fixo no código:

- os redirects de auth usam `urlDoApp()`, que resolve relativo à página atual
- o `manifest.json` usa caminhos relativos a ele mesmo
- o `sw.js` deriva o escopo do próprio endereço
- as URLs de retorno do pagamento vêm do site que fez a chamada, validadas
  contra o header `Origin`

---

## Publicando

O passo a passo completo está em **[guia.md](guia.md)**: scripts SQL na ordem,
secrets, deploy das funções, configuração do Mercado Pago e do app de BI.

Resumo: rodar os 10 scripts de `sql/`, publicar as 8 Edge Functions, e apontar
o Netlify para a pasta `public/`.

---

## Decisões que valem conhecer antes de mexer

**Os limites de plano vivem no banco.** `plano_limites` é editável no painel
admin, e triggers `BEFORE INSERT` aplicam. A service role ignora RLS mas **não**
ignora trigger — é por isso que o chat de IA também respeita o limite. Nenhum
número de limite deve ser escrito à mão no código: a tela lê de
`meu_uso_plano()` e a IA recebe os valores no contexto.

**Cancelar assinatura não corta o acesso na hora.** O usuário pagou o período
corrente. O webhook grava `assinatura_status = 'cancelled'` e deixa `plano` e
`expira_em` intactos; quem derruba o acesso depois é `plano_ativo()`, quando a
data passa.

**`data_venda` é a data de negócio.** `created_at` é quando a linha foi criada.
Toda tela filtra e exibe por `data_venda` — misturar os dois faz a mesma venda
aparecer em meses diferentes no dashboard e na listagem.

**A `ai-chat` é um arquivo só, grande de propósito.** As Edge Functions são
publicadas pelo painel do Supabase, colando o código, e o painel não consegue
importar arquivo de fora da pasta da função. O diagnóstico do admin vive dentro
dela como ações (`test_provider`, `list_models`, `test_tools`) — o que garante,
por construção, que o teste roda o mesmo código que atende os usuários.

**Se um provedor de IA falhar, o próximo assume.** Há timeout por chamada,
orçamento de tempo para a requisição inteira, fatia reservada por provedor,
retry só em falha passageira, e detecção de resposta vazia. Todas as falhas vão
para `ai_error_logs`, visíveis em Admin → IA → Erros.

**Nenhum segredo trafega sem ser pedido.** Chaves de API e tokens não
acompanham o carregamento das telas: a tela só sabe se existe algo salvo. Ao
clicar no olho, uma chamada específica busca aquele segredo, e o acesso fica
registrado no log da função.

---

## Painel administrativo

Em `/admin/admin-login.html`, restrito a `perfis.role = 'admin'`.

| Aba | Para quê |
|---|---|
| Dashboard | Visão geral do sistema |
| Usuários | Lista, detalhe, criação e exclusão |
| Assinaturas / Pagamentos | Acompanhamento |
| Config. de pagamento | Credenciais do Mercado Pago, preço, recorrência |
| Planos e limites | Quanto cada plano pode cadastrar |
| Configuração de IA | Provedores, Playground, Diagnóstico e Erros |

---

## Onde olhar quando algo quebra

| Sintoma | Onde |
|---|---|
| IA não responde | Admin → IA → **Erros** (motivo real, com status HTTP) |
| Provedor novo não funciona | Admin → IA → **Playground** (testa antes de salvar) |
| Tool da IA falhando | Admin → IA → **Diagnóstico** |
| Pagamento não libera | Logs da função `mp-webhook` no Supabase |
| Cadastro bloqueado | Erro traz o motivo (`LIMITE_ATINGIDO` / `PLANO_EXPIRADO`) |
| Relatório BI não abre | Logs da função `bi-token`; conferir `BI_SHARED_SECRET` nos dois lados |

---

## Changelog

[changelog.json](changelog.json) — também exibido dentro do app.
