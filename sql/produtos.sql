-- Tabela de Produtos
create table public.produtos (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  user_id uuid not null,
  nome text not null,
  descricao text null,
  foto_url text null,
  valor numeric(10, 2) not null,
  constraint produtos_pkey primary key (id),
  constraint produtos_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

-- RLS
alter table public.produtos enable row level security;

create policy "produtos_select_own" on public.produtos for select using (auth.uid() = user_id);
create policy "produtos_insert_own" on public.produtos for insert with check (auth.uid() = user_id);
create policy "produtos_update_own" on public.produtos for update using (auth.uid() = user_id);
create policy "produtos_delete_own" on public.produtos for delete using (auth.uid() = user_id);

-- Storage bucket para fotos de produtos
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;

-- Políticas de storage
drop policy if exists "produtos_select_public" on storage.objects;
create policy "produtos_select_public"
on storage.objects for select
using (bucket_id = 'produtos');

drop policy if exists "produtos_insert_own" on storage.objects;
create policy "produtos_insert_own"
on storage.objects for insert
with check (bucket_id = 'produtos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "produtos_delete_own" on storage.objects;
create policy "produtos_delete_own"
on storage.objects for delete
using (bucket_id = 'produtos' and auth.uid()::text = (storage.foldername(name))[1]);
