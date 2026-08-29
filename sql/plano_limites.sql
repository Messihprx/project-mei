-- ============================================================
-- Validação de plano NO SERVIDOR
-- Execute no Supabase SQL Editor
--
-- Até aqui os limites do plano existiam só no JavaScript do
-- navegador (protegerAcao em planos.js). Isso era contornável de
-- três formas: DevTools, chamada direta à REST API com o anon key,
-- e simplesmente pedindo ao chat de IA para cadastrar.
--
-- As triggers criadas neste arquivo fecham os três de uma vez —
-- inclusive contra a service role, que ignora RLS mas NÃO ignora
-- triggers.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela de limites (configurável pelo painel admin)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plano_limites (
  plan_type          text PRIMARY KEY,   -- 'gratuito' | 'premium' | 'admin'
  max_clientes       int,                -- NULL = ilimitado
  max_movimentacoes  int,                -- vendas + despesas somadas; NULL = ilimitado
  max_produtos       int,                -- NULL = ilimitado
  trial_dias         int  NOT NULL DEFAULT 14,
  active             boolean NOT NULL DEFAULT true,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plano_limites
  (plan_type,   max_clientes, max_movimentacoes, max_produtos, trial_dias)
VALUES
  ('gratuito',  10,           50,                20,           14),
  ('premium',   NULL,         NULL,              NULL,         0),
  ('admin',     NULL,         NULL,              NULL,         0)
ON CONFLICT (plan_type) DO NOTHING;

ALTER TABLE public.plano_limites ENABLE ROW LEVEL SECURITY;

-- Só admin escreve. Leitura liberada porque o app precisa mostrar
-- "3 de 10 clientes" — são só números, não há segredo aqui.
DROP POLICY IF EXISTS "plano_limites_admin_all" ON public.plano_limites;
CREATE POLICY "plano_limites_admin_all" ON public.plano_limites
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "plano_limites_read_all" ON public.plano_limites;
CREATE POLICY "plano_limites_read_all" ON public.plano_limites
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.update_plano_limites_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_plano_limites_updated ON public.plano_limites;
CREATE TRIGGER trg_plano_limites_updated BEFORE UPDATE ON public.plano_limites
  FOR EACH ROW EXECUTE FUNCTION public.update_plano_limites_timestamp();


-- ------------------------------------------------------------
-- 2. plano_ativo(uid) — fonte única de verdade do acesso
--    Espelha em SQL a lógica de verificarStatusPlano() do planos.js
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plano_ativo(uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano  text;
  v_role   text;
  v_expira timestamptz;
  v_criado timestamptz;
  v_trial  int;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT plano, role, expira_em, COALESCE(criado_em, data_criacao)
    INTO v_plano, v_role, v_expira, v_criado
    FROM public.perfis
   WHERE id = uid;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Admin nunca é bloqueado
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Premium: vale enquanto não expirar.
  -- expira_em NULL = assinatura legada, considera ativa.
  IF v_plano = 'premium' THEN
    RETURN v_expira IS NULL OR v_expira > now();
  END IF;

  -- Gratuito: vale durante o período de teste
  SELECT trial_dias INTO v_trial
    FROM public.plano_limites
   WHERE plan_type = COALESCE(v_plano, 'gratuito') AND active;

  v_trial := COALESCE(v_trial, 14);

  -- Perfil sem data de criação (dado legado): não bloqueia
  IF v_criado IS NULL THEN
    RETURN true;
  END IF;

  RETURN now() < v_criado + make_interval(days => v_trial);
END;
$$;


-- ------------------------------------------------------------
-- 3. limite_disponivel(uid, entidade)
--    entidade: 'cliente' | 'produto' | 'movimentacao'
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limite_disponivel(uid uuid, entidade text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_role  text;
  v_max   int;
  v_qtd   bigint;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT plano, role INTO v_plano, v_role
    FROM public.perfis WHERE id = uid;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Premium vencido cai para os limites do gratuito
  IF v_plano = 'premium' AND NOT public.plano_ativo(uid) THEN
    v_plano := 'gratuito';
  END IF;

  SELECT CASE entidade
           WHEN 'cliente'      THEN max_clientes
           WHEN 'produto'      THEN max_produtos
           WHEN 'movimentacao' THEN max_movimentacoes
         END
    INTO v_max
    FROM public.plano_limites
   WHERE plan_type = COALESCE(v_plano, 'gratuito') AND active;

  -- Sem linha de limites ou limite NULL = ilimitado
  IF NOT FOUND OR v_max IS NULL THEN
    RETURN true;
  END IF;

  IF entidade = 'cliente' THEN
    SELECT count(*) INTO v_qtd
      FROM public.clientes WHERE user_id = uid AND ativo;
  ELSIF entidade = 'produto' THEN
    SELECT count(*) INTO v_qtd
      FROM public.produtos WHERE user_id = uid;
  ELSIF entidade = 'movimentacao' THEN
    SELECT (SELECT count(*) FROM public.vendas   WHERE user_id = uid)
         + (SELECT count(*) FROM public.despesas WHERE user_id = uid)
      INTO v_qtd;
  ELSE
    RETURN true;
  END IF;

  RETURN v_qtd < v_max;
END;
$$;


-- ------------------------------------------------------------
-- 4. Trigger de escrita
--    Roda em BEFORE INSERT. A service role ignora RLS, mas não
--    ignora triggers — por isso o chat de IA também é barrado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checar_permissao_escrita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := NEW.user_id;
  v_entidade text;
  v_rotulo   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'USUARIO_INVALIDO: registro sem dono definido.';
  END IF;

  IF NOT public.plano_ativo(v_uid) THEN
    RAISE EXCEPTION 'PLANO_EXPIRADO: seu período de acesso terminou. Assine o Premium para continuar cadastrando.';
  END IF;

  IF TG_TABLE_NAME = 'clientes' THEN
    v_entidade := 'cliente';      v_rotulo := 'clientes';
  ELSIF TG_TABLE_NAME = 'produtos' THEN
    v_entidade := 'produto';      v_rotulo := 'produtos';
  ELSE
    v_entidade := 'movimentacao'; v_rotulo := 'vendas e gastos';
  END IF;

  IF NOT public.limite_disponivel(v_uid, v_entidade) THEN
    RAISE EXCEPTION 'LIMITE_ATINGIDO: você atingiu o limite de % do seu plano. Assine o Premium para cadastros ilimitados.', v_rotulo;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plano_clientes ON public.clientes;
CREATE TRIGGER trg_plano_clientes BEFORE INSERT ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.checar_permissao_escrita();

DROP TRIGGER IF EXISTS trg_plano_produtos ON public.produtos;
CREATE TRIGGER trg_plano_produtos BEFORE INSERT ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.checar_permissao_escrita();

DROP TRIGGER IF EXISTS trg_plano_vendas ON public.vendas;
CREATE TRIGGER trg_plano_vendas BEFORE INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.checar_permissao_escrita();

DROP TRIGGER IF EXISTS trg_plano_despesas ON public.despesas;
CREATE TRIGGER trg_plano_despesas BEFORE INSERT ON public.despesas
  FOR EACH ROW EXECUTE FUNCTION public.checar_permissao_escrita();


-- ------------------------------------------------------------
-- 5. meu_uso_plano() — o app lê uso + limites numa chamada só
--    (substitui os counts avulsos do protegerAcao)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_uso_plano()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_plano  text;
  v_role   text;
  v_lim    public.plano_limites%ROWTYPE;
  v_cli    bigint;
  v_prod   bigint;
  v_mov    bigint;
  v_chave  text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('erro', 'nao_autenticado');
  END IF;

  SELECT plano, role INTO v_plano, v_role FROM public.perfis WHERE id = v_uid;

  v_chave := COALESCE(v_plano, 'gratuito');
  IF v_role = 'admin' THEN
    v_chave := 'admin';
  ELSIF v_plano = 'premium' AND NOT public.plano_ativo(v_uid) THEN
    v_chave := 'gratuito';
  END IF;

  SELECT * INTO v_lim FROM public.plano_limites WHERE plan_type = v_chave AND active;

  SELECT count(*) INTO v_cli  FROM public.clientes WHERE user_id = v_uid AND ativo;
  SELECT count(*) INTO v_prod FROM public.produtos WHERE user_id = v_uid;
  SELECT (SELECT count(*) FROM public.vendas   WHERE user_id = v_uid)
       + (SELECT count(*) FROM public.despesas WHERE user_id = v_uid)
    INTO v_mov;

  RETURN json_build_object(
    'plano',      v_chave,
    'ativo',      public.plano_ativo(v_uid),
    'trial_dias', COALESCE(v_lim.trial_dias, 14),
    'clientes',      json_build_object('usado', v_cli,  'max', v_lim.max_clientes),
    'produtos',      json_build_object('usado', v_prod, 'max', v_lim.max_produtos),
    'movimentacoes', json_build_object('usado', v_mov,  'max', v_lim.max_movimentacoes)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.meu_uso_plano() FROM public;
GRANT EXECUTE ON FUNCTION public.meu_uso_plano() TO authenticated;
GRANT EXECUTE ON FUNCTION public.plano_ativo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.limite_disponivel(uuid, text) TO authenticated, service_role;
