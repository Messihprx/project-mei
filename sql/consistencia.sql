-- ============================================================
-- Correções de consistência
-- Execute no Supabase SQL Editor
--
-- 1. A data de negócio da venda passa a ser SEMPRE data_venda.
-- 2. meu_uso_plano() passa a devolver também o limite diário de IA,
--    para a tela parar de calcular por conta própria e divergir do
--    que o servidor de fato aplica.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Vendas importadas com a data no campo errado
--
-- A importação de CSV gravava a data da planilha em created_at e
-- deixava data_venda com o horário da importação. Como o dashboard
-- agrupa por data_venda, uma planilha de janeiro importada hoje
-- aparecia inteira no mês corrente.
--
-- A regra para identificar essas linhas é segura: uma venda não
-- pode ter sido CRIADA antes de ter ACONTECIDO. Quando created_at
-- é anterior a data_venda, o valor certo está em created_at.
--
-- Vendas retroativas cadastradas pela IA têm o oposto
-- (data_venda < created_at) e não são tocadas.
-- ------------------------------------------------------------
UPDATE public.vendas
   SET data_venda = created_at
 WHERE created_at < data_venda - interval '1 minute';


-- ------------------------------------------------------------
-- 2. meu_uso_plano() agora inclui o limite de IA
--
-- A tela do chat calculava o limite lendo perfis.plano direto, sem
-- considerar que admin usa o plano 'admin' e que premium vencido cai
-- para o gratuito. O contador mostrava um número e o servidor
-- aplicava outro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_uso_plano()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_plano     text;
  v_role      text;
  v_ai_manual int;
  v_lim       public.plano_limites%ROWTYPE;
  v_cli       bigint;
  v_prod      bigint;
  v_mov       bigint;
  v_chave     text;
  v_ai_limite int;
  v_ai_usado  int;
  v_ativo     boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('erro', 'nao_autenticado');
  END IF;

  SELECT plano, role, ai_daily_limit
    INTO v_plano, v_role, v_ai_manual
    FROM public.perfis WHERE id = v_uid;

  v_ativo := public.plano_ativo(v_uid);

  -- Mesma regra do servidor de IA: admin tem plano próprio, e premium
  -- vencido volta a valer como gratuito.
  v_chave := COALESCE(v_plano, 'gratuito');
  IF v_role = 'admin' THEN
    v_chave := 'admin';
  ELSIF v_plano = 'premium' AND NOT v_ativo THEN
    v_chave := 'gratuito';
  END IF;

  SELECT * INTO v_lim FROM public.plano_limites WHERE plan_type = v_chave AND active;

  SELECT count(*) INTO v_cli  FROM public.clientes WHERE user_id = v_uid AND ativo;
  SELECT count(*) INTO v_prod FROM public.produtos WHERE user_id = v_uid;
  SELECT (SELECT count(*) FROM public.vendas   WHERE user_id = v_uid)
       + (SELECT count(*) FROM public.despesas WHERE user_id = v_uid)
    INTO v_mov;

  SELECT daily_messages INTO v_ai_limite
    FROM public.ai_limits WHERE plan_type = v_chave AND active;

  -- Limite individual do perfil vence o do plano
  v_ai_limite := COALESCE(v_ai_manual, v_ai_limite, 10);

  SELECT COALESCE(messages_used, 0) INTO v_ai_usado
    FROM public.ai_usage
   WHERE user_id = v_uid AND usage_date = CURRENT_DATE;

  RETURN json_build_object(
    'plano',      v_chave,
    'ativo',      v_ativo,
    'trial_dias', COALESCE(v_lim.trial_dias, 14),
    'clientes',      json_build_object('usado', v_cli,  'max', v_lim.max_clientes),
    'produtos',      json_build_object('usado', v_prod, 'max', v_lim.max_produtos),
    'movimentacoes', json_build_object('usado', v_mov,  'max', v_lim.max_movimentacoes),
    'ia',            json_build_object('usado', COALESCE(v_ai_usado, 0), 'max', v_ai_limite)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.meu_uso_plano() FROM public;
GRANT EXECUTE ON FUNCTION public.meu_uso_plano() TO authenticated;


-- ------------------------------------------------------------
-- 3. Limites públicos do plano gratuito
--
-- A página de planos anunciava "10 clientes" e "50 movimentações"
-- em texto fixo, que parava de bater assim que o admin mudava os
-- números. Esta função entrega os valores reais para quem ainda não
-- fez login (a tela de planos é pública).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limites_publicos()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_object_agg(plan_type, json_build_object(
    'clientes',      max_clientes,
    'movimentacoes', max_movimentacoes,
    'produtos',      max_produtos,
    'trial_dias',    trial_dias
  ))
  FROM public.plano_limites
  WHERE active;
$$;

REVOKE ALL ON FUNCTION public.limites_publicos() FROM public;
GRANT EXECUTE ON FUNCTION public.limites_publicos() TO anon, authenticated;
