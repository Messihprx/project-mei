import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const MP_API = "https://api.mercadopago.com";

// Base do site que originou a chamada.
//
// Evita domínio fixo no código: publicado ou rodando local, o retorno
// do pagamento cai sempre no endereço certo.
//
// A base vem do corpo da requisição (o navegador sabe onde está), mas
// só é aceita se a origem bater com o header Origin — esse header é
// definido pelo próprio navegador e não pode ser forjado pela página.
// Assim o caminho é flexível e o domínio continua confiável.
function baseDoSite(req: Request, informada: unknown): string | null {
  const origem = req.headers.get('origin');
  if (!origem || typeof informada !== 'string' || !informada) return null;
  try {
    const url = new URL(informada);
    if (url.origin !== origem) return null;
    const base = new URL('./', url).href;
    return base.endsWith('/') ? base : base + '/';
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // O usuário vem sempre do token, nunca do body.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: 'Token inválido' }, 401);

    // Corpo lido uma vez só e reaproveitado (GET não tem corpo).
    const corpo = req.method === 'POST'
      ? await req.json().catch(() => ({} as Record<string, unknown>))
      : {} as Record<string, unknown>;

    // Config do gateway
    const { data: config } = await supabase
      .from('gateway_config')
      .select('*')
      .eq('gateway_name', 'mercado_pago')
      .eq('active', true)
      .single();

    const accessToken = config?.access_token || Deno.env.get("MP_ACCESS_TOKEN");
    if (!accessToken) {
      return json({ error: 'Gateway de pagamento não configurado.' }, 400);
    }

    const preco = Number(config?.price ?? 15.90);
    const descricao = config?.plan_description || 'Assinatura Premium FinMEI';
    // Mesma regra do checkout avulso: o que o admin configurou tem
    // prioridade; sem isso, segue o site que fez a chamada.
    const baseAssinatura = baseDoSite(req, corpo.baseUrl)
      || "https://project-finmei-ub.netlify.app/";
    const backUrl = config?.back_url_assinatura
      || config?.success_url
      || (baseAssinatura + "checkout_sucesso.html");

    const mpFetch = (caminho: string, init: RequestInit = {}) =>
      fetch(`${MP_API}${caminho}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });

    // ----------------------------------------------------------------
    // GET — status da assinatura atual (para a tela de planos)
    // ----------------------------------------------------------------
    if (req.method === 'GET') {
      const { data: assinatura } = await supabase
        .from('assinaturas')
        .select('preapproval_id, status, valor, proxima_cobranca, cancelada_em')
        .eq('user_id', user.id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: perfil } = await supabase
        .from('perfis')
        .select('plano, expira_em, assinatura_status, metodo_assinatura')
        .eq('id', user.id)
        .single();

      return json({
        assinatura: assinatura ?? null,
        perfil: perfil ?? null,
        recorrencia_disponivel: Boolean(config?.recurring_active),
        preco,
      });
    }

    if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

    const action = corpo.action;

    // ----------------------------------------------------------------
    // create — cria a assinatura recorrente (cartão de crédito)
    // ----------------------------------------------------------------
    if (action === 'create') {
      if (!config?.recurring_active) {
        return json({ error: 'A assinatura recorrente não está ativa. Use o pagamento avulso.' }, 400);
      }

      // Já tem assinatura ativa? Não cria outra.
      const { data: existente } = await supabase
        .from('assinaturas')
        .select('preapproval_id, status')
        .eq('user_id', user.id)
        .in('status', ['authorized', 'pending'])
        .maybeSingle();

      if (existente?.status === 'authorized') {
        return json({ error: 'Você já possui uma assinatura ativa.' }, 400);
      }

      const res = await mpFetch('/preapproval', {
        method: 'POST',
        body: JSON.stringify({
          reason: descricao,
          external_reference: user.id,
          payer_email: user.email,
          back_url: backUrl,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: preco,
            currency_id: 'BRL',
          },
          status: 'pending',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('Erro ao criar preapproval:', JSON.stringify(data));
        return json({ error: data.message || 'Não foi possível criar a assinatura.' }, 400);
      }

      await supabase.from('assinaturas').upsert({
        user_id: user.id,
        preapproval_id: String(data.id),
        status: data.status || 'pending',
        valor: preco,
      }, { onConflict: 'preapproval_id' });

      return json({ init_point: data.init_point, preapproval_id: data.id });
    }

    // ----------------------------------------------------------------
    // cancel — cancela a renovação
    //
    // Não mexe em plano nem em expira_em: o usuário já pagou o período
    // corrente e continua premium até ele acabar. Quem derruba o acesso
    // depois é o plano_ativo(), quando expira_em passar.
    // ----------------------------------------------------------------
    if (action === 'cancel') {
      const { data: assinatura } = await supabase
        .from('assinaturas')
        .select('preapproval_id')
        .eq('user_id', user.id)
        .in('status', ['authorized', 'pending'])
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!assinatura?.preapproval_id) {
        return json({ error: 'Nenhuma assinatura ativa encontrada.' }, 404);
      }

      const res = await mpFetch(`/preapproval/${assinatura.preapproval_id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('Erro ao cancelar preapproval:', JSON.stringify(data));
        return json({ error: data.message || 'Não foi possível cancelar a assinatura.' }, 400);
      }

      const agora = new Date().toISOString();

      await supabase.from('assinaturas')
        .update({ status: 'cancelled', cancelada_em: agora })
        .eq('preapproval_id', assinatura.preapproval_id);

      await supabase.from('perfis')
        .update({ assinatura_status: 'cancelled', assinatura_cancelada_em: agora })
        .eq('id', user.id);

      const { data: perfil } = await supabase
        .from('perfis').select('expira_em').eq('id', user.id).single();

      return json({
        ok: true,
        acesso_ate: perfil?.expira_em ?? null,
        mensagem: 'Assinatura cancelada. Seu acesso Premium continua até o fim do período já pago.',
      });
    }

    return json({ error: 'Ação inválida.' }, 400);

  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
