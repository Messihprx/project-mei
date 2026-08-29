import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verifica autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Verifica se é admin
    const { data: profile, error: profileError } = await supabase
      .from('perfis')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Sem permissão de administrador' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    // GET: Retorna config (sem expor o token completo)
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('gateway_config')
        .select('*')
        .eq('gateway_name', 'mercado_pago')
        .single();

      if (error) throw error;

      // Mascara o access token: mostra só os primeiros e últimos 4 chars
      const safeConfig = { ...data };
      if (safeConfig.access_token) {
        const t = safeConfig.access_token;
        safeConfig.access_token_masked = t.length > 8
          ? t.substring(0, 4) + '••••••••' + t.substring(t.length - 4)
          : '••••••••';
        delete safeConfig.access_token;
      }

      return new Response(JSON.stringify(safeConfig), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // POST/PUT: Salvar config
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await req.json();

      // Busca config atual
      const { data: existing } = await supabase
        .from('gateway_config')
        .select('id, access_token')
        .eq('gateway_name', 'mercado_pago')
        .single();

      const updateData: Record<string, unknown> = {
        gateway_name: 'mercado_pago',
        active: body.active ?? true,
        price: body.price ?? 15.90,
        plan_name: body.plan_name ?? 'premium',
        plan_description: body.plan_description ?? 'Assinatura Premium FinMEI',
        max_installments: body.max_installments ?? 12,
      };

      // Só atualiza URLs se fornecidas
      if (body.webhook_url !== undefined) updateData.webhook_url = body.webhook_url;
      if (body.success_url !== undefined) updateData.success_url = body.success_url;
      if (body.failure_url !== undefined) updateData.failure_url = body.failure_url;
      if (body.pending_url !== undefined) updateData.pending_url = body.pending_url;

      // Só atualiza access_token se fornecido (não vazio)
      if (body.access_token && body.access_token.trim()) {
        updateData.access_token = body.access_token.trim();
      }

      // Só atualiza public_key se fornecido
      if (body.public_key !== undefined) updateData.public_key = body.public_key;

      let result;
      if (existing) {
        const { data, error } = await supabase
          .from('gateway_config')
          .update(updateData)
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        updateData.gateway_name = 'mercado_pago';
        const { data, error } = await supabase
          .from('gateway_config')
          .insert(updateData)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      // Retorna sem expor token
      const safeResult = { ...result };
      if (safeResult.access_token) {
        const t = safeResult.access_token;
        safeResult.access_token_masked = t.length > 8
          ? t.substring(0, 4) + '••••••••' + t.substring(t.length - 4)
          : '••••••••';
        delete safeResult.access_token;
      }

      return new Response(JSON.stringify(safeResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
