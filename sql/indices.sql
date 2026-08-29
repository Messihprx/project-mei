-- ============================================================
-- Índices das tabelas de negócio
-- Execute no Supabase SQL Editor
--
-- Só as tabelas ai_* tinham índice. Todas as consultas do app
-- filtram por user_id e ordenam por data, então sem estes
-- índices o Postgres faz sequential scan em tudo.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_vendas_user_data
  ON public.vendas (user_id, data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_vendas_user_created
  ON public.vendas (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendas_user_status
  ON public.vendas (user_id, status);

CREATE INDEX IF NOT EXISTS idx_vendas_cliente
  ON public.vendas (cliente_id);

CREATE INDEX IF NOT EXISTS idx_despesas_user_data
  ON public.despesas (user_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_clientes_user_ativo
  ON public.clientes (user_id, ativo);

CREATE INDEX IF NOT EXISTS idx_produtos_user
  ON public.produtos (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pagamentos_user
  ON public.pagamentos (user_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_perfis_role
  ON public.perfis (role) WHERE role = 'admin';
