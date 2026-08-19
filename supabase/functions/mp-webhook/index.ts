import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MercadoPagoConfig, Payment } from "npm:mercadopago@2.0.9";

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    console.log("Webhook recebido no Supabase:", JSON.stringify(body));

    // O Mercado Pago envia o ID do pagamento no campo data.id
    if (body.type === "payment" && body.data && body.data.id) {
        const paymentId = body.data.id;
        
        // 1. Configura o Mercado Pago para buscar os detalhes reais do pagamento
        const client = new MercadoPagoConfig({ 
            accessToken: Deno.env.get("MP_ACCESS_TOKEN")! 
        });
        const payment = new Payment(client);
        
        // Busca os detalhes reais no servidor do MP
        const paymentInfo = await payment.get({ id: paymentId });
        
        // 2. Só atualiza o banco se o pagamento foi REALMENTE aprovado
        if (paymentInfo.status === "approved" || paymentInfo.status === "authorized") {
            const userId = paymentInfo.external_reference; // O ID do usuário que enviamos no checkout!

            if (userId) {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                
                // Cria um cliente com permissão de Admin (Service Role)
                const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

                // 3. Busca a expiração atual do usuário para decidir se soma ou inicia do zero
                const { data: perfilAtual } = await supabaseAdmin
                    .from('perfis')
                    .select('expira_em')
                    .eq('id', userId)
                    .single();

                const hoje = new Date();
                let novaExpira = new Date();

                // Se o usuário já for premium e a data de expiração for no FUTURO, somamos à ela
                if (perfilAtual && perfilAtual.expira_em) {
                    const expiraAtual = new Date(perfilAtual.expira_em);
                    if (expiraAtual > hoje) {
                        // O usuário está renovando antecipado! Somamos 30 dias à data que ele já tem.
                        novaExpira = expiraAtual;
                    }
                }

                novaExpira.setDate(novaExpira.getDate() + 30); // Adiciona os 30 dias contratados

                // 4. Atualiza o banco de dados
                const { error } = await supabaseAdmin
                    .from('perfis')
                    .update({ 
                        plano: 'premium', 
                        expira_em: novaExpira.toISOString() 
                    })
                    .eq('id', userId);

                if (error) throw error;
                console.log(`✅ Pagamento Aprovado! Usuário ID: ${userId} agora é PREMIUM.`);
            }
        }
    }

    // Sempre retorne 200 pro Mercado Pago para ele parar de enviar a mesma notificação
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
