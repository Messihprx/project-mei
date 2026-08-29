import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Nunca devolvemos um segredo em claro: só o suficiente para o admin
// reconhecer qual chave está salva. Campo vazio no formulário significa
// "manter a atual", por isso o valor mascarado precisa ser identificável.
function mascarar<T extends Record<string, any>>(obj: T, campo: string) {
  const copia: Record<string, any> = { ...obj };
  const valor = copia[campo];
  if (valor) {
    copia[campo + "_masked"] = valor.length > 8
      ? valor.substring(0, 4) + "••••••••" + valor.substring(valor.length - 4)
      : "••••••••";
    delete copia[campo];
  }
  return copia;
}

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

      // Mascara os dois segredos antes de devolver
      const safeConfig = mascarar(mascarar(data, "access_token"), "webhook_secret");

      return new Response(JSON.stringify(safeConfig), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // POST/PUT: Salvar config
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await req.json();

      // Revelar um segredo do gateway (mesma regra do ai-config: só sai
      // daqui quando o admin pede explicitamente, clicando no olho).
      if (body.action === 'reveal') {
        const permitidos = ['access_token', 'webhook_secret', 'public_key'];
        const campo = String(body.campo || "");

        if (!permitidos.includes(campo)) {
          return new Response(JSON.stringify({ error: 'Campo inválido.' }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }

        const { data } = await supabase
          .from('gateway_config')
          .select(campo)
          .eq('gateway_name', 'mercado_pago')
          .maybeSingle();

        console.log(`[reveal] admin ${user.email} revelou ${campo} do gateway`);

        return new Response(JSON.stringify({ valor: (data as any)?.[campo] || "" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

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
        recurring_active: body.recurring_active ?? false,
      };

      // Só atualiza URLs se fornecidas
      if (body.webhook_url !== undefined) updateData.webhook_url = body.webhook_url;
      if (body.success_url !== undefined) updateData.success_url = body.success_url;
      if (body.failure_url !== undefined) updateData.failure_url = body.failure_url;
      if (body.pending_url !== undefined) updateData.pending_url = body.pending_url;
      if (body.back_url_assinatura !== undefined) updateData.back_url_assinatura = body.back_url_assinatura;

      // Campo em branco = manter o que já está salvo. O valor mascarado
      // nunca é gravado de volta (senão a chave viraria "abcd••••wxyz").
      const naoEhMascara = (v: unknown) => typeof v === "string" && v.trim() && !v.includes("••••");

      if (naoEhMascara(body.access_token)) {
        updateData.access_token = body.access_token.trim();
      }

      if (naoEhMascara(body.webhook_secret)) {
        updateData.webhook_secret = body.webhook_secret.trim();
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

      // Retorna sem expor nenhum segredo
      const safeResult = mascarar(mascarar(result, "access_token"), "webhook_secret");

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
