-- Execute no Supabase SQL Editor depois de criar o usuário administrador.

ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS assinatura_status text NOT NULL DEFAULT 'trial';

CREATE TABLE IF NOT EXISTS public.pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  valor numeric(10, 2) NOT NULL DEFAULT 0,
  plano text NOT NULL DEFAULT 'premium',
  status text NOT NULL,
  gateway text NOT NULL DEFAULT 'mercado_pago',
  criado_em timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  external_reference text
);

ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

-- Marque somente o usuário administrativo desejado.
UPDATE public.perfis
SET role = 'admin'
WHERE email = 'admin@finmei.com.br';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfis
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "admins_select_all_perfis" ON public.perfis;
CREATE POLICY "admins_select_all_perfis"
ON public.perfis FOR SELECT
USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "admins_select_all_vendas" ON public.vendas;
CREATE POLICY "admins_select_all_vendas"
ON public.vendas FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "admins_select_all_despesas" ON public.despesas;
CREATE POLICY "admins_select_all_despesas"
ON public.despesas FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "admins_select_all_clientes" ON public.clientes;
CREATE POLICY "admins_select_all_clientes"
ON public.clientes FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "admins_select_all_pagamentos" ON public.pagamentos;
CREATE POLICY "admins_select_all_pagamentos"
ON public.pagamentos FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "admins_update_all_perfis" ON public.perfis;
CREATE POLICY "admins_update_all_perfis"
ON public.perfis FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());