import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MercadoPagoConfig, Payment } from "npm:mercadopago@2.0.9";

function normalizePaymentStatus(status: string | undefined) {
    if (status === 'approved' || status === 'authorized') return 'approved';
    if (status === 'pending' || status === 'in_process') return 'pending';
    if (status === 'cancelled' || status === 'refunded' || status === 'charged_back') return 'cancelled';
    return 'refused';
}

// Busca a chave de assinatura: primeiro na configuração do painel
// admin, depois na variável de ambiente (compatibilidade com quem
// já tinha rodado `supabase secrets set`).
async function obterWebhookSecret(): Promise<string | null> {
  try {
    const supabase = criarSupabaseAdmin();
    const { data } = await supabase
      .from('gateway_config')
      .select('webhook_secret')
      .eq('gateway_name', 'mercado_pago')
      .maybeSingle();
    if (data?.webhook_secret) return data.webhook_secret;
  } catch (e) {
    console.log("Não foi possível ler webhook_secret do banco:", (e as Error).message);
  }
  return Deno.env.get("MP_WEBHOOK_SECRET") || null;
}

// ------------------------------------------------------------------
// Validação da assinatura do Mercado Pago (HMAC-SHA256)
//
// O endpoint precisa ficar público (o MP chama sem JWT), então a
// assinatura é o que autentica a chamada. Formato do header:
//   x-signature: ts=<epoch>,v1=<hex>
//   manifest:    id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// ------------------------------------------------------------------
async function assinaturaValida(req: Request, dataId: string): Promise<boolean> {
  const secret = await obterWebhookSecret();

  // Sem chave configurada, não dá para validar. Não derrubamos o
  // recebimento de pagamentos por causa disso — mas registramos alto
  // e claro, porque é uma configuração pendente.
  if (!secret) {
    console.warn("⚠️ Chave secreta do webhook não configurada — notificação aceita SEM validação de assinatura. Configure no painel admin, em Config. de pagamento.");
    return true;
  }

  const signature = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
  if (!signature) {
    console.error("❌ Webhook sem header x-signature.");
    return false;
  }

  let ts = "";
  let v1 = "";
  for (const parte of signature.split(",")) {
    const [chave, valor] = parte.split("=", 2);
    if (!chave || !valor) continue;
    if (chave.trim() === "ts") ts = valor.trim();
    if (chave.trim() === "v1") v1 = valor.trim();
  }

  if (!ts || !v1) {
    console.error("❌ Header x-signature malformado:", signature);
    return false;
  }

  // Rejeita replays antigos (tolerância de 5 minutos)
  const idadeSegundos = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(idadeSegundos) || idadeSegundos > 300) {
    console.error("❌ Webhook com timestamp fora da janela:", ts);
    return false;
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId ?? ""};ts:${ts};`;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifest));
  const esperado = Array.from(new Uint8Array(assinado))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparação de tempo constante
  if (esperado.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  }

  if (diff !== 0) {
    console.error("❌ Assinatura do webhook não confere.");
    return false;
  }

  return true;
}

function criarSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function obterAccessToken(supabase: ReturnType<typeof criarSupabaseAdmin>) {
  let accessToken = Deno.env.get("MP_ACCESS_TOKEN");
  try {
    const { data: config } = await supabase
      .from('gateway_config')
      .select('access_token')
      .eq('gateway_name', 'mercado_pago')
      .eq('active', true)
      .single();
    if (config?.access_token) accessToken = config.access_token;
  } catch (e) {
    console.log("Usando MP_ACCESS_TOKEN da env var (fallback):", (e as Error).message);
  }
  if (!accessToken) throw new Error("Access token do Mercado Pago não configurado");
  return accessToken;
}

// Soma 30 dias a partir do vencimento atual (se ainda estiver no
// futuro) ou de hoje. Preserva o tempo já pago numa renovação
// antecipada.
function calcularNovaExpiracao(expiraAtual: string | null | undefined) {
  const hoje = new Date();
  let base = new Date();
  if (expiraAtual) {
    const atual = new Date(expiraAtual);
    if (atual > hoje) base = atual;
  }
  base.setDate(base.getDate() + 30);
  return base.toISOString();
}

async function estenderPremium(
  supabase: ReturnType<typeof criarSupabaseAdmin>,
  userId: string,
  metodo: 'recorrente' | 'avulso',
) {
  const { data: perfil } = await supabase
    .from('perfis').select('expira_em').eq('id', userId).single();

  const { error } = await supabase
    .from('perfis')
    .update({
      plano: 'premium',
      assinatura_status: 'active',
      metodo_assinatura: metodo,
      assinatura_cancelada_em: null,
      expira_em: calcularNovaExpiracao(perfil?.expira_em),
    })
    .eq('id', userId);

  if (error) throw error;
}

// ------------------------------------------------------------------
// Pagamento avulso (PIX / Checkout Pro)
// ------------------------------------------------------------------
async function tratarPagamento(paymentId: string) {
  const supabaseAdmin = criarSupabaseAdmin();
  const accessToken = await obterAccessToken(supabaseAdmin);

  const client = new MercadoPagoConfig({ accessToken });
  const paymentInfo = await new Payment(client).get({ id: paymentId });

  const userId = paymentInfo.external_reference;
  const paymentStatus = normalizePaymentStatus(paymentInfo.status);
  const approved = paymentStatus === "approved";

  if (!userId) return;

  // Idempotência: se já registramos este pagamento como aprovado, sai.
  const { data: existente, error: erroExistente } = await supabaseAdmin
    .from('pagamentos')
    .select('payment_id, status')
    .eq('payment_id', String(paymentId))
    .maybeSingle();

  if (erroExistente) throw erroExistente;
  if (existente?.status === 'approved' && approved) return;

  if (approved) {
    // Cobrança recorrente chega como payment com metadata de assinatura
    const recorrente = Boolean(
      (paymentInfo as Record<string, unknown>).metadata &&
      ((paymentInfo as Record<string, any>).metadata.preapproval_id)
    );
    await estenderPremium(supabaseAdmin, userId, recorrente ? 'recorrente' : 'avulso');
  }

  const { error } = await supabaseAdmin
    .from('pagamentos')
    .upsert({
      payment_id: String(paymentId),
      user_id: userId,
      valor: Number(paymentInfo.transaction_amount || 0),
      plano: 'premium',
      status: paymentStatus,
      gateway: 'mercado_pago',
      external_reference: paymentInfo.external_reference || null,
    }, { onConflict: 'payment_id' });

  if (error) throw error;
  console.log(`✅ Pagamento ${paymentStatus} registrado. Usuário: ${userId}`);
}

// ------------------------------------------------------------------
// Assinatura recorrente (PreApproval)
//
// Cancelar NÃO revoga o acesso na hora: o usuário pagou pelo período
// corrente. Marcamos assinatura_status = 'cancelled' e deixamos plano
// e expira_em como estão — plano_ativo() derruba o acesso sozinho
// quando expira_em passar.
// ------------------------------------------------------------------
async function tratarAssinatura(preapprovalId: string) {
  const supabaseAdmin = criarSupabaseAdmin();
  const accessToken = await obterAccessToken(supabaseAdmin);

  // Consulta direta à API: evita depender de um símbolo específico do
  // SDK, cuja ausência derrubaria também o fluxo de pagamento avulso.
  const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Falha ao consultar preapproval: ${res.status}`);
  const info = await res.json();

  const userId = info.external_reference;
  const status = info.status; // pending | authorized | paused | cancelled
  if (!userId) {
    console.warn("Preapproval sem external_reference:", preapprovalId);
    return;
  }

  const cancelada = status === 'cancelled' || status === 'paused';

  await supabaseAdmin.from('assinaturas').upsert({
    user_id: userId,
    preapproval_id: String(preapprovalId),
    status: status ?? 'pending',
    valor: Number(info.auto_recurring?.transaction_amount || 0),
    proxima_cobranca: info.next_payment_date || null,
    cancelada_em: cancelada ? new Date().toISOString() : null,
  }, { onConflict: 'preapproval_id' });

  if (status === 'authorized') {
    await supabaseAdmin
      .from('perfis')
      .update({
        assinatura_status: 'active',
        metodo_assinatura: 'recorrente',
        mp_preapproval_id: String(preapprovalId),
        assinatura_cancelada_em: null,
      })
      .eq('id', userId);
    console.log(`✅ Assinatura autorizada. Usuário: ${userId}`);
  } else if (cancelada) {
    await supabaseAdmin
      .from('perfis')
      .update({
        assinatura_status: 'cancelled',
        assinatura_cancelada_em: new Date().toISOString(),
        // plano e expira_em intocados de propósito:
        // o acesso vale até o fim do período já pago.
      })
      .eq('id', userId);
    console.log(`⚠️ Assinatura ${status}. Usuário ${userId} mantém acesso até expira_em.`);
  }
}

