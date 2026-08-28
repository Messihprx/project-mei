-- ============================================================
-- Sistema de sessões de conversa com IA (refinado)
-- Execute no Supabase SQL Editor
-- ============================================================

-- Tabela de sessões de conversa
CREATE TABLE IF NOT EXISTS public.ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversa',
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON public.ai_sessions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user_created ON public.ai_sessions (user_id, created_at DESC);

-- Atualizar tabela de mensagens com session_id
ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.ai_sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_session ON public.ai_conversations (session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_date ON public.ai_conversations (user_id, created_at DESC);

-- RLS para sessões
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_sessions_own_all" ON public.ai_sessions;
CREATE POLICY "ai_sessions_own_all" ON public.ai_sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_sessions_admin_all" ON public.ai_sessions;
CREATE POLICY "ai_sessions_admin_all" ON public.ai_sessions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Trigger de updated_at para sessões
DROP TRIGGER IF EXISTS trg_ai_sessions_updated ON public.ai_sessions;
CREATE TRIGGER trg_ai_sessions_updated BEFORE UPDATE ON public.ai_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_timestamp();

-- Função para limpar sessões antigas (manter 30 dias)
CREATE OR REPLACE FUNCTION public.cleanup_old_ai_sessions()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.ai_sessions
  WHERE updated_at < now() - interval '30 days'
    AND user_id NOT IN (SELECT id FROM public.perfis WHERE role = 'admin');
END;
$$;

-- Função para auto-gerar título da sessão (primeiras palavras da primeira mensagem)
CREATE OR REPLACE FUNCTION public.generate_session_title()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'user' AND EXISTS (
    SELECT 1 FROM public.ai_conversations WHERE session_id = NEW.session_id AND role = 'user'
  ) = false THEN
    UPDATE public.ai_sessions
    SET title = left(regexp_replace(NEW.content, E'[\\n\\r]+', ' ', 'g'), 50)
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_conversations_title ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_title AFTER INSERT ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.generate_session_title();

-- Função para atualizar contador de mensagens
CREATE OR REPLACE FUNCTION public.update_session_message_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ai_sessions
    SET message_count = message_count + 1, last_message_at = NEW.created_at, updated_at = now()
    WHERE id = NEW.session_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.ai_sessions
    SET message_count = message_count - 1, updated_at = now()
    WHERE id = OLD.session_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_conversations_count ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_count AFTER INSERT OR DELETE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_session_message_count();
