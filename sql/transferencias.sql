-- ============================================
-- MIGRAÇÃO: Histórico de transferências entre contas
-- Requisitos: RF111 (movimentações da conta), RF115 (filtrar por conta)
--
-- Antes disso, a transferência só ajustava os saldos das duas contas —
-- nenhum registro era gravado, então não havia histórico para consultar.
--
-- Idempotente: pode ser executada mais de vez.
-- ============================================

-- 1. Tabela de transferências
CREATE TABLE IF NOT EXISTS public.transferencias (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conta_origem_id UUID NULL,
  conta_destino_id UUID NULL,
  valor NUMERIC(12,2) NOT NULL,
  descricao TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::TEXT, now()),
  CONSTRAINT transferencias_pkey PRIMARY KEY (id),
  CONSTRAINT transferencias_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT transferencias_valor_check CHECK (valor > 0)
) TABLESPACE pg_default;

-- 2. FKs para as contas. ON DELETE SET NULL (mesmo padrão de vendas e
--    despesas): excluir a conta permanente desfaz o vínculo sem apagar
--    o histórico da transferência. O caminho normal é INATIVAR, que
--    preserva tudo (RF113).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transferencias_conta_origem_id_fkey'
  ) THEN
    ALTER TABLE public.transferencias
      ADD CONSTRAINT transferencias_conta_origem_id_fkey
      FOREIGN KEY (conta_origem_id) REFERENCES public.contas(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transferencias_conta_destino_id_fkey'
  ) THEN
    ALTER TABLE public.transferencias
      ADD CONSTRAINT transferencias_conta_destino_id_fkey
      FOREIGN KEY (conta_destino_id) REFERENCES public.contas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Índices: histórico por usuário e buscas por conta (origem ou destino)
CREATE INDEX IF NOT EXISTS idx_transferencias_user_id ON public.transferencias(user_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_origem ON public.transferencias(conta_origem_id) WHERE conta_origem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transferencias_destino ON public.transferencias(conta_destino_id) WHERE conta_destino_id IS NOT NULL;

-- 4. RLS: o usuário lê e cria as próprias transferências.
--    Sem policy de UPDATE/DELETE: o histórico não é editável.
ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transferencias_select_own" ON public.transferencias;
CREATE POLICY "transferencias_select_own" ON public.transferencias FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "transferencias_insert_own" ON public.transferencias;
CREATE POLICY "transferencias_insert_own" ON public.transferencias FOR INSERT WITH CHECK (auth.uid() = user_id);
