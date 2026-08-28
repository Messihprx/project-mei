import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return json({ error: "Não autenticado." }, 401);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return json({ error: "Sessão inválida." }, 401);

  const { data: adminProfile } = await supabaseAdmin
    .from("perfis")
    .select("role")
    .eq("id", user.id)
    .single();
  if (adminProfile?.role !== "admin") return json({ error: "Acesso negado." }, 403);

  try {
    if (req.method === "POST") {
      const { name, email, password, role = "user", plan = "gratuito" } = await req.json();
      if (!name || !email || !password) return json({ error: "Nome, e-mail e senha são obrigatórios." }, 400);
      if (!email.includes("@") || password.length < 8) return json({ error: "E-mail ou senha inválidos." }, 400);
      if (role === "admin") return json({ error: "A criação de novos administradores deve ser feita no Supabase." }, 403);

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome: name }
      });
      if (createError || !created.user) return json({ error: createError?.message || "Não foi possível criar o usuário." }, 400);

      const { error: profileError } = await supabaseAdmin.from("perfis").upsert({
        id: created.user.id,
        nome_completo: name,
        email,
        plano: plan,
        role,
        criado_em: new Date().toISOString()
      });
      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        return json({ error: profileError.message }, 400);
      }
      return json({ ok: true, id: created.user.id });
    }

    const { id } = await req.json();
    if (!id || id === user.id) return json({ error: "Não é possível excluir esta conta." }, 400);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
