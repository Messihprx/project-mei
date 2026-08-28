-- Limite diário individual opcional. NULL mantém o limite definido pelo plano.
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS ai_daily_limit integer NULL;

ALTER TABLE public.perfis
  DROP CONSTRAINT IF EXISTS perfis_ai_daily_limit_check;

ALTER TABLE public.perfis
  ADD CONSTRAINT perfis_ai_daily_limit_check
  CHECK (ai_daily_limit IS NULL OR ai_daily_limit >= 0);