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
| 5 | `contas_financeiras.sql` | Tabela `contas`, `conta_id` em vendas/despesas e a RPC `incrementar_saldo` |
| 6 | `gateway_config.sql` | Configuração do Mercado Pago |
| 7 | `ai_config.sql` | Provedores, limites, uso e conversas de IA |
| 8 | `ai_sessions.sql` | Sessões do chat |
| 9 | `ai_individual_limits.sql` | Limite de IA por usuário |
| 10 | `fix_perfis_nome_email.sql` | Preenche nome e e-mail nos perfis |
| 11 | `verificar_email_confirmado.sql` | Confirmação de e-mail entre dispositivos |
| 12 | `transferencias.sql` | Histórico de transferências entre contas |

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
| 11 | `contas_financeiras.sql` | Tabela `contas`, `conta_id` em vendas/despesas e a RPC `incrementar_saldo` |
| 12 | `transferencias.sql` | Tabela `transferencias` — histórico de transferências entre contas |
| 13 | `venda_itens.sql` | Tabela `venda_itens` — venda com vários produtos (item com qtd e preço unit); backfill das vendas antigas |
| 14 | `dashboard_rpc.sql` | **Reexecute após o item 13** — o donut por produto passa a somar pelos itens |

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

**`contas_financeiras.sql`** cria a tabela `contas` (Carteira, Banco, Poupança
etc.), liga `conta_id` a vendas e despesas e cria a RPC `incrementar_saldo`
usada pela tool `transferir_entre_contas` da IA. As páginas de Contas do site e
as 6 tools de contas do chat dependem dele. Idempotente: se a tabela já existe,
só falta a RPC.

**`transferencias.sql`** cria a tabela `transferencias` — antes, a transferência
só ajustava os saldos e nenhum registro era gravado, então não havia histórico
para consultar (RF111) nem por qual conta filtrar (RF115). A página de Contas e
a tool `transferir_entre_contas` da IA passam a gravar cada transferência aqui.
As FKs usam `ON DELETE SET NULL` (mesmo padrão de vendas e despesas): o caminho
normal é **inativar** a conta, que preserva tudo (RF113).

## Estrutura resultante

Ver [estrutura.sql](../estrutura.sql) na raiz — é a fotografia do banco depois
de tudo aplicado, com as colunas comentadas e o resumo do RLS.
