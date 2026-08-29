-- ============================================================
-- Função para a tela de confirmação detectar (em QUALQUER
-- dispositivo) se o e-mail do usuário já foi confirmado.
-- Rode no Supabase > SQL Editor
-- ============================================================

create or replace function public.verificar_email_confirmado(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(p_email)
      and u.email_confirmed_at is not null
  )
$$;

-- Permite que o app (anon/authenticated) chame a função
revoke all on function public.verificar_email_confirmado(text) from public;
grant execute on function public.verificar_email_confirmado(text) to anon, authenticated;