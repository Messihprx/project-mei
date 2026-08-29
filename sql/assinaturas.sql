-- ============================================================
-- Assinatura recorrente (Mercado Pago PreApproval)
-- Execute no Supabase SQL Editor
--
-- Regra central do cancelamento: cancelar NÃO tira o acesso na
-- hora. O usuário pagou pelo período corrente, então guardamos
-- assinatura_status = 'cancelled' e deixamos plano/expira_em
-- intactos. O acesso cai sozinho quando expira_em passa, via
-- plano_ativo() (ver plano_limites.sql).
-- ============================================================

ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS mp_preapproval_id       text,
  ADD COLUMN IF NOT EXISTS assinatura_cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS metodo_assinatura       text;  -- 'recorrente' | 'avulso'

CREATE TABLE IF NOT EXISTS public.assinaturas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preapproval_id   text NOT NULL UNIQUE,
  status           text NOT NULL,          -- pending | authorized | paused | cancelled
  valor            numeric(10,2),
  proxima_cobranca timestamptz,
  cancelada_em     timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_user ON public.assinaturas (user_id, criado_em DESC);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

-- Leitura: dono ou admin. Escrita: só service role (edge functions).
DROP POLICY IF EXISTS "assinaturas_select_own" ON public.assinaturas;
CREATE POLICY "assinaturas_select_own" ON public.assinaturas
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE OR REPLACE FUNCTION public.update_assinaturas_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_assinaturas_updated ON public.assinaturas;
CREATE TRIGGER trg_assinaturas_updated BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.update_assinaturas_timestamp();

-- Campos novos na config do gateway
ALTER TABLE public.gateway_config
  ADD COLUMN IF NOT EXISTS recurring_active      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS back_url_assinatura   text;
