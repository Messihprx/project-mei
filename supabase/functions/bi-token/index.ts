import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ------------------------------------------------------------------
// Handoff entre o site e o app de BI (Streamlit)
//
// Antes o Streamlit era aberto com ?user_id=<uuid> e confiava nisso.
// Agora:
//   1. O site (autenticado) pede um código aleatório de uso único.
//   2. O Streamlit troca esse código pela sessão do usuário,
//      apresentando o segredo compartilhado BI_SHARED_SECRET.
//   3. O Streamlit consulta com a chave anon + JWT do usuário, e
//      quem filtra os dados é o RLS do Postgres.
//
// O código vale 5 minutos e só pode ser trocado uma vez.
// ------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bi-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const TTL_SEGUNDOS = 300;

function gerarToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));

    // --------------------------------------------------------------
    // Resgate: chamada vinda do Streamlit, com o segredo compartilhado
    // --------------------------------------------------------------
    if (body.token) {
      const segredo = req.headers.get('x-bi-secret');
      const esperado = Deno.env.get("BI_SHARED_SECRET");

      if (!esperado) {
        console.error("BI_SHARED_SECRET não configurado.");
        return json({ error: 'Serviço indisponível.' }, 503);
      }
      if (segredo !== esperado) {
        return json({ error: 'Não autorizado.' }, 401);
      }

      const { data: registro } = await supabase
        .from('bi_handoff')
        .select('token, user_id, access_token, expira_em, usado_em')
        .eq('token', String(body.token))
        .maybeSingle();

      if (!registro) return json({ error: 'Código inválido.' }, 404);
      if (registro.usado_em) return json({ error: 'Código já utilizado.' }, 410);
      if (new Date(registro.expira_em) < new Date()) {
        return json({ error: 'Código expirado.' }, 410);
      }

      // Marca como usado ANTES de devolver, e só devolve se a marcação
      // pegou — assim duas trocas simultâneas não passam as duas.
      const { data: marcado } = await supabase
        .from('bi_handoff')
        .update({ usado_em: new Date().toISOString() })
        .eq('token', registro.token)
        .is('usado_em', null)
        .select('token')
        .maybeSingle();

      if (!marcado) return json({ error: 'Código já utilizado.' }, 410);

      return json({
        user_id: registro.user_id,
        access_token: registro.access_token,
      });
    }

    // --------------------------------------------------------------
    // Emissão: chamada vinda do site, com o usuário autenticado
    // --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);

    const accessToken = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return json({ error: 'Token inválido' }, 401);

    // Só quem tem acesso válido gera relatório
    const { data: ativo } = await supabase.rpc('plano_ativo', { uid: user.id });
    if (ativo === false) {
      return json({ error: 'Seu período de acesso terminou.' }, 403);
    }

    const token = gerarToken();
    const expira = new Date(Date.now() + TTL_SEGUNDOS * 1000).toISOString();

    const { error } = await supabase.from('bi_handoff').insert({
      token,
      user_id: user.id,
      access_token: accessToken,
      expira_em: expira,
    });
    if (error) throw error;

    // Faxina oportunista
    await supabase.rpc('limpar_bi_handoff').catch(() => {});

    return json({ token, expira_em: expira });

  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
