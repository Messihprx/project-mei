-- ============================================================
-- Configuração de IA e controle de uso
-- Execute no Supabase SQL Editor
-- ============================================================

-- Limite diário individual opcional. NULL usa o limite do plano.
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS ai_daily_limit integer NULL;

ALTER TABLE public.perfis
  DROP CONSTRAINT IF EXISTS perfis_ai_daily_limit_check;

ALTER TABLE public.perfis
  ADD CONSTRAINT perfis_ai_daily_limit_check
  CHECK (ai_daily_limit IS NULL OR ai_daily_limit >= 0);

-- Tabela de configuração dos provedores de IA
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'openai',
  api_key text,
  api_url text NOT NULL DEFAULT 'https://api.openai.com/v1/chat/completions',
  model text NOT NULL DEFAULT 'gpt-4o',
  max_tokens integer NOT NULL DEFAULT 2000,
  temperature numeric(3,2) NOT NULL DEFAULT 0.7,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_providers_name_key UNIQUE (provider_name)
);

-- Tabela de limites por tipo de plano
CREATE TABLE IF NOT EXISTS public.ai_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_type text NOT NULL,
  daily_messages integer NOT NULL DEFAULT 20,
  max_tokens_per_message integer NOT NULL DEFAULT 1500,
  max_history_messages integer NOT NULL DEFAULT 20,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_limits_plan_key UNIQUE (plan_type)
);

-- Tabela de uso diário por usuário
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  messages_used integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_user_date_key UNIQUE (user_id, usage_date)
);

-- Tabela de histórico de conversas
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  tokens_used integer NOT NULL DEFAULT 0,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON public.ai_usage (user_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_conversations (user_id, created_at DESC);

-- RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

-- Admin policies
DROP POLICY IF EXISTS "ai_providers_admin_all" ON public.ai_providers;
CREATE POLICY "ai_providers_admin_all" ON public.ai_providers FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "ai_limits_admin_all" ON public.ai_limits;
CREATE POLICY "ai_limits_admin_all" ON public.ai_limits FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "ai_usage_admin_all" ON public.ai_usage;
CREATE POLICY "ai_usage_admin_all" ON public.ai_usage FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- User policies
DROP POLICY IF EXISTS "ai_usage_own" ON public.ai_usage;
CREATE POLICY "ai_usage_own" ON public.ai_usage FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_conversations_own_select" ON public.ai_conversations;
CREATE POLICY "ai_conversations_own_select" ON public.ai_conversations FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_conversations_own_insert" ON public.ai_conversations;
CREATE POLICY "ai_conversations_own_insert" ON public.ai_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_limits_read_all" ON public.ai_limits;
CREATE POLICY "ai_limits_read_all" ON public.ai_limits FOR SELECT USING (true);

DROP POLICY IF EXISTS "ai_providers_no_client" ON public.ai_providers;
CREATE POLICY "ai_providers_no_client" ON public.ai_providers FOR SELECT USING (false);

-- Seed limites
INSERT INTO public.ai_limits (plan_type, daily_messages, max_tokens_per_message, max_history_messages)
VALUES
  ('gratuito', 10, 1000, 10),
  ('premium', 50, 2000, 20),
  ('admin', 999, 4000, 50)
ON CONFLICT (plan_type) DO NOTHING;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_ai_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ai_providers_updated ON public.ai_providers;
CREATE TRIGGER trg_ai_providers_updated BEFORE UPDATE ON public.ai_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_timestamp();

DROP TRIGGER IF EXISTS trg_ai_limits_updated ON public.ai_limits;
CREATE TRIGGER trg_ai_limits_updated BEFORE UPDATE ON public.ai_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_timestamp();

DROP TRIGGER IF EXISTS trg_ai_usage_updated ON public.ai_usage;
CREATE TRIGGER trg_ai_usage_updated BEFORE UPDATE ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_timestamp();
