-- ============================================================
-- CORREÇÃO: preencher nome_completo e email na tabela perfis
-- Rode este script no Supabase > SQL Editor
--
-- 1. Atualiza a trigger para gravar nome e email em novos cadastros
--    (funciona para cadastro com e-mail e login com Google)
-- 2. Preenche os perfis antigos que ficaram com NULL
-- ============================================================

-- 1. Trigger atualizada (nome vindo de metadata do cadastro ou do Google)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY definer SET search_path = public
AS $$
BEGIN
  INSERT INTO public.perfis (id, nome_completo, email, plano, criado_em)
  VALUES (
    new.id,
    COALESCE(
      new.raw_user_meta_data->>'nome',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    new.email,
    'gratuito',
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Garante que a trigger continua ativa
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 2. Retroatividade: preencher os perfis antigos que estão com NULL
UPDATE public.perfis p
SET nome_completo = COALESCE(
      u.raw_user_meta_data->>'nome',
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      p.nome_completo
    ),
    email = COALESCE(u.email, p.email)
FROM auth.users u
WHERE p.id = u.id
  AND (p.nome_completo IS NULL OR p.email IS NULL);
