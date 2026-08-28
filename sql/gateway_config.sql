-- ============================================================
-- Tabela de configuração de gateways de pagamento
-- Execute no Supabase SQL Editor
-- ============================================================

-- Cria a tabela se não existir
CREATE TABLE IF NOT EXISTS public.gateway_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_name text NOT NULL DEFAULT 'mercado_pago',
  access_token text,
  public_key text,
  webhook_url text,
  success_url text,
  failure_url text,
  pending_url text,
  price numeric(10, 2) NOT NULL DEFAULT 15.90,
  plan_name text NOT NULL DEFAULT 'premium',
  plan_description text NOT NULL DEFAULT 'Assinatura Premium FinMEI',
  max_installments integer NOT NULL DEFAULT 12,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gateway_config_gateway_name_key UNIQUE (gateway_name)
);

-- Índice para lookup rápido por nome do gateway
CREATE INDEX IF NOT EXISTS idx_gateway_config_name ON public.gateway_config (gateway_name);

-- RLS: só admins podem ler/escrever
ALTER TABLE public.gateway_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gateway_config_admin_all" ON public.gateway_config;
CREATE POLICY "gateway_config_admin_all"
  ON public.gateway_config FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Insere o registro padrão do Mercado Pago (se não existir)
INSERT INTO public.gateway_config (gateway_name, active)
VALUES ('mercado_pago', false)
ON CONFLICT (gateway_name) DO NOTHING;

-- Função para atualizar o updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_gateway_config_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gateway_config_updated ON public.gateway_config;
CREATE TRIGGER trg_gateway_config_updated
  BEFORE UPDATE ON public.gateway_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_gateway_config_timestamp();
