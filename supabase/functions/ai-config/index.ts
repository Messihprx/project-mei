import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function verifyAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: 'Não autenticado', status: 401 };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: 'Token inválido', status: 401 };

  const { data: profile, error: profileError } = await supabase
    .from('perfis').select('role').eq('id', user.id).single();
  if (profileError || profile?.role !== 'admin') return { error: 'Sem permissão', status: 403 };

  return { supabase, user };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const admin = await verifyAdmin(req);
    if (admin.error) {
      return new Response(JSON.stringify({ error: admin.error }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: admin.status,
      });
    }
    const supabase = admin.supabase;

    // GET: Retorna toda a config
    if (req.method === 'GET') {
      const [providersResult, limitsResult, usageResult] = await Promise.all([
        supabase.from('ai_providers').select('*').order('priority', { ascending: true }),
        supabase.from('ai_limits').select('*').order('plan_type'),
        supabase.from('ai_usage').select('user_id, usage_date, messages_used, tokens_used, perfis:user_id(nome_completo, email)')
          .gte('usage_date', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
          .order('usage_date', { ascending: false })
      ]);

      const providers = providersResult.data || [];

      return new Response(JSON.stringify({
        providers,
        limits: limitsResult.data || [],
        usage: usageResult.data || []
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // POST: Salvar config
    if (req.method === 'POST') {
      const body = await req.json();

      if (body.providers) {
        for (const p of body.providers) {
          const updateData: Record<string, unknown> = {
            provider_name: p.provider_name,
            provider_type: p.provider_type || 'openai',
            model: p.model,
            api_url: p.api_url,
            max_tokens: p.max_tokens ?? 2000,
            temperature: p.temperature ?? 0.7,
            priority: p.priority ?? 0,
            active: p.active ?? true,
          };
          if (p.api_key && !p.api_key.includes('••••')) {
            updateData.api_key = p.api_key;
          }

          const { data: existing } = await supabase
            .from('ai_providers').select('id').eq('provider_name', p.provider_name).single();

          if (existing) {
            await supabase.from('ai_providers').update(updateData).eq('id', existing.id);
          } else {
            await supabase.from('ai_providers').insert(updateData);
          }
        }
      }

      if (body.delete_provider) {
        await supabase.from('ai_providers').delete().eq('provider_name', body.delete_provider);
      }

      if (body.delete_providers && body.delete_providers.length) {
        await supabase.from('ai_providers').delete().in('provider_name', body.delete_providers);
      }

      if (body.limits) {
        for (const l of body.limits) {
          await supabase.from('ai_limits').upsert({
            plan_type: l.plan_type,
            daily_messages: l.daily_messages ?? 20,
            max_tokens_per_message: l.max_tokens_per_message ?? 1500,
            max_history_messages: l.max_history_messages ?? 20,
            active: l.active ?? true,
          }, { onConflict: 'plan_type' });
        }
      }

      return new Response(JSON.stringify({ success: true }), {
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
