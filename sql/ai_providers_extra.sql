-- ============================================================
-- Campos livres de autenticação nos provedores de IA
-- Execute no Supabase SQL Editor
--
-- Antes só davam certo provedores que aceitassem exatamente
-- "Authorization: Bearer <chave>". Isso deixava de fora o Azure
-- OpenAI (header api-key, sem prefixo), gateways corporativos
-- (X-Api-Key), o Ollama local (sem chave nenhuma) e qualquer proxy
-- que exija um header próprio.
--
-- Com estes quatro campos, cadastrar um endpoint novo passa a ser
-- configuração — não precisa mais mexer no código da Edge Function.
-- ============================================================

ALTER TABLE public.ai_providers
  -- Nome do header de autenticação. Ex.: Authorization, api-key, X-Api-Key
  ADD COLUMN IF NOT EXISTS auth_header text NOT NULL DEFAULT 'Authorization',

  -- Prefixo colado antes da chave. Vazio para quem manda a chave crua.
  ADD COLUMN IF NOT EXISTS auth_prefix text NOT NULL DEFAULT 'Bearer ',

  -- Headers adicionais. Ex.: {"HTTP-Referer": "...", "X-Title": "FinMEI"}
  ADD COLUMN IF NOT EXISTS extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Endpoint de listagem de modelos. Vazio = derivado da api_url.
  ADD COLUMN IF NOT EXISTS models_url text;

-- extra_headers precisa ser um objeto simples: o valor vai direto
-- para o cabeçalho HTTP, e um array ou escalar quebraria o fetch.
ALTER TABLE public.ai_providers
  DROP CONSTRAINT IF EXISTS ai_providers_extra_headers_check;

ALTER TABLE public.ai_providers
  ADD CONSTRAINT ai_providers_extra_headers_check
  CHECK (jsonb_typeof(extra_headers) = 'object');
