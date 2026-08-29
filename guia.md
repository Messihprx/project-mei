# 🚀 Guia de Configuração — FinMEI

Este guia cobre tudo que precisa ser feito **fora do código** para o sistema
funcionar: scripts SQL, secrets, deploy das Edge Functions e configuração do
Mercado Pago e do app de BI.

Para entender o projeto (o que é, como está organizado, como rodar local),
comece pelo [README.md](README.md).

---

## ⚠️ Antes de qualquer coisa

**Troque a senha do usuário administrador.** A senha antiga (`admin123`) estava
escrita num comentário HTML dentro de `public/admin/admin-login.html`, visível
para qualquer pessoa com "Exibir código-fonte" no navegador. O comentário foi
removido do código, mas a senha em si só pode ser trocada por você:

> Supabase → Authentication → Users → `admin@finmei.com.br` → Reset password

---

## 1. Scripts SQL

Rode no **Supabase → SQL Editor**, **nesta ordem**:

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `sql/plano_limites.sql` | Tabela de limites + funções `plano_ativo()` / `limite_disponivel()` + **triggers que aplicam o plano no banco** |
| 2 | `sql/assinaturas.sql` | Assinatura recorrente do Mercado Pago |
| 3 | `sql/dashboard_rpc.sql` | Agregação do dashboard no servidor |
| 4 | `sql/bi_handoff.sql` | Acesso seguro ao app de BI |
| 5 | `sql/rpc_throttle.sql` | Limite de taxa na verificação de e-mail |
| 6 | `sql/indices.sql` | Índices das tabelas de negócio |
| 7 | `sql/gateway_webhook_secret.sql` | Chave de assinatura do webhook, editável pelo admin |
| 8 | `sql/ai_providers_extra.sql` | Autenticação livre nos provedores de IA (header, prefixo, headers extras) |
| 9 | `sql/ai_logs.sql` | Registro de falhas da IA, visível no painel |
| 10 | `sql/consistencia.sql` | Corrige a data das vendas importadas e unifica os limites entre tela e banco |

> Os scripts assumem que `sql/admin_supabase.sql` (função `is_admin()`) já foi
> executado. Se ainda não foi, rode-o antes do item 1.

**Por que isso importa:** até aqui os limites do plano gratuito existiam apenas
no JavaScript do navegador. Dava para contorná-los pelo DevTools, por chamada
direta à API, ou simplesmente pedindo ao chat de IA para cadastrar. As triggers
do item 1 fecham os três caminhos de uma vez — a service role ignora RLS, mas
não ignora trigger.

---

## 2. Secrets do Supabase

Só um segredo precisa de linha de comando:

```bash
# Segredo compartilhado com o app de BI.
# Invente uma string longa e aleatória — ela precisa ser IDÊNTICA
# à que você vai colocar nos Secrets do Streamlit (passo 6).
npx supabase secrets set BI_SHARED_SECRET=UMA_STRING_LONGA_E_ALEATORIA
```

**O access token e a chave secreta do webhook do Mercado Pago não vão
aqui** — os dois são configurados pela tela *Config. de pagamento* do
painel admin, e podem ser trocados a qualquer momento sem redeploy.

> Por que o `BI_SHARED_SECRET` é diferente: ele é um segredo compartilhado
> entre dois sistemas. Mesmo guardado no banco, o Streamlit continuaria
> precisando da própria cópia — deixá-lo editável pela tela só criaria um
> jeito fácil de trocar de um lado, esquecer do outro e derrubar o BI.

---

## 3. Deploy das Edge Functions

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_ID

# Funções autenticadas (o usuário vem do token JWT)
npx supabase functions deploy mp-checkout
npx supabase functions deploy mp-subscription
npx supabase functions deploy mp-config
npx supabase functions deploy ai-chat
npx supabase functions deploy ai-config
npx supabase functions deploy admin-users
npx supabase functions deploy bi-token

