-- ============================================================
-- Agregação do dashboard no servidor
-- Execute no Supabase SQL Editor
--
-- p_mes aceita YYYY-MM (mês), YYYY (ano) ou "all" (todo o histórico).
--
-- Motivo: o dashboard.js buscava TODO o histórico sem .limit() e
-- somava no navegador. O PostgREST corta em 1000 linhas sem
-- avisar, então o "Saldo Geral" ficava silenciosamente errado
-- assim que o usuário passava de 1000 registros.
--
-- SECURITY INVOKER de propósito: o RLS continua valendo, a função
-- só enxerga as linhas do próprio usuário.
--
-- Correção de data: o dashboard filtrava vendas por created_at,
-- mas o chat de IA grava a data informada pelo usuário em
-- data_venda ("cadastra a venda de ontem"). Uma venda retroativa
-- caía no mês errado. Aqui usamos COALESCE(data_venda, created_at),
-- que é a data de negócio correta nos dois casos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_resumo(p_mes text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_ini        date;
  v_fim        date;
  v_ini_ant    date;
  v_fim_ant    date;
  v_premium    boolean;
  v_modo       text := 'mes';
  v_granularidade text := 'month';
  v_serie_inicio date;
  v_serie_fim  date;
  v_passo      interval;
  v_periodo_unico boolean := false;
  v_ano        integer;
  v_primeira_data date;
  v_ultima_data date;

  v_entradas   numeric := 0;
  v_pendentes  numeric := 0;
  v_gastos     numeric := 0;
  v_ent_ant    numeric := 0;
  v_gas_ant    numeric := 0;
  v_saldo      numeric := 0;

  v_serie      json;
  v_movs       json;
  v_donut      json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('erro', 'nao_autenticado');
  END IF;

  IF p_mes = 'all' THEN
    v_modo := 'geral';

    SELECT MIN(ref), MAX(ref)
      INTO v_primeira_data, v_ultima_data
      FROM (
        SELECT COALESCE(data_venda, created_at)::date AS ref
          FROM public.vendas
         WHERE user_id = v_uid
        UNION ALL
        SELECT data
          FROM public.despesas
         WHERE user_id = v_uid
      ) registros;

    IF v_primeira_data IS NULL THEN
      v_ini := date_trunc('month', current_date)::date;
      v_fim := (v_ini + interval '1 month' - interval '1 day')::date;
    ELSE
      v_ini := v_primeira_data;
      v_fim := v_ultima_data;
    END IF;
    v_ini_ant := NULL;
    v_fim_ant := NULL;
  ELSIF COALESCE(p_mes, '') ~ '^[0-9]{4}$' THEN
    v_modo := 'ano';
    v_ano := substring(p_mes FROM 1 FOR 4)::integer;
    IF v_ano < 1900 OR v_ano > 2100 THEN
      v_ano := EXTRACT(YEAR FROM current_date)::integer;
    END IF;
    v_ini := make_date(v_ano, 1, 1);
    v_fim := make_date(v_ano, 12, 31);
    v_ini_ant := make_date(v_ano - 1, 1, 1);
    v_fim_ant := make_date(v_ano - 1, 12, 31);
  ELSE
    v_modo := 'mes';
    IF COALESCE(p_mes, '') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      v_ini := to_date(p_mes || '-01', 'YYYY-MM-DD');
    ELSE
      v_ini := date_trunc('month', current_date)::date;
    END IF;
    v_fim := (v_ini + interval '1 month' - interval '1 day')::date;
    v_ini_ant := (v_ini - interval '1 month')::date;
    v_fim_ant := (v_ini - interval '1 day')::date;
  END IF;

  SELECT (plano = 'premium' AND public.plano_ativo(v_uid)) OR role = 'admin'
    INTO v_premium
    FROM public.perfis WHERE id = v_uid;
  v_premium := COALESCE(v_premium, false);

  -- No plano gratuito, os gráficos mostram apenas o período agregado
  -- selecionado; o Premium mantém a evolução histórica.
  IF v_modo = 'mes' THEN
    v_granularidade := 'month';
    v_serie_inicio := CASE WHEN v_premium
                           THEN (v_ini - interval '11 months')::date
                           ELSE v_ini END;
  ELSIF v_modo = 'ano' THEN
    v_granularidade := CASE WHEN v_premium THEN 'month' ELSE 'year' END;
    v_serie_inicio := v_ini;
  ELSE
    v_granularidade := 'year';
    v_serie_inicio := date_trunc('year', v_ini)::date;
    v_periodo_unico := NOT v_premium;
  END IF;
  v_serie_fim := CASE WHEN v_periodo_unico
                      THEN v_serie_inicio
                      ELSE date_trunc(v_granularidade, v_fim::timestamp)::date
                 END;
  v_passo := CASE WHEN v_granularidade = 'month'
                  THEN interval '1 month'
                  ELSE interval '1 year' END;

  -- ---------- KPIs do período ----------
  -- Recebido = pago/recebido (mesmo critério do painel admin e do
  -- calcDeltaVenda); A Receber = só pendente. Cancelado não entra
  -- em nenhum dos dois — antes contava como "A Receber".
  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status IN ('pago', 'recebido')), 0),
    COALESCE(SUM(valor) FILTER (WHERE status = 'pendente'), 0)
  INTO v_entradas, v_pendentes
  FROM public.vendas
  WHERE user_id = v_uid
    AND COALESCE(data_venda, created_at)::date BETWEEN v_ini AND v_fim;

  SELECT COALESCE(SUM(valor), 0) INTO v_gastos
  FROM public.despesas
  WHERE user_id = v_uid AND data BETWEEN v_ini AND v_fim;

  -- ---------- Período anterior (bloco de comparação) ----------
  SELECT COALESCE(SUM(valor) FILTER (WHERE status IN ('pago', 'recebido')), 0) INTO v_ent_ant
  FROM public.vendas
  WHERE user_id = v_uid
    AND COALESCE(data_venda, created_at)::date BETWEEN v_ini_ant AND v_fim_ant;

  SELECT COALESCE(SUM(valor), 0) INTO v_gas_ant
  FROM public.despesas
  WHERE user_id = v_uid AND data BETWEEN v_ini_ant AND v_fim_ant;

  -- ---------- Saldo geral do período selecionado ----------
  SELECT
    COALESCE((SELECT SUM(valor) FROM public.vendas
               WHERE user_id = v_uid AND status IN ('pago', 'recebido')
                 AND COALESCE(data_venda, created_at)::date BETWEEN v_ini AND v_fim), 0)
  - COALESCE((SELECT SUM(valor) FROM public.despesas
               WHERE user_id = v_uid AND data BETWEEN v_ini AND v_fim), 0)
  INTO v_saldo;

  -- ---------- Série do período ----------
  WITH periodos AS (
    SELECT generate_series(v_serie_inicio, v_serie_fim, v_passo)::date AS periodo
  ),
  receitas AS (
    SELECT CASE WHEN v_periodo_unico THEN v_serie_inicio
                ELSE date_trunc(v_granularidade, COALESCE(data_venda, created_at))::date
           END AS periodo,
           SUM(valor) AS total
      FROM public.vendas
     WHERE user_id = v_uid AND status IN ('pago', 'recebido')
       AND COALESCE(data_venda, created_at)::date BETWEEN v_serie_inicio AND v_fim
     GROUP BY 1
  ),
  despesas_m AS (
    SELECT CASE WHEN v_periodo_unico THEN v_serie_inicio
                ELSE date_trunc(v_granularidade, data::timestamp)::date
           END AS periodo,
           SUM(valor) AS total
      FROM public.despesas
     WHERE user_id = v_uid AND data BETWEEN v_serie_inicio AND v_fim
     GROUP BY 1
  )
  SELECT json_agg(
           json_build_object(
             'mes',     CASE WHEN v_periodo_unico THEN 'all'
                             WHEN v_granularidade = 'year' THEN to_char(p.periodo, 'YYYY')
                             ELSE to_char(p.periodo, 'YYYY-MM') END,
             'label',   CASE WHEN v_periodo_unico THEN 'Todo período'
                             WHEN v_granularidade = 'year' THEN to_char(p.periodo, 'YYYY')
                             ELSE to_char(p.periodo, 'MM/YY') END,
             'receita', COALESCE(r.total, 0),
             'despesa', COALESCE(d.total, 0),
             'lucro',   COALESCE(r.total, 0) - COALESCE(d.total, 0)
           ) ORDER BY p.periodo
         )
    INTO v_serie
    FROM periodos p
    LEFT JOIN receitas   r ON r.periodo = p.periodo
    LEFT JOIN despesas_m d ON d.periodo = p.periodo;

  -- ---------- Últimas 5 movimentações do período ----------
  SELECT COALESCE(json_agg(
           json_build_object('titulo', t.titulo, 'valor', t.valor,
                             'data', t.quando, 'status', t.status)
           ORDER BY t.quando DESC
         ), '[]'::json)
    INTO v_movs
    FROM (
      SELECT COALESCE(v.descricao, 'Venda')      AS titulo,
             v.valor                             AS valor,
             COALESCE(v.data_venda, v.created_at) AS quando,
             v.status                            AS status
        FROM public.vendas v
       WHERE v.user_id = v_uid
         AND COALESCE(v.data_venda, v.created_at)::date BETWEEN v_ini AND v_fim
      UNION ALL
      SELECT g.descricao, g.valor, g.data::timestamptz, 'gasto'
        FROM public.despesas g
       WHERE g.user_id = v_uid AND g.data BETWEEN v_ini AND v_fim
      ORDER BY 3 DESC
      LIMIT 5
    ) t;

  -- ---------- Donut: vendas por produto ----------
  -- Soma pelos itens (venda pode ter vários produtos). Vendas legadas
  -- ainda sem linha em venda_itens caem no fallback produto_id/descricao.
  SELECT COALESCE(json_agg(
           json_build_object('label', label, 'valor', total)
           ORDER BY total DESC
         ), '[]'::json)
    INTO v_donut
    FROM (
      SELECT label, SUM(total) AS total
      FROM (
        SELECT COALESCE(p.nome, i.descricao, v.descricao, 'Sem descrição') AS label,
               (i.quantidade * i.valor_unit) AS total
          FROM public.venda_itens i
          JOIN public.vendas v ON v.id = i.venda_id
          LEFT JOIN public.produtos p ON p.id = i.produto_id
         WHERE v.user_id = v_uid
           AND COALESCE(v.data_venda, v.created_at)::date BETWEEN v_ini AND v_fim
        UNION ALL
        SELECT COALESCE(p.nome, v.descricao, 'Sem descrição') AS label,
               v.valor AS total
          FROM public.vendas v
          LEFT JOIN public.produtos p ON p.id = v.produto_id
         WHERE v.user_id = v_uid
           AND COALESCE(v.data_venda, v.created_at)::date BETWEEN v_ini AND v_fim
           AND NOT EXISTS (
             SELECT 1 FROM public.venda_itens i2 WHERE i2.venda_id = v.id
           )
      ) t
      GROUP BY label
      ORDER BY 2 DESC
      LIMIT 8
    ) d;

  RETURN json_build_object(
    'mes', json_build_object(
      'referencia', CASE WHEN v_modo = 'geral' THEN 'all'
                         WHEN v_modo = 'ano' THEN to_char(v_ini, 'YYYY')
                         ELSE to_char(v_ini, 'YYYY-MM') END,
      'entradas',   v_entradas,
      'pendentes',  v_pendentes,
      'gastos',     v_gastos,
      'lucro',      v_entradas - v_gastos
    ),
    'mes_anterior', json_build_object(
      'referencia', CASE WHEN v_modo = 'ano' THEN to_char(v_ini_ant, 'YYYY')
                         WHEN v_modo = 'mes' THEN to_char(v_ini_ant, 'YYYY-MM')
                         ELSE NULL END,
      'entradas',   v_ent_ant,
      'gastos',     v_gas_ant,
      'lucro',      v_ent_ant - v_gas_ant
    ),
    'saldo_geral',           v_saldo,
    'premium',               v_premium,
    'modo',                  v_modo,
    'serie_mensal',          COALESCE(v_serie, '[]'::json),
    'ultimas_movimentacoes', v_movs,
    'donut',                 v_donut
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_resumo(text) FROM public;
GRANT EXECUTE ON FUNCTION public.dashboard_resumo(text) TO authenticated;
