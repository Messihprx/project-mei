create table public.clientes (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  nome text not null,
  telefone text null,
  observacao text null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  ativo boolean null default true,
  constraint clientes_pkey primary key (id),
  constraint clientes_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create table public.despesas (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  descricao text not null,
  valor numeric not null,
  data date not null default now(),
  categoria text null,
  user_id uuid not null,
  constraint despesas_pkey primary key (id),
  constraint despesas_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;

create table public.perfis (
  id uuid not null,
  nome_completo text null,
  email text null,
  data_criacao timestamp with time zone null default now(),
  plano text not null default 'gratuito'::text,
  criado_em timestamp with time zone null default timezone ('utc'::text, now()),
  expira_em timestamp with time zone null,
  constraint perfis_pkey primary key (id),
  constraint perfis_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create table public.vendas (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  cliente_id uuid null,
  descricao text not null,
  valor numeric(10, 2) not null,
  status text null default 'pendente'::text,
  data_venda timestamp with time zone not null default timezone ('utc'::text, now()),
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint vendas_pkey primary key (id),
  constraint vendas_cliente_id_fkey foreign KEY (cliente_id) references clientes (id) on delete set null,
  constraint vendas_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

-- ===== ROW LEVEL SECURITY =====
alter table public.clientes enable row level security;
alter table public.despesas enable row level security;
alter table public.perfis enable row level security;
alter table public.vendas enable row level security;

-- clientes: usuário só acessa os próprios registros
create policy "clientes_select_own" on public.clientes for select using (auth.uid() = user_id);
create policy "clientes_insert_own" on public.clientes for insert with check (auth.uid() = user_id);
create policy "clientes_update_own" on public.clientes for update using (auth.uid() = user_id);
create policy "clientes_delete_own" on public.clientes for delete using (auth.uid() = user_id);

-- despesas
create policy "despesas_select_own" on public.despesas for select using (auth.uid() = user_id);
create policy "despesas_insert_own" on public.despesas for insert with check (auth.uid() = user_id);
create policy "despesas_update_own" on public.despesas for update using (auth.uid() = user_id);
create policy "despesas_delete_own" on public.despesas for delete using (auth.uid() = user_id);

-- perfis: só leitura do próprio perfil (a inserção é feita pela trigger SECURITY DEFINER, que ignora RLS)
create policy "perfis_select_own" on public.perfis for select using (auth.uid() = id);

-- vendas
create policy "vendas_select_own" on public.vendas for select using (auth.uid() = user_id);
create policy "vendas_insert_own" on public.vendas for insert with check (auth.uid() = user_id);
create policy "vendas_update_own" on public.vendas for update using (auth.uid() = user_id);
create policy "vendas_delete_own" on public.vendas for delete using (auth.uid() = user_id);