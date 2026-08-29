# Edge Functions

Uma pasta por função, cada `index.ts` autossuficiente. **Nenhuma importa de
outra** — as funções são publicadas pelo painel do Supabase, colando o código,
e o painel não consegue puxar um arquivo de fora da pasta da função.

| Função | Quem chama | Auth | Para quê |
|---|---|---|---|
| `ai-chat` | app + admin | usuário / admin | Chat de IA e diagnóstico do painel |
| `ai-config` | admin | admin | Ler e salvar provedores e limites de IA |
| `admin-users` | admin | admin | Criar e excluir usuários |
| `mp-checkout` | app | usuário | Pagamento avulso (PIX / Checkout Pro) |
| `mp-subscription` | app | usuário | Criar e cancelar assinatura recorrente |
| `mp-config` | admin | admin | Credenciais e configuração do gateway |
| `mp-webhook` | Mercado Pago | **assinatura HMAC** | Confirmação de pagamento |
| `bi-token` | app + Streamlit | usuário / segredo | Acesso de uso único ao relatório |

## Detalhes que não dá para adivinhar lendo o código

**`mp-webhook` é a única pública.** O Mercado Pago chama sem JWT, então ela é
publicada com `--no-verify-jwt`. Quem autentica é a assinatura HMAC do header
`x-signature`, validada contra a chave configurada em Admin → Config. de
pagamento. Sem chave configurada, a função aceita a notificação e registra um
aviso no log — para não derrubar o recebimento de pagamentos antes de você
terminar a configuração.

**`ai-chat` acumula duas responsabilidades de propósito.** Além do chat, ela
atende três ações do painel admin (`test_provider`, `list_models`,
`test_tools`), protegidas por verificação de admin e desviadas antes do fluxo
normal. Ficam aqui porque o teste de ações precisa rodar exatamente o mesmo
código que atende os usuários — e sem poder compartilhar arquivo entre funções,
juntar é o que garante isso.

**`bi-token` tem dois lados.** Autenticada, emite um código de uso único para o
usuário logado. Com o header `x-bi-secret`, troca esse código pela sessão — é o
Streamlit chamando.

**Nenhuma devolve segredo sem ser pedido.** `ai-config` e `mp-config` mascaram
chaves no GET e só entregam o valor real nas ações `reveal_key` / `reveal`, com
o acesso registrado no log.

## Secrets

Configurados com `npx supabase secrets set` (ver [guia.md](../../guia.md)):

| Secret | Usado por | Observação |
|---|---|---|
| `BI_SHARED_SECRET` | `bi-token` | Precisa ser idêntico ao dos Secrets do Streamlit |
| `MP_ACCESS_TOKEN` | funções `mp-*` | Opcional: o painel admin tem prioridade |
| `MP_WEBHOOK_SECRET` | `mp-webhook` | Opcional: o painel admin tem prioridade |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidos pela plataforma.

## Publicando

Pelo painel: abrir a função, selecionar tudo e colar o conteúdo do `index.ts`.

Pelo CLI:
```bash
npx supabase functions deploy NOME
npx supabase functions deploy mp-webhook --no-verify-jwt
```
