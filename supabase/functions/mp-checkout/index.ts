import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { MercadoPagoConfig, Preference } from "npm:mercadopago@2.0.9";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Tratamento de preflight (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { items, payerEmail, userId } = await req.json();

    // Inicia o SDK com o Access Token salvo nas Secrets do Supabase
    const client = new MercadoPagoConfig({
      accessToken: Deno.env.get("MP_ACCESS_TOKEN")!
    });

    const preference = new Preference(client);

    // Cria a preferência de pagamento (checkout)
    const result = await preference.create({
      body: {
        items: items,
        payer: {
          email: payerEmail
        },
        external_reference: userId, // VINCULA O PAGAMENTO AO ID DO USUÁRIO
        notification_url: "https://grszaitpgnyrbxktxauc.supabase.co/functions/v1/mp-webhook", // WEBHOOK AUTOMÁTICO
        payment_methods: {
          excluded_payment_methods: [],
          excluded_payment_types: [
            { id: "ticket" }
          ],
          installments: 12
        },
        back_urls: {
          success: "https://project-mei-ub.netlify.app/checkout_sucesso.html",
          failure: "https://project-mei-ub.netlify.app/checkout_erro.html",
          pending: "https://project-mei-ub.netlify.app/checkout_pendente.html",
        },
        auto_return: "approved",
      },
    });

    // Retorna o link de pagamento
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
