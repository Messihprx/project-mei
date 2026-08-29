-- ============================================================
-- Chave de assinatura do webhook do Mercado Pago
-- Execute no Supabase SQL Editor
--
-- Ela vem da mesma tela do painel do MP que o access token, então
-- fica na mesma configuração — sem precisar de `supabase secrets
-- set` e sem redeploy da função para trocar.
--
-- A tabela gateway_config já é protegida por RLS (só admin lê e
-- escreve, ver sql/gateway_config.sql), e a edge function mp-config
-- devolve o valor mascarado, nunca em claro.
-- ============================================================

ALTER TABLE public.gateway_config
  ADD COLUMN IF NOT EXISTS webhook_secret text;
