-- ============================================================
-- FinMEI — referência do schema atual
--
-- ISTO NÃO É PARA RODAR. É a fotografia de como o banco fica
-- depois de todos os scripts de sql/ terem sido executados,
-- para consulta rápida.
--
-- Para criar ou atualizar o banco de verdade, use os scripts de
-- sql/ na ordem descrita em guia.md (seção 1).
-- ============================================================


-- ============================================================
-- NEGÓCIO
-- ============================================================

-- Perfil do usuário. Criado automaticamente pela trigger
-- handle_new_user quando alguém se cadastra.
perfis
  id                       uuid PK -> auth.users(id)
  nome_completo            text
  email                    text
  data_criacao             timestamptz
  criado_em                timestamptz     -- início da contagem do teste grátis
  plano                    text NOT NULL   -- 'gratuito' | 'premium'
  expira_em                timestamptz     -- até quando o premium vale
  role                     text NOT NULL   -- 'user' | 'admin'
  assinatura_status        text NOT NULL   -- 'trial' | 'active' | 'cancelled'
  ai_daily_limit           int             -- limite individual; NULL usa o do plano
  mp_preapproval_id        text            -- id da assinatura no Mercado Pago
  assinatura_cancelada_em  timestamptz
  metodo_assinatura        text            -- 'recorrente' | 'avulso'

clientes
  id          uuid PK
  user_id     uuid -> auth.users(id) ON DELETE CASCADE
  nome        text NOT NULL
  telefone    text
  observacao  text
  ativo       bool            -- exclusão é soft delete
  created_at  timestamptz NOT NULL

produtos
  id          uuid PK
  user_id     uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  nome        text NOT NULL
  descricao   text
  foto_url    text            -- bucket público 'produtos'
  valor       numeric(10,2) NOT NULL
  created_at  timestamptz NOT NULL

vendas
  id          uuid PK
  user_id     uuid -> auth.users(id) ON DELETE CASCADE
  cliente_id  uuid -> clientes(id) ON DELETE SET NULL
  produto_id  uuid -> produtos(id) ON DELETE SET NULL
  descricao   text NOT NULL
  valor       numeric(10,2) NOT NULL
  status      text            -- 'pago' | 'pendente'
  data_venda  timestamptz NOT NULL  -- DATA DE NEGÓCIO: é por ela que tudo filtra
  created_at  timestamptz NOT NULL  -- quando a linha foi criada; não usar em filtro

despesas
  id          uuid PK
  user_id     uuid NOT NULL -> auth.users(id)
  descricao   text NOT NULL
  valor       numeric NOT NULL
  data        date NOT NULL
  categoria   text            -- Mercadoria | Aluguel | Marketing | Servicos | Outros
  created_at  timestamptz NOT NULL


-- ============================================================
-- PLANOS E COBRANÇA
-- ============================================================

-- Limites por plano, editáveis em Admin -> Planos e limites.
-- NULL em qualquer max_* significa ilimitado.
plano_limites
  plan_type          text PK   -- 'gratuito' | 'premium' | 'admin'
  max_clientes       int
  max_movimentacoes  int       -- vendas + despesas somadas
  max_produtos       int
  trial_dias         int NOT NULL
  active             bool NOT NULL
  atualizado_em      timestamptz NOT NULL

pagamentos
  id                  uuid PK
  payment_id          text NOT NULL UNIQUE   -- id no gateway; garante idempotência
  user_id             uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  valor               numeric(10,2) NOT NULL
  plano               text NOT NULL
  status              text NOT NULL          -- approved | pending | cancelled | refused
  gateway             text NOT NULL
  external_reference  text
  criado_em           timestamptz NOT NULL

-- Assinatura recorrente (PreApproval do Mercado Pago).
assinaturas
  id                uuid PK
  user_id           uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  preapproval_id    text NOT NULL UNIQUE
  status            text NOT NULL   -- pending | authorized | paused | cancelled
  valor             numeric(10,2)
  proxima_cobranca  timestamptz
  cancelada_em      timestamptz
  criado_em         timestamptz NOT NULL
  atualizado_em     timestamptz NOT NULL

-- Configuração do gateway. Guarda segredos: só admin lê, e a edge
-- function mp-config devolve sempre mascarado.
gateway_config
  id                   uuid PK
  gateway_name         text NOT NULL UNIQUE
  access_token         text        -- SEGREDO
  webhook_secret       text        -- SEGREDO (valida a assinatura HMAC do MP)
  public_key           text
  webhook_url          text
  success_url          text
  failure_url          text
  pending_url          text
  back_url_assinatura  text
  price                numeric(10,2) NOT NULL
  plan_name            text NOT NULL
  plan_description     text NOT NULL
  max_installments     int NOT NULL
  recurring_active     bool NOT NULL   -- liga a assinatura no cartão
  active               bool NOT NULL
  created_at           timestamptz NOT NULL
  updated_at           timestamptz NOT NULL


-- ============================================================
-- INTELIGÊNCIA ARTIFICIAL
-- ============================================================

-- Provedores em ordem de prioridade. Se um falha, o próximo assume.
ai_providers
  id             uuid PK
  provider_name  text NOT NULL UNIQUE
  provider_type  text NOT NULL   -- 'openai' (compatíveis) | 'gemini' | 'anthropic'
  api_key        text            -- SEGREDO; só sai do servidor sob pedido
  api_url        text NOT NULL
  model          text NOT NULL
  max_tokens     int NOT NULL
  temperature    numeric(3,2) NOT NULL
  priority       int NOT NULL    -- menor = tentado primeiro
  active         bool NOT NULL
  auth_header    text NOT NULL   -- 'Authorization' | 'api-key' | 'X-Api-Key'...
  auth_prefix    text NOT NULL   -- 'Bearer ' ou vazio
  extra_headers  jsonb NOT NULL  -- headers adicionais, objeto simples
  models_url     text            -- vazio = derivada da api_url
  created_at     timestamptz NOT NULL
  updated_at     timestamptz NOT NULL

