-- ============================================================
-- Limite de taxa para verificar_email_confirmado
-- Execute no Supabase SQL Editor
--
-- A função era concedida a 'anon' sem limite nenhum. O teto por
-- e-mail impede que alguém fique sondando um endereço específico.
--
-- O número precisa conviver com a tela confirmar-email.html, que
-- consulta em intervalo crescente enquanto o usuário espera o
-- e-mail chegar: cerca de 200 consultas na primeira hora com a aba
-- aberta. Um teto de 20/hora, como estava antes, travaria o próprio
-- cadastro depois de um minuto de espera.
--
-- 300/hora deixa a tela funcionar com folga e ainda corta qualquer
-- tentativa de sondagem automatizada, que faria milhares.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rpc_throttle (
  chave     text NOT NULL,
  janela    timestamptz NOT NULL,
  contador  int NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela)
);

ALTER TABLE public.rpc_throttle ENABLE ROW LEVEL SECURITY;
-- Sem policy: ninguém acessa direto. Só as funções SECURITY DEFINER.

CREATE INDEX IF NOT EXISTS idx_rpc_throttle_janela ON public.rpc_throttle (janela);

-- Registra uma chamada e devolve true se ainda está dentro do limite
CREATE OR REPLACE FUNCTION public.consumir_throttle(p_chave text, p_limite int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_janela timestamptz := date_trunc('hour', now());
  v_atual  int;
BEGIN
  INSERT INTO public.rpc_throttle (chave, janela, contador)
  VALUES (p_chave, v_janela, 1)
  ON CONFLICT (chave, janela)
    DO UPDATE SET contador = public.rpc_throttle.contador + 1
  RETURNING contador INTO v_atual;

  -- Faxina oportunista das janelas velhas
  DELETE FROM public.rpc_throttle WHERE janela < now() - interval '2 hours';

  RETURN v_atual <= p_limite;
END;
$$;

-- Função de confirmação de e-mail, agora com throttle
CREATE OR REPLACE FUNCTION public.verificar_email_confirmado(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN false;
  END IF;

  -- Estourou o limite: responde false em vez de revelar qualquer coisa
  IF NOT public.consumir_throttle('email_check:' || v_email, 300) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM auth.users u
     WHERE lower(u.email) = v_email
       AND u.email_confirmed_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_email_confirmado(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verificar_email_confirmado(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.consumir_throttle(text, int) FROM public;
