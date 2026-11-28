-- ============================================================
-- Avaliações dos usuários (0 a 10, meia estrela = 1 ponto)
-- A landing só exibe as avaliações aprovadas pelo admin.
-- ============================================================

create table if not exists public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  nota numeric(3, 1) not null check (nota >= 0 and nota <= 10),
  comentario text,
  nome_exibicao text,
  segmento text,
  -- O usuário pede para aparecer; o admin é quem libera.
  solicita_exibir boolean not null default true,
  exibir_landing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.avaliacoes enable row level security;

drop policy if exists "avaliacoes_select_own" on public.avaliacoes;
create policy "avaliacoes_select_own"
  on public.avaliacoes for select
  using (auth.uid() = user_id);

drop policy if exists "avaliacoes_insert_own" on public.avaliacoes;
create policy "avaliacoes_insert_own"
  on public.avaliacoes for insert
  with check (auth.uid() = user_id);

drop policy if exists "avaliacoes_update_own" on public.avaliacoes;
create policy "avaliacoes_update_own"
  on public.avaliacoes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "avaliacoes_delete_own" on public.avaliacoes;
create policy "avaliacoes_delete_own"
  on public.avaliacoes for delete
  using (auth.uid() = user_id);

drop policy if exists "avaliacoes_admin_all" on public.avaliacoes;
create policy "avaliacoes_admin_all"
  on public.avaliacoes for all
  using (public.is_admin())
  with check (public.is_admin());

-- Usuário comum não pode aprovar a própria avaliação nem trocar o dono.
create or replace function public.avaliacoes_protege_exibicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.exibir_landing := false;
    else
      new.exibir_landing := old.exibir_landing;
      new.user_id := old.user_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_avaliacoes_protege on public.avaliacoes;
create trigger trg_avaliacoes_protege
  before insert or update on public.avaliacoes
  for each row execute function public.avaliacoes_protege_exibicao();

-- Retorno público usado pela landing (não expõe user_id).
create or replace function public.avaliacoes_landing()
returns table (
  nome text,
  nota numeric,
  comentario text,
  segmento text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(nullif(trim(nome_exibicao), ''), 'Cliente FinMEI') as nome,
    nota,
    comentario,
    segmento,
    created_at
  from public.avaliacoes
  where exibir_landing = true
    and nota > 0
  order by created_at desc
  limit 50;
$$;

grant execute on function public.avaliacoes_landing() to anon, authenticated;

grant select, insert, update, delete on public.avaliacoes to authenticated;