ai_limits
  id                      uuid PK
  plan_type               text NOT NULL UNIQUE
  daily_messages          int NOT NULL
  max_tokens_per_message  int NOT NULL
  max_history_messages    int NOT NULL
  active                  bool NOT NULL

ai_usage
  id             uuid PK
  user_id        uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  usage_date     date NOT NULL
  messages_used  int NOT NULL
  tokens_used    int NOT NULL
  UNIQUE (user_id, usage_date)

ai_sessions
  id               uuid PK
  user_id          uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  title            text NOT NULL   -- gerado da primeira mensagem, por trigger
  message_count    int NOT NULL
  last_message_at  timestamptz
  created_at       timestamptz NOT NULL
  updated_at       timestamptz NOT NULL

ai_conversations
  id           uuid PK
  user_id      uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  session_id   uuid -> ai_sessions(id) ON DELETE CASCADE
  role         text NOT NULL   -- 'user' | 'assistant'
  content      text NOT NULL
  tokens_used  int NOT NULL
  provider     text
  created_at   timestamptz NOT NULL

-- Só FALHAS. Conversa que deu certo fica em ai_conversations.
ai_error_logs
  id           uuid PK
  user_id      uuid -> auth.users(id) ON DELETE SET NULL
  session_id   uuid
  tipo         text NOT NULL   -- provider | tool | args | fallback | config
  provider     text
  model        text
  tool_name    text
  http_status  int
  mensagem     text NOT NULL
  detalhe      jsonb           -- truncado em ~4 KB na gravação
  criado_em    timestamptz NOT NULL


-- ============================================================
-- INFRAESTRUTURA
-- ============================================================

-- Handoff de uso único para o app de BI. Sem policy de propósito:
-- nem o dono lê. Só a service role toca.
bi_handoff
  token         text PK
  user_id       uuid NOT NULL -> auth.users(id) ON DELETE CASCADE
  access_token  text NOT NULL
  expira_em     timestamptz NOT NULL   -- 5 minutos
  usado_em      timestamptz
  criado_em     timestamptz NOT NULL

-- Limite de taxa das RPCs públicas. Sem policy: só funções.
rpc_throttle
  chave     text
  janela    timestamptz
  contador  int NOT NULL
  PK (chave, janela)


-- ============================================================
-- FUNÇÕES
-- ============================================================

-- Plano e limites --------------------------------------------
is_admin()                            bool     quem chama é admin?
plano_ativo(uid)                      bool     FONTE ÚNICA do que é acesso válido
limite_disponivel(uid, entidade)      bool     'cliente' | 'produto' | 'movimentacao'
checar_permissao_escrita()            trigger  aplica as duas acima no INSERT
meu_uso_plano()                       json     uso + limites do usuário logado
limites_publicos()                    json     limites por plano (aberta ao anon)

-- Dashboard ---------------------------------------------------
dashboard_resumo(p_mes)               json     KPIs, série mensal, donut, comparação

-- IA -----------------------------------------------------------
limpar_ai_logs(p_dias)                bigint   faxina do log (admin)
resumo_ai_erros()                     json     cards da tela de erros (admin)
cleanup_old_ai_sessions()             void     sessões com mais de 30 dias
generate_session_title()              trigger  título da conversa
update_session_message_count()        trigger  contador de mensagens

-- Auth e infra --------------------------------------------------
handle_new_user()                     trigger  cria o perfil no cadastro
verificar_email_confirmado(p_email)   bool     confirmação entre dispositivos
consumir_throttle(p_chave, p_limite)  bool     limite de taxa
limpar_bi_handoff()                   void     tokens vencidos do BI

-- update_*_timestamp()               trigger  updated_at automático


-- ============================================================
-- ROW LEVEL SECURITY — o resumo
-- ============================================================
--
-- Regra geral: cada usuário só enxerga as próprias linhas
-- (auth.uid() = user_id), e o admin enxerga tudo via is_admin().
--
-- Exceções que importam:
--
--   perfis          usuário só LÊ o próprio. Quem escreve o plano é o
--                   webhook, com service role. Sem isso, daria para
--                   virar premium por conta própria.
--   ai_providers    leitura bloqueada para todos menos admin — a
--                   tabela guarda as chaves de API.
--   gateway_config  só admin, mesma razão.
--   plano_limites   leitura liberada (são só números, e a tela precisa
--                   mostrar "3 de 10"); escrita só admin.
--   ai_limits       leitura liberada, escrita só admin.
--   ai_error_logs   leitura e exclusão só admin; escrita só service role.
--   bi_handoff      NENHUMA policy. Nem o dono lê.
--   rpc_throttle    NENHUMA policy. Só as funções SECURITY DEFINER.
--
-- E o que o RLS NÃO cobre: os limites do plano. Quem aplica são as
-- triggers BEFORE INSERT em clientes, produtos, vendas e despesas —
-- a service role ignora RLS, mas não ignora trigger. É exatamente o
-- que faz o chat de IA respeitar o mesmo limite da tela.


-- ============================================================
-- STORAGE
-- ============================================================
--
-- bucket 'produtos' (público)
--   leitura   qualquer um (as fotos aparecem no catálogo)
--   escrita   só na própria pasta: (storage.foldername(name))[1] = auth.uid()
--   exclusão  mesma regra
