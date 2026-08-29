import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MercadoPagoConfig, Payment } from "npm:mercadopago@2.0.9";

function normalizePaymentStatus(status: string | undefined) {
    if (status === 'approved' || status === 'authorized') return 'approved';
    if (status === 'pending' || status === 'in_process') return 'pending';
    if (status === 'cancelled' || status === 'refunded' || status === 'charged_back') return 'cancelled';
    return 'refused';
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    console.log("Webhook recebido no Supabase:", JSON.stringify(body));

    if (body.type === "payment" && body.data && body.data.id) {
        const paymentId = body.data.id;

        // Busca access token: primeiro do banco, depois fallback pra env var
        let accessToken = Deno.env.get("MP_ACCESS_TOKEN");

        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const supabaseConfig = createClient(supabaseUrl, supabaseKey);

          const { data: config } = await supabaseConfig
            .from('gateway_config')
            .select('access_token')
            .eq('gateway_name', 'mercado_pago')
            .eq('active', true)
            .single();

          if (config?.access_token) {
            accessToken = config.access_token;
          }
        } catch (e) {
          console.log("Usando MP_ACCESS_TOKEN da env var (fallback):", e.message);
        }

        if (!accessToken) {
          throw new Error("Access token do Mercado Pago não configurado");
        }

        const client = new MercadoPagoConfig({ accessToken });
        const payment = new Payment(client);

        const paymentInfo = await payment.get({ id: paymentId });

        const userId = paymentInfo.external_reference;
        const paymentStatus = normalizePaymentStatus(paymentInfo.status);
        const approved = paymentStatus === "approved";

        if (userId) {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

                const { data: existingPayment, error: existingPaymentError } = await supabaseAdmin
                    .from('pagamentos')
                    .select('payment_id, status')
                    .eq('payment_id', String(paymentId))
                    .maybeSingle();

                if (existingPaymentError) throw existingPaymentError;
                if (existingPayment?.status === 'approved' && approved) {
                    return new Response(JSON.stringify({ received: true }), {
                        headers: { "Content-Type": "application/json" },
                        status: 200
                    });
                }

                if (approved) {
                    const { data: perfilAtual } = await supabaseAdmin
                        .from('perfis')
                        .select('expira_em')
                        .eq('id', userId)
                        .single();

                    const hoje = new Date();
                    let novaExpira = new Date();

                    if (perfilAtual && perfilAtual.expira_em) {
                        const expiraAtual = new Date(perfilAtual.expira_em);
                        if (expiraAtual > hoje) {
                            novaExpira = expiraAtual;
                        }
                    }

                    novaExpira.setDate(novaExpira.getDate() + 30);

                    const { error } = await supabaseAdmin
                        .from('perfis')
                        .update({
                            plano: 'premium',
                            assinatura_status: 'active',
                            expira_em: novaExpira.toISOString()
                        })
                        .eq('id', userId);

                    if (error) throw error;
                }

                const { error: paymentError } = await supabaseAdmin
                    .from('pagamentos')
                    .upsert({
                        payment_id: String(paymentId),
                        user_id: userId,
                        valor: Number(paymentInfo.transaction_amount || 0),
                        plano: 'premium',
                        status: paymentStatus,
                        gateway: 'mercado_pago',
                        external_reference: paymentInfo.external_reference || null
                    }, { onConflict: 'payment_id' });

                if (paymentError) throw paymentError;
                console.log(`✅ Pagamento ${paymentStatus} registrado. Usuário ID: ${userId}.`);
        }
    }

    return new Response(JSON.stringify({ received: true }), { 
        headers: { "Content-Type": "application/json" },
        status: 200 
    });

  } catch (error) {
    console.error("❌ Erro ao processar Webhook:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
        headers: { "Content-Type": "application/json" },
        status: 400 
    });
  }
});