// Cobrança recorrente aprovada
async function tratarCobrancaRecorrente(authorizedPaymentId: string) {
  const supabaseAdmin = criarSupabaseAdmin();
  const accessToken = await obterAccessToken(supabaseAdmin);

  const res = await fetch(
    `https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Falha ao consultar authorized_payment: ${res.status}`);

  const info = await res.json();
  const preapprovalId = info.preapproval_id;
  const status = normalizePaymentStatus(info.status ?? info.payment?.status);

  if (!preapprovalId) return;

  const { data: assinatura } = await supabaseAdmin
    .from('assinaturas').select('user_id').eq('preapproval_id', String(preapprovalId)).maybeSingle();

  const userId = assinatura?.user_id;
  if (!userId) {
    console.warn("Cobrança recorrente sem assinatura conhecida:", preapprovalId);
    return;
  }

  const paymentId = String(info.payment?.id ?? authorizedPaymentId);

  const { data: existente } = await supabaseAdmin
    .from('pagamentos').select('status').eq('payment_id', paymentId).maybeSingle();
  if (existente?.status === 'approved' && status === 'approved') return;

  if (status === 'approved') {
    await estenderPremium(supabaseAdmin, userId, 'recorrente');
  }

  await supabaseAdmin.from('pagamentos').upsert({
    payment_id: paymentId,
    user_id: userId,
    valor: Number(info.transaction_amount || info.payment?.transaction_amount || 0),
    plano: 'premium',
    status,
    gateway: 'mercado_pago',
    external_reference: String(preapprovalId),
  }, { onConflict: 'payment_id' });

  console.log(`🔁 Cobrança recorrente ${status}. Usuário: ${userId}`);
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const body = await req.json();
    console.log("Webhook recebido no Supabase:", JSON.stringify(body));

    const tipo = body.type || body.topic;
    const dataId = url.searchParams.get("data.id")
      ?? url.searchParams.get("id")
      ?? body?.data?.id
      ?? body?.id;

    if (!dataId) {
      return new Response(JSON.stringify({ received: true, ignored: 'sem id' }), {
        headers: { "Content-Type": "application/json" }, status: 200,
      });
    }

    if (!(await assinaturaValida(req, String(dataId)))) {
      return new Response(JSON.stringify({ error: 'Assinatura inválida' }), {
        headers: { "Content-Type": "application/json" }, status: 401,
      });
    }

    switch (tipo) {
      case 'payment':
        await tratarPagamento(String(dataId));
        break;

      case 'preapproval':
      case 'subscription_preapproval':
        await tratarAssinatura(String(dataId));
        break;

      case 'subscription_authorized_payment':
        await tratarCobrancaRecorrente(String(dataId));
        break;

      default:
        console.log("Tipo de webhook ignorado:", tipo);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("❌ Erro ao processar Webhook:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }
});
