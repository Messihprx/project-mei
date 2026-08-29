-- ============================================================
-- Registro de falhas da IA
-- Execute no Supabase SQL Editor
--
-- Até aqui, quando o provedor recusava a chave ou uma tool falhava,
-- o erro morria num console.error dentro da Edge Function. O admin
-- via só "não consegui responder agora" e não tinha como descobrir
-- o porquê.
--
-- Guarda só FALHAS. Conversa que deu certo não entra aqui — para
-- isso já existem ai_conversations e ai_usage.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_error_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id  uuid,

  -- provider  = o provedor recusou (HTTP, rede, timeout)
  -- tool      = a tool rodou e devolveu erro
  -- args      = o modelo mandou argumentos que não são JSON válido
  -- fallback  = um provedor falhou e o sistema tentou o próximo
  -- config    = problema de configuração (nenhum provedor ativo, etc.)
  tipo        text NOT NULL,

  provider    text,
  model       text,
  tool_name   text,
  http_status int,
  mensagem    text NOT NULL,
  detalhe     jsonb,
  criado_em   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_error_logs_tipo_check
    CHECK (tipo IN ('provider', 'tool', 'args', 'fallback', 'config'))
);

CREATE INDEX IF NOT EXISTS idx_ai_error_logs_data
  ON public.ai_error_logs (criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_ai_error_logs_tipo
  ON public.ai_error_logs (tipo, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_ai_error_logs_provider
  ON public.ai_error_logs (provider, criado_em DESC);

ALTER TABLE public.ai_error_logs ENABLE ROW LEVEL SECURITY;

-- Leitura só para admin. Escrita não tem policy de propósito: quem
-- grava é a Edge Function com service role, que ignora RLS.
DROP POLICY IF EXISTS "ai_error_logs_admin_select" ON public.ai_error_logs;
CREATE POLICY "ai_error_logs_admin_select" ON public.ai_error_logs
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "ai_error_logs_admin_delete" ON public.ai_error_logs;
CREATE POLICY "ai_error_logs_admin_delete" ON public.ai_error_logs
  FOR DELETE USING (public.is_admin());

-- Faxina: o log é diagnóstico, não histórico permanente.
CREATE OR REPLACE FUNCTION public.limpar_ai_logs(p_dias int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apagados bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem limpar os logs.';
  END IF;

  DELETE FROM public.ai_error_logs
   WHERE criado_em < now() - make_interval(days => GREATEST(p_dias, 1));

  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RETURN v_apagados;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_ai_logs(int) FROM public;
GRANT EXECUTE ON FUNCTION public.limpar_ai_logs(int) TO authenticated;

-- Resumo para os cards da tela de erros (últimas 24h)
CREATE OR REPLACE FUNCTION public.resumo_ai_erros()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_24h        bigint;
  v_7d         bigint;
  v_provedor   text;
  v_tool       text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('erro', 'sem_permissao');
  END IF;

  SELECT count(*) INTO v_24h FROM public.ai_error_logs
   WHERE criado_em > now() - interval '24 hours';

  SELECT count(*) INTO v_7d FROM public.ai_error_logs
   WHERE criado_em > now() - interval '7 days';

  SELECT provider INTO v_provedor FROM public.ai_error_logs
   WHERE criado_em > now() - interval '7 days' AND provider IS NOT NULL
   GROUP BY provider ORDER BY count(*) DESC LIMIT 1;

  SELECT tool_name INTO v_tool FROM public.ai_error_logs
   WHERE criado_em > now() - interval '7 days' AND tool_name IS NOT NULL
   GROUP BY tool_name ORDER BY count(*) DESC LIMIT 1;

  RETURN json_build_object(
    'ultimas_24h',      v_24h,
    'ultimos_7d',       v_7d,
    'provedor_pior',    v_provedor,
    'tool_pior',        v_tool
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resumo_ai_erros() FROM public;
GRANT EXECUTE ON FUNCTION public.resumo_ai_erros() TO authenticated;
