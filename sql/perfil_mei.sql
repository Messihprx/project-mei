-- ============================================================
-- Meu perfil do MEI
--
-- Dados complementares do perfil (todos opcionais), foto do
-- usuário e o bucket público onde a foto é guardada.
--
-- Execute no Supabase SQL Editor depois de setup_planos.sql e
-- admin_supabase.sql (este script usa is_admin()).
-- ============================================================

-- 1. Campos do perfil -------------------------------------------------
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS foto_url             text,
  ADD COLUMN IF NOT EXISTS cpf                  text,
  ADD COLUMN IF NOT EXISTS data_nascimento      date,
  ADD COLUMN IF NOT EXISTS celular              text,
  ADD COLUMN IF NOT EXISTS telefone             text,
  ADD COLUMN IF NOT EXISTS nome_fantasia        text,
  ADD COLUMN IF NOT EXISTS razao_social         text,
  ADD COLUMN IF NOT EXISTS cnpj                 text,
  ADD COLUMN IF NOT EXISTS inscricao_municipal  text,
  ADD COLUMN IF NOT EXISTS cnae                 text,
  ADD COLUMN IF NOT EXISTS data_abertura        date,
  ADD COLUMN IF NOT EXISTS cep                  text,
  ADD COLUMN IF NOT EXISTS logradouro           text,
  ADD COLUMN IF NOT EXISTS numero               text,
  ADD COLUMN IF NOT EXISTS complemento          text,
  ADD COLUMN IF NOT EXISTS bairro               text,
  ADD COLUMN IF NOT EXISTS cidade               text,
  ADD COLUMN IF NOT EXISTS estado               text,
  ADD COLUMN IF NOT EXISTS site                 text,
  ADD COLUMN IF NOT EXISTS instagram            text,
  ADD COLUMN IF NOT EXISTS chave_pix            text,
  ADD COLUMN IF NOT EXISTS bio                  text,
  ADD COLUMN IF NOT EXISTS atualizado_em        timestamptz DEFAULT timezone('utc'::text, now());

-- 2. O dono pode atualizar o próprio perfil ---------------------------
--    (a política de SELECT do próprio perfil já existe em setup_planos.sql)
DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio perfil" ON public.perfis;
CREATE POLICY "Usuários podem atualizar seu próprio perfil"
ON public.perfis FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 3. Campos que o usuário NÃO pode alterar sozinho --------------------
--    Sem isso, com a política de UPDATE acima, daria para virar admin
--    (role = 'admin') ou liberar o plano premium por chamada direta à API.
--    Admin do painel e service role continuam livres para alterar.
CREATE OR REPLACE FUNCTION public.proteger_campos_perfil()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protegidos constant text[] := ARRAY[
    'id', 'email', 'plano', 'expira_em', 'criado_em', 'data_criacao',
    'role', 'assinatura_status', 'ai_daily_limit', 'mp_preapproval_id',
    'assinatura_cancelada_em', 'metodo_assinatura'
  ];
  dados jsonb;
  campo text;
BEGIN
  IF auth.uid() = OLD.id AND NOT public.is_admin() THEN
    dados := to_jsonb(NEW);
    FOREACH campo IN ARRAY protegidos LOOP
      IF to_jsonb(OLD) ? campo THEN
        dados := jsonb_set(dados, ARRAY[campo], to_jsonb(OLD) -> campo, true);
      END IF;
    END LOOP;
    NEW := jsonb_populate_record(NEW, dados);
  END IF;

  NEW.atualizado_em := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_perfil ON public.perfis;
CREATE TRIGGER trg_proteger_campos_perfil
  BEFORE UPDATE ON public.perfis
  FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_perfil();

-- 4. Bucket das fotos de perfil --------------------------------------
--    Público para leitura (a foto aparece no site), escrita apenas
--    na pasta do próprio usuário: <uid>/arquivo.jpg
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;
CREATE POLICY "avatars_select_public"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
