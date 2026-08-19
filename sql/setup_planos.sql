-- 1. Adicionar colunas caso a tabela já exista (sem apagar dados antigos)
ALTER TABLE public.perfis 
ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'gratuito',
ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS expira_em TIMESTAMP WITH TIME ZONE; -- Nova coluna para validade do Premium

-- 2. Habilitar Row Level Security (garante que já está ativo)
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Segurança (O usuário só pode ver seu próprio perfil)
DROP POLICY IF EXISTS "Usuários podem ver seu próprio perfil" ON public.perfis;
CREATE POLICY "Usuários podem ver seu próprio perfil"
ON public.perfis FOR SELECT
USING ( auth.uid() = id ); -- Mudamos de user_id para id

-- 4. Função para auto-inserir perfil quando um novo usuário se cadastra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY definer SET search_path = public
AS $$
BEGIN
  -- Se a sua tabela perfis usa a coluna 'id' como chave estrangeira pra auth.users:
  INSERT INTO public.perfis (id, plano, criado_em)
  VALUES (new.id, 'gratuito', timezone('utc'::text, now()));
  RETURN new;
END;
$$;

-- Remover trigger antiga se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 5. Ativar a trigger para criação
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. Retroatividade: Inserir perfis para os usuários antigos que ainda não têm.
-- Eles ganharão 14 dias grátis a partir do momento em que este script for rodado!
INSERT INTO public.perfis (id, plano, criado_em)
SELECT id, 'gratuito', timezone('utc'::text, now())
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.perfis)
ON CONFLICT (id) DO NOTHING;