# Webhook: precisa ser público (o Mercado Pago chama sem JWT).
# Quem autentica aqui é a assinatura HMAC, não o JWT.
npx supabase functions deploy mp-webhook --no-verify-jwt
```

### Publicando pelo painel do Supabase

Se você cola o código no painel em vez de usar o CLI, cada função é um
arquivo só — o painel não consegue puxar um arquivo de fora da pasta dela.
Por isso **nada aqui usa import entre funções**: o `ai-chat/index.ts` é
autossuficiente, mesmo sendo grande (~2600 linhas). Basta abrir a função
no painel, selecionar tudo e colar o conteúdo do arquivo.

O playground, a busca de modelos e o teste de tools do painel admin também
ficam dentro da `ai-chat`, como ações (`action: test_provider`,
`list_models`, `test_tools`), todas protegidas por verificação de admin.
Não existe função separada para diagnóstico — e isso garante, por
construção, que o teste roda o mesmo código que atende os usuários.

> **Mudança importante:** `mp-checkout` **não usa mais** `--no-verify-jwt`.
> Ela agora exige login e tira o `userId` do token, em vez de aceitar o que
> vier no corpo da requisição.

---

## 4. Mercado Pago

No **Painel de Desenvolvedores → sua aplicação → Webhooks**, configure a URL de
produção:

```
https://SEU_PROJECT_ID.supabase.co/functions/v1/mp-webhook
```

Marque os eventos:

- **Pagamentos** (`payment`) — pagamento avulso via PIX
- **Assinaturas** (`preapproval` / `subscription_preapproval`) — criação e cancelamento
- **Cobranças recorrentes** (`subscription_authorized_payment`) — renovação mensal

Copie a **chave secreta** exibida nessa tela de webhooks e cole em
**Painel admin → Config. de pagamento → Chave secreta do Webhook**.

É ela que prova que a notificação veio mesmo do Mercado Pago. Sem ela o
sistema continua recebendo os avisos de pagamento, mas sem conseguir
conferir a origem — o card "Webhook" do painel fica em **Sem verificação**
nesse caso.

### Cartão recorrente x PIX avulso

O Mercado Pago só faz cobrança automática no **cartão de crédito** — PIX e
boleto não podem ser recorrentes. Por isso o sistema oferece os dois caminhos:

- **Cartão** → assinatura recorrente. Cobra sozinha todo mês. Ao cancelar, o
  acesso Premium **continua até o fim do período já pago** e só então cai.
- **PIX / boleto** → pagamento avulso de 30 dias, com renovação manual.

Para ligar a recorrência: **Painel admin → Config. de pagamento → "Assinatura
recorrente no cartão"**. Com ela desligada, só o pagamento avulso aparece.

---

## 5. Configuração pelo painel admin

Com o sistema no ar, quase nada mais precisa de deploy:

- **Config. de pagamento** — access token, preço, parcelas, URLs de retorno e
  a chave da recorrência.
- **Planos e limites** — quantos clientes, movimentações e produtos cada plano
  permite, e quantos dias dura o teste gratuito. Campo vazio = ilimitado.
  Reduzir um limite não apaga nada de quem já passou dele; apenas impede novos
  cadastros.
- **Configuração de IA** — quatro sub-abas: Provedores (cadastro e chaves),
  Playground (testar antes de salvar), Diagnóstico (rodar as ações da IA) e
  Erros (o que falhou e por quê). Detalhes na seção 8.

---

## 6. App de BI (Streamlit)

Em **Settings → Secrets** do app no Streamlit Cloud:

```toml
SUPABASE_URL = "https://SEU_PROJECT_ID.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_..."   # chave PÚBLICA, nunca a service role
BI_SHARED_SECRET = "a mesma string do passo 2"
```

> **Atenção:** se antes você tinha `SUPABASE_KEY` com a **service role**, troque
> pela chave anon/publishable e **remova** `ADMIN_PASSWORD`. O app não usa mais
> nenhuma das duas.

**O que mudou:** o relatório era aberto com `?user_id=<uuid>` e o Streamlit
confiava nesse parâmetro, lendo a base inteira com service role — quem tivesse
o UUID de alguém via o financeiro daquela pessoa, e havia uma senha mestra com
valor padrão embutido no código. Agora o site gera um código de uso único
válido por 5 minutos, o Streamlit troca esse código pela sessão do usuário, e
**quem filtra os dados é o RLS do Postgres**. O modo administrador saiu da URL
e passou a depender de `perfis.role = 'admin'`.

Se o endereço do app no Streamlit mudar, atualize a constante `urlStreamlit` em
`public/js/dashboard.js`.

---

---

## 7. Rodar local e publicado sem trocar nada no código

A pasta `public/` vira a **raiz** do site no Netlify, mas continua sendo uma
subpasta quando você abre o projeto local. Então o mesmo link tem dois
endereços:

| | Local | Netlify |
|---|---|---|
| Login | `/public/login.html` | `/login.html` |
| Escopo do app | `/public/` | `/` |

Nada disso está fixo no código: os redirects do login com Google, da
confirmação de e-mail e da recuperação de senha são resolvidos **relativos à
página atual** (`urlDoApp` em `public/js/auth.js`), e o service worker e o
manifest derivam o escopo do próprio endereço em que foram carregados. Publicar
não exige editar caminho nenhum.

Só falta um ajuste, e ele é no **Supabase**, não no código:

> **Authentication → URL Configuration → Redirect URLs**
>
> Cadastre os dois padrões:
> ```
> http://localhost:5500/public/**
> https://SEU-SITE.netlify.app/**
> ```
> (troque a porta pela do seu servidor local)

O Supabase só aceita redirecionar para endereços que estejam nessa lista. Sem o
padrão local, o login com Google e os links de e-mail funcionam publicados mas
falham na sua máquina — e vice-versa.

---

---

## 8. Diagnóstico da IA (aba "Configuração de IA")

A aba tem quatro telas:

**Provedores** — cadastro. Além dos presets prontos (OpenAI, Gemini, Groq,
OpenRouter, Anthropic, LiteLLM, Ollama e outros), há um bloco
**"Autenticação e headers avançados"** em cada provedor. É por ali que entram
os endpoints fora do padrão:

| Caso | Header de auth | Prefixo | Observação |
|---|---|---|---|
| Padrão (OpenAI, Groq, LiteLLM…) | `Authorization` | `Bearer ` | — |
| Azure OpenAI | `api-key` | *(vazio)* | URL precisa do `?api-version=` |
| Anthropic | `x-api-key` | *(vazio)* | o tipo "Anthropic" já ajusta sozinho |
| Ollama local | *(qualquer)* | *(vazio)* | não pede chave |
| Gateway corporativo | `X-Api-Key` | conforme o gateway | headers extras em JSON |

O botão **Buscar** ao lado do campo Modelo consulta a lista de modelos da conta.
O campo continua aceitando texto livre — quem usa deployment do Azure ou alias
do LiteLLM, que as APIs não listam, digita normalmente.

**Playground** — manda uma mensagem de teste para um provedor e mostra status,
tempo, tokens, resposta e, quando falha, o erro cru que o provedor devolveu.
Funciona com provedor **ainda não salvo**, então dá para validar a chave antes
de gravar. Marcando "usar contexto e tools reais", roda com o mesmo system
prompt e as mesmas tools do chat.

**Diagnóstico** — executa as tools da IA na sua conta de admin. As de leitura
rodam sempre. Marcando "incluir tools de escrita", cria registros `[TESTE]` e
apaga em seguida — é o que revela bloqueio por limite de plano ou por trigger.
Se alguma limpeza falhar, a linha mostra o id que ficou para trás.

**Erros** — o que falhou e por quê: recusa do provedor (com status HTTP e corpo
da resposta), tool que devolveu erro, argumentos que o modelo mandou quebrados,
e troca de provedor no fallback. Guarda 30 dias.

---

## 9. Ao publicar em produção

- [ ] Senha do admin trocada
- [ ] Redirect URLs do Supabase com os padrões local **e** de produção
- [ ] Os 10 scripts SQL executados
- [ ] `BI_SHARED_SECRET` configurado no Supabase **e** no Streamlit, com o mesmo valor
- [ ] Access token e chave secreta do webhook preenchidos no painel admin
- [ ] Card "Webhook" do painel admin mostrando **Configurado** (e não "Sem verificação")
- [ ] Edge Functions publicadas
- [ ] Webhook do MP apontando para a URL certa, com os 3 eventos marcados
- [ ] URLs de retorno (`checkout_sucesso/erro/pendente`) apontando para o domínio real
- [ ] Preço confirmado no painel admin (R$ 15,90 e não R$ 1,00 de teste)
- [ ] Secrets do Streamlit trocados para a chave anon
- [ ] Testado com as credenciais de **teste** do Mercado Pago antes das de produção
- [ ] Provedor de IA validado pelo **Playground** (aba IA → Playground)
- [ ] **Diagnóstico** de tools rodado sem falhas (aba IA → Diagnóstico)
