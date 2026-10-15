-- ============================================
-- MIGRAÇÃO: Itens de venda (múltipros produtos por venda)
--
-- Uma venda passa a ter 1..N itens. A coluna vendas.valor CONTINUA
-- sendo o TOTAL da venda (soma dos itens) — todos os KPIs, saldos,
-- limites de plano e relatórios seguem lendo vendas.valor sem mudança.
--
-- Idempotente: pode ser executada mais de vez (o backfill pula vendas
-- que já possuem itens).
--
-- Pré-requisito: sql/admin_supabase.sql (função is_admin()) já rodou.
-- Depois de rodar este script, REEXECUTE sql/dashboard_rpc.sql
-- (donut por produto passa a somar pelos itens).
-- ============================================

-- 1. Tabela de itens
CREATE TABLE IF NOT EXISTS public.venda_itens (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  venda_id UUID NOT NULL,
  produto_id UUID NULL,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(10,2) NOT NULL DEFAULT 1,
  valor_unit NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::TEXT, now()),
  CONSTRAINT venda_itens_pkey PRIMARY KEY (id),
  CONSTRAINT venda_itens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT venda_itens_venda_id_fkey FOREIGN KEY (venda_id) REFERENCES public.vendas(id) ON DELETE CASCADE,
  CONSTRAINT venda_itens_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE SET NULL,
  CONSTRAINT venda_itens_quantidade_check CHECK (quantidade > 0),
  CONSTRAINT venda_itens_valor_unit_check CHECK (valor_unit >= 0)
) TABLESPACE pg_default;

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_venda_itens_user_id ON public.venda_itens(user_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda_id ON public.venda_itens(venda_id);

-- 3. RLS (mesmo padrão de contas/vendas)
ALTER TABLE public.venda_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venda_itens_select_own" ON public.venda_itens;
CREATE POLICY "venda_itens_select_own" ON public.venda_itens FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "venda_itens_insert_own" ON public.venda_itens;
CREATE POLICY "venda_itens_insert_own" ON public.venda_itens FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "venda_itens_update_own" ON public.venda_itens;
CREATE POLICY "venda_itens_update_own" ON public.venda_itens FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "venda_itens_delete_own" ON public.venda_itens;
CREATE POLICY "venda_itens_delete_own" ON public.venda_itens FOR DELETE USING (auth.uid() = user_id);

-- 4. Leitura do painel admin (mesma style da policy de vendas)
DROP POLICY IF EXISTS "admins_select_all_venda_itens" ON public.venda_itens;
CREATE POLICY "admins_select_all_venda_itens" ON public.venda_itens
  FOR SELECT USING (public.is_admin());

-- 5. Backfill: cada venda legada vira exatamente 1 item.
--    Vendas que já têm itens são puladas (re-execução segura).
INSERT INTO public.venda_itens (user_id, venda_id, produto_id, descricao, quantidade, valor_unit)
SELECT v.user_id, v.id, v.produto_id, COALESCE(NULLIF(v.descricao, ''), 'Venda'), 1, v.valor
  FROM public.vendas v
 WHERE NOT EXISTS (
   SELECT 1 FROM public.venda_itens i WHERE i.venda_id = v.id
 );
