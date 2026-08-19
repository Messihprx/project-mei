🚀 Guia de Configuração Manual: Mercado Pago & Supabase
A base de código para integrar o Mercado Pago Checkout Pro através do Supabase Edge Functions já foi escrita e está dentro da pasta supabase/functions/ do seu projeto.

Para que tudo funcione no mundo real e você possa processar pagamentos na sua conta, siga rigorosamente os passos abaixo:

1. Configurar as Secrets no Supabase
As senhas da sua API nunca podem ficar no código (para evitar roubo). O Supabase guarda essas senhas em um cofre seguro chamado Secrets.

Pegue o seu Access Token no Painel do Mercado Pago.
Abra o terminal (PowerShell ou Prompt de Comando) na pasta do seu projeto (C:\VScode\Mei3) e rode os botões para enviar as chaves pro Supabase:
IMPORTANT

Mude o valor SEU_ACCESS_TOKEN_AQUI para a chave real que pegou no Mercado Pago!

bash
# Isso envia sua chave do Mercado Pago para a nuvem do Supabase
npx supabase secrets set MP_ACCESS_TOKEN=SEU_ACCESS_TOKEN_AQUI
2. Instalar e Fazer Login no Supabase CLI
Você precisa do CLI do Supabase para enviar as funções (como a mp-checkout) para o servidor deles. No seu terminal:

bash
# 1. Faz login na sua conta do Supabase
npx supabase login
# 2. Conecta o seu projeto local com o seu projeto nuvem (Substitua SEU_PROJECT_ID pelo ID que está na URL do seu painel Supabase)
npx supabase link --project-ref SEU_PROJECT_ID
3. Subir as Funções para a Nuvem (Deploy)
As funções mp-checkout e mp-webhook que eu criei estão apenas no seu computador. Mande elas para o servidor com esse comando:

bash
npx supabase functions deploy mp-checkout --no-verify-jwt
npx supabase functions deploy mp-webhook --no-verify-jwt
(A tag --no-verify-jwt garante que o Mercado Pago consiga chamar o webhook livremente).

4. Configurar Webhooks no Mercado Pago
O Webhook é a forma pela qual o Mercado Pago "fofoca" pro seu sistema: "Opa, aquele cliente acabou de pagar o PIX".

Volte ao Painel de Desenvolvedores do Mercado Pago.
Selecione a sua Aplicação > Serviços > Webhooks (ou Notificações).
Na URL de Produção, coloque a URL da sua Edge Function. Será parecido com isso: https://SEU_PROJECT_ID.supabase.co/functions/v1/mp-webhook
Marque para receber eventos de Pagamentos (Pagamentos recebidos/atualizados).
5. Dica de Segurança e URL (planos.html)
No arquivo planos.html e na function mp-checkout, tem um trecho de back_urls:

js
back_urls: {
          success: "https://SEU_DOMINIO.com/index.html?pagamento=sucesso",
          failure: "https://SEU_DOMINIO.com/planos.html?pagamento=falha",
          pending: "https://SEU_DOMINIO.com/planos.html?pagamento=pendente",
        },
WARNING

Quando for colocar seu site no ar (ex: na Vercel ou Netlify), abra o arquivo supabase/functions/mp-checkout/index.ts e troque o texto https://SEU_DOMINIO.com pelo endereço oficial do seu site! Em seguida, rode o npx supabase functions deploy mp-checkout de novo para atualizar a nuvem.

Pronto! Com isso configurado, ao clicar em "Assinar", o usuário será lançado para o Checkout Pro estiloso do Mercado Pago e o sistema já está engatilhado para receber a confirmação!

## Ao passar o site pro host lembrar de alterar os links no:

MERCADO PAGO - CHAVES DE PRODUÇÃO
SUPABASE - URLS 
LINKS DENTRO DO INDEX.TS -> checkout_sucesso.html, checkout_erro.html, checkout_pendente.html
alterar o valor em planos.js -> unit_price: 1.00 pra 15.90