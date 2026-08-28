-- Adiciona coluna produto_id na tabela vendas (opcional, para vincular venda a produto)
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS produto_id uuid null,
  ADD CONSTRAINT vendas_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos (id) ON DELETE SET NULL;
