-- ============================================
-- MIGRAÇÃO: Tabela de Contas Financeiras
-- Requisitos: RF100 a RF117
-- ============================================

-- 1. Criar tabela de contas
CREATE TABLE IF NOT EXISTS public.contas (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  instituicao TEXT NULL,
  tipo TEXT NOT NULL DEFAULT 'banco_pj'::TEXT,
  finalidade TEXT NOT NULL DEFAULT 'negocio'::TEXT,
  saldo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_atual NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::TEXT, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::TEXT, now()),
  CONSTRAINT contas_pkey PRIMARY KEY (id),
  CONSTRAINT contas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT contas_tipo_check CHECK (tipo IN ('banco_pj', 'banco_pf', 'poupanca', 'caixa', 'carteira_digital', 'outro')),
  CONSTRAINT contas_finalidade_check CHECK (finalidade IN ('negocio', 'pessoal', 'misto'))
) TABLESPACE pg_default;

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_contas_user_id ON public.contas(user_id);
CREATE INDEX IF NOT EXISTS idx_contas_ativo ON public.contas(user_id, ativo);

-- 3. RLS (Row Level Security)
ALTER TABLE public.contas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contas_select_own" ON public.contas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contas_insert_own" ON public.contas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contas_update_own" ON public.contas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "contas_delete_own" ON public.contas FOR DELETE USING (auth.uid() = user_id);

-- 4. Adicionar coluna conta_id nas tabelas existentes
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS conta_id UUID NULL;
ALTER TABLE public.despesas ADD COLUMN IF NOT EXISTS conta_id UUID NULL;

-- 5. Foreign keys para conta_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendas_conta_id_fkey'
  ) THEN
    ALTER TABLE public.vendas
      ADD CONSTRAINT vendas_conta_id_fkey
      FOREIGN KEY (conta_id) REFERENCES public.contas(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'despesas_conta_id_fkey'
  ) THEN
    ALTER TABLE public.despesas
      ADD CONSTRAINT despesas_conta_id_fkey
      FOREIGN KEY (conta_id) REFERENCES public.contas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Índices para as novas colunas
CREATE INDEX IF NOT EXISTS idx_vendas_conta_id ON public.vendas(conta_id) WHERE conta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_despesas_conta_id ON public.despesas(conta_id) WHERE conta_id IS NOT NULL;
