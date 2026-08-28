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
  role text not null default 'user'::text,
  assinatura_status text not null default 'trial'::text,
  ai_daily_limit integer null,
  constraint perfis_pkey primary key (id),
  constraint perfis_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create table public.pagamentos (
  id uuid not null default gen_random_uuid (),
  payment_id text not null,
  user_id uuid not null,
  valor numeric(10, 2) not null default 0,
  plano text not null default 'premium'::text,
  status text not null,
  gateway text not null default 'mercado_pago'::text,
  criado_em timestamp with time zone not null default timezone ('utc'::text, now()),
  external_reference text null,
  constraint pagamentos_pkey primary key (id),
  constraint pagamentos_payment_id_key unique (payment_id),
  constraint pagamentos_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
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
alter table public.pagamentos enable row level security;

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

-- ===== IA =====
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null unique,
  provider_type text not null default 'openai',
  api_key text,
  api_url text not null default 'https://api.openai.com/v1/chat/completions',
  model text not null default 'gpt-4o',
  max_tokens integer not null default 2000,
  temperature numeric(3,2) not null default 0.7,
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_limits (
  id uuid primary key default gen_random_uuid(),
  plan_type text not null unique,
  daily_messages integer not null default 20,
  max_tokens_per_message integer not null default 1500,
  max_history_messages integer not null default 20,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  messages_used integer not null default 0,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_usage_user_date_key unique (user_id, usage_date)
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  tokens_used integer not null default 0,
  provider text,
  created_at timestamptz not null default now()
);

create index idx_ai_usage_user_date on public.ai_usage (user_id, usage_date);
create index idx_ai_conversations_user on public.ai_conversations (user_id, created_at desc);

alter table public.ai_providers enable row level security;
alter table public.ai_limits enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_conversations enable row level security;

create policy "ai_providers_admin_all" on public.ai_providers for all using (is_admin()) with check (is_admin());
create policy "ai_limits_admin_all" on public.ai_limits for all using (is_admin()) with check (is_admin());
create policy "ai_usage_admin_all" on public.ai_usage for all using (is_admin()) with check (is_admin());
create policy "ai_usage_own" on public.ai_usage for select using (auth.uid() = user_id);
create policy "ai_conversations_own_select" on public.ai_conversations for select using (auth.uid() = user_id);
create policy "ai_conversations_own_insert" on public.ai_conversations for insert with check (auth.uid() = user_id);
create policy "ai_limits_read_all" on public.ai_limits for select using (true);
create policy "ai_providers_no_client" on public.ai_providers for select using (false);

insert into public.ai_limits (plan_type, daily_messages, max_tokens_per_message, max_history_messages)
values ('gratuito', 10, 1000, 10), ('premium', 50, 2000, 20), ('admin', 999, 4000, 50)
on conflict (plan_type) do nothing;