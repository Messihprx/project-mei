# Scripts do banco

Rode no **Supabase → SQL Editor**. Todos são idempotentes (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), então rodar de novo não quebra
nada.

## Ordem, num banco novo

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `setup_planos.sql` | Colunas de plano em `perfis` + trigger `handle_new_user` |
| 2 | `produtos.sql` | Tabela `produtos` + bucket de fotos |
| 3 | `vendas_add_produto.sql` | Liga venda a produto |
| 4 | `admin_supabase.sql` | `role`, `is_admin()` e as policies de admin |
| 5 | `gateway_config.sql` | Configuração do Mercado Pago |
| 6 | `ai_config.sql` | Provedores, limites, uso e conversas de IA |
| 7 | `ai_sessions.sql` | Sessões do chat |
| 8 | `ai_individual_limits.sql` | Limite de IA por usuário |
| 9 | `fix_perfis_nome_email.sql` | Preenche nome e e-mail nos perfis |
| 10 | `verificar_email_confirmado.sql` | Confirmação de e-mail entre dispositivos |

> `admin_supabase.sql` precisa vir antes de qualquer script que use
> `is_admin()` — que são quase todos os seguintes.

## Depois, na ordem do guia.md

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `plano_limites.sql` | **Aplica o plano no banco.** Tabela de limites + `plano_ativo()` + triggers |
| 2 | `assinaturas.sql` | Assinatura recorrente do Mercado Pago |
| 3 | `dashboard_rpc.sql` | `dashboard_resumo()` — agrega no servidor |
| 4 | `bi_handoff.sql` | Acesso de uso único ao app de BI |
| 5 | `rpc_throttle.sql` | Limite de taxa na verificação de e-mail |
| 6 | `indices.sql` | Índices das tabelas de negócio |
| 7 | `gateway_webhook_secret.sql` | Chave de assinatura do webhook |
| 8 | `ai_providers_extra.sql` | Autenticação livre nos provedores de IA |
| 9 | `ai_logs.sql` | Registro de falhas da IA |
| 10 | `consistencia.sql` | Corrige a data das vendas importadas e unifica os limites |

## O que cada um resolve, quando não é óbvio

**`plano_limites.sql`** é o mais importante. Antes dele, os limites do plano
gratuito existiam só no JavaScript do navegador — dava para contorná-los pelo
DevTools, por chamada direta à API, ou pedindo ao chat de IA para cadastrar. As
triggers `BEFORE INSERT` fecham os três caminhos de uma vez, porque a service
role ignora RLS mas não ignora trigger.

**`dashboard_rpc.sql`** existe porque o dashboard somava tudo no navegador. O
PostgREST corta em 1000 linhas sem avisar, então o Saldo Geral ficava errado em
silêncio assim que o usuário passava desse volume.

**`bi_handoff.sql`** substituiu o `?user_id=<uuid>` na URL do relatório, em que
o Streamlit confiava. Quem tivesse o UUID de alguém via o financeiro daquela
pessoa.

**`consistencia.sql`** corrige as vendas importadas por CSV, que gravavam a data
da planilha em `created_at` e deixavam `data_venda` com o horário da importação
— uma planilha de janeiro importada hoje aparecia inteira no mês corrente.

## Estrutura resultante

Ver [estrutura.sql](../estrutura.sql) na raiz — é a fotografia do banco depois
de tudo aplicado, com as colunas comentadas e o resumo do RLS.
