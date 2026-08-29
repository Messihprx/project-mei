-- ============================================================
-- Handoff seguro para o app de BI (Streamlit)
-- Execute no Supabase SQL Editor
--
-- Antes, o Streamlit era aberto com ?user_id=<uuid> e confiava
-- nisso, usando service role para ler a base inteira. Qualquer
-- UUID vazado (histórico, referrer, log) dava acesso ao
-- financeiro daquele usuário.
--
-- Agora o site pede um código aleatório de uso único, válido por
-- 5 minutos. O Streamlit troca esse código pela sessão do
-- usuário e passa a consultar com a chave anon + JWT — quem
-- filtra os dados é o RLS do Postgres, não o código Python.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bi_handoff (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  expira_em    timestamptz NOT NULL,
  usado_em     timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_handoff_expira ON public.bi_handoff (expira_em);

ALTER TABLE public.bi_handoff ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma de propósito: nem o dono lê esta tabela.
-- Só as edge functions (service role) tocam nela.

-- Faxina dos tokens vencidos
CREATE OR REPLACE FUNCTION public.limpar_bi_handoff()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.bi_handoff
   WHERE expira_em < now() - interval '1 hour';
$$;

REVOKE ALL ON FUNCTION public.limpar_bi_handoff() FROM public;
