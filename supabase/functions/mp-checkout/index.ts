import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { MercadoPagoConfig, Preference } from "npm:mercadopago@2.0.9";
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
    const { payerEmail, userId } = await req.json();

    // Busca config do gateway no banco de dados
    let accessToken = Deno.env.get("MP_ACCESS_TOKEN");
    let webhookUrl = "https://grszaitpgnyrbxktxauc.supabase.co/functions/v1/mp-webhook";
    let successUrl = "https://project-mei-ub.netlify.app/checkout_sucesso.html";
    let failureUrl = "https://project-mei-ub.netlify.app/checkout_erro.html";
    let pendingUrl = "https://project-mei-ub.netlify.app/checkout_pendente.html";
    let price = 15.90;
    let maxInstallments = 12;
    let planDescription = "Assinatura Premium FinMEI";

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: config } = await supabase
        .from('gateway_config')
        .select('*')
        .eq('gateway_name', 'mercado_pago')
        .eq('active', true)
        .single();

      if (config) {
        if (config.access_token) accessToken = config.access_token;
        if (config.webhook_url) webhookUrl = config.webhook_url;
        if (config.success_url) successUrl = config.success_url;
        if (config.failure_url) failureUrl = config.failure_url;
        if (config.pending_url) pendingUrl = config.pending_url;
        if (config.price) price = Number(config.price);
        if (config.max_installments) maxInstallments = Number(config.max_installments);
        if (config.plan_description) planDescription = config.plan_description;
      }
    } catch (e) {
      console.log("Usando config padrão (tabela gateway_config não encontrada ou vazia):", e.message);
    }

    if (!accessToken) {
      throw new Error("Access token do Mercado Pago não configurado. Configure-o nas Configurações de Pagamento do painel admin.");
    }

    const client = new MercadoPagoConfig({ accessToken });

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [{
          title: planDescription,
          quantity: 1,
          unit_price: price,
          currency_id: 'BRL'
        }],
        payer: {
          email: payerEmail
        },
        external_reference: userId,
        notification_url: webhookUrl,
        payment_methods: {
          excluded_payment_methods: [],
          excluded_payment_types: [
            { id: "ticket" }
          ],
          installments: maxInstallments
        },
        back_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: pendingUrl,
        },
        auto_return: "approved",
      },
    });

    return new Response(JSON.stringify({ init_point: result.init_point }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
