-- ============================================================
-- Agregação do dashboard no servidor
-- Execute no Supabase SQL Editor
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
  v_ini_serie  date;

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

  BEGIN
    v_ini := to_date(p_mes || '-01', 'YYYY-MM-DD');
  EXCEPTION WHEN OTHERS THEN
    v_ini := date_trunc('month', current_date)::date;
  END;

  v_fim     := (v_ini + interval '1 month' - interval '1 day')::date;
  v_ini_ant := (v_ini - interval '1 month')::date;
  v_fim_ant := (v_ini - interval '1 day')::date;

  SELECT (plano = 'premium' AND public.plano_ativo(v_uid)) OR role = 'admin'
    INTO v_premium
    FROM public.perfis WHERE id = v_uid;
  v_premium := COALESCE(v_premium, false);

  -- Histórico de 12 meses é recurso premium; no gratuito a série
  -- fica restrita ao mês selecionado.
  v_ini_serie := CASE WHEN v_premium
                      THEN (v_ini - interval '11 months')::date
                      ELSE v_ini END;

  -- ---------- KPIs do mês ----------
  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status = 'pago'), 0),
    COALESCE(SUM(valor) FILTER (WHERE status <> 'pago'), 0)
  INTO v_entradas, v_pendentes
  FROM public.vendas
  WHERE user_id = v_uid
    AND COALESCE(data_venda, created_at)::date BETWEEN v_ini AND v_fim;

  SELECT COALESCE(SUM(valor), 0) INTO v_gastos
  FROM public.despesas
  WHERE user_id = v_uid AND data BETWEEN v_ini AND v_fim;

  -- ---------- Mês anterior (bloco de comparação) ----------
  SELECT COALESCE(SUM(valor) FILTER (WHERE status = 'pago'), 0) INTO v_ent_ant
  FROM public.vendas
  WHERE user_id = v_uid
    AND COALESCE(data_venda, created_at)::date BETWEEN v_ini_ant AND v_fim_ant;

  SELECT COALESCE(SUM(valor), 0) INTO v_gas_ant
  FROM public.despesas
  WHERE user_id = v_uid AND data BETWEEN v_ini_ant AND v_fim_ant;

  -- ---------- Saldo geral (histórico completo, no banco) ----------
  SELECT
    COALESCE((SELECT SUM(valor) FROM public.vendas
               WHERE user_id = v_uid AND status = 'pago'), 0)
  - COALESCE((SELECT SUM(valor) FROM public.despesas
               WHERE user_id = v_uid), 0)
  INTO v_saldo;

  -- ---------- Série mensal ----------
  WITH meses AS (
    SELECT generate_series(v_ini_serie, v_ini, interval '1 month')::date AS mes
  ),
  receitas AS (
    SELECT date_trunc('month', COALESCE(data_venda, created_at))::date AS mes,
           SUM(valor) AS total
      FROM public.vendas
     WHERE user_id = v_uid AND status = 'pago'
       AND COALESCE(data_venda, created_at)::date BETWEEN v_ini_serie AND v_fim
     GROUP BY 1
  ),
  despesas_m AS (
    SELECT date_trunc('month', data)::date AS mes, SUM(valor) AS total
      FROM public.despesas
     WHERE user_id = v_uid AND data BETWEEN v_ini_serie AND v_fim
     GROUP BY 1
  )
  SELECT json_agg(
           json_build_object(
             'mes',     to_char(m.mes, 'YYYY-MM'),
             'label',   to_char(m.mes, 'MM/YY'),
             'receita', COALESCE(r.total, 0),
             'despesa', COALESCE(d.total, 0),
             'lucro',   COALESCE(r.total, 0) - COALESCE(d.total, 0)
           ) ORDER BY m.mes
         )
    INTO v_serie
    FROM meses m
    LEFT JOIN receitas   r ON r.mes = m.mes
    LEFT JOIN despesas_m d ON d.mes = m.mes;

  -- ---------- Últimas 5 movimentações do mês ----------
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

  -- ---------- Donut: vendas por produto (cai na descrição) ----------
  SELECT COALESCE(json_agg(
           json_build_object('label', label, 'valor', total)
           ORDER BY total DESC
         ), '[]'::json)
    INTO v_donut
    FROM (
      SELECT COALESCE(p.nome, v.descricao, 'Sem descrição') AS label,
             SUM(v.valor) AS total
        FROM public.vendas v
        LEFT JOIN public.produtos p ON p.id = v.produto_id
       WHERE v.user_id = v_uid
         AND COALESCE(v.data_venda, v.created_at)::date BETWEEN v_ini AND v_fim
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 8
    ) d;

  RETURN json_build_object(
    'mes', json_build_object(
      'referencia', to_char(v_ini, 'YYYY-MM'),
      'entradas',   v_entradas,
      'pendentes',  v_pendentes,
      'gastos',     v_gastos,
      'lucro',      v_entradas - v_gastos
    ),
    'mes_anterior', json_build_object(
      'referencia', to_char(v_ini_ant, 'YYYY-MM'),
      'entradas',   v_ent_ant,
      'gastos',     v_gas_ant,
      'lucro',      v_ent_ant - v_gas_ant
    ),
    'saldo_geral',           v_saldo,
    'premium',               v_premium,
    'serie_mensal',          COALESCE(v_serie, '[]'::json),
    'ultimas_movimentacoes', v_movs,
    'donut',                 v_donut
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_resumo(text) FROM public;
GRANT EXECUTE ON FUNCTION public.dashboard_resumo(text) TO authenticated;
