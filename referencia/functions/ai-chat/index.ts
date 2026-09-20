import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Você é o FinMei, assistente financeiro inteligente do FinMEI — plataforma de gestão financeira para MEI (Microempreendedor Individual).

## Personalidade
- Responda em português brasileiro, de forma CURTA e DIREITA (máx 3-4 linhas)
- Sem emojis excessivos (máximo 1-2 por mensagem)
- Sem listas longas — seja conciso e objetivo
- Valores em R$ (ex: R$ 1.500,00), datas em dd/mm/aaaa
- Seja inteligente: analise os dados do contexto antes de responder, dê conselhos práticos quando apropriado
- Nunca invente dados — sempre consulte o banco ou use os dados do contexto

## Regras de Cadastro (OBRIGATÓRIO SEGUIR)
- SEMPRE pergunte os dados obrigatórios ANTES de cadastrar. NUNCA cadastre com dados faltando
- Se faltar qualquer dado obrigatório, NÃO chame nenhum tool e pergunte somente o que falta
- Se o usuário já deu todos os dados, confirme antes de cadastrar (ex: "Quer cadastrar [X] por R$ [Y]?")
- IMPORTANTE: NUNCA afirme que cadastrou/editou/excluiu sem ANTES ter chamado o tool e recebido sucesso

### Cadastro de Cliente (criar_cliente)
- OBRIGATÓRIO: nome completo E telefone
- OPCIONAL: observação
- Validação: nome deve ter pelo menos 2 caracteres, sem números; telefone no formato DDD + 9-10 dígitos

### Cadastro de Venda (criar_venda)
- OBRIGATÓRIO: descrição, valor e data
- OPCIONAL: cliente (se não informado, fica como "cliente avulso"), produto, conta
- Status padrão: "pago" (se não informado)
- FLUXO COM PRODUTO: PRIMEIRO use buscar_produtos para verificar se o produto existe
  - 1 resultado → vincule automaticamente (use produto_id, valor e descrição do produto; mas se o usuário deu valor explícito diferente, use o valor do usuário)
  - Múltiplos resultados → mostre nomes e preços, peça para o usuário escolher
  - Nenhum resultado → crie a venda sem vínculo (sem produto_id)
  - Nunca invente um produto_id
- FLUXO COM CONTA: Se o usuário mencionar uma conta, use buscar_contas para encontrar e vincular (conta_id). Se não mencionar, a venda fica sem conta vinculada.

### Cadastro de Gasto (criar_gasto)
- OBRIGATÓRIO: descrição, valor, data e categoria
- Categorias disponíveis (escolha a mais adequada): "Mercadoria" (Mercadoria/Estoque), "Aluguel" (Aluguel/Espaço), "Marketing" (Marketing/Anúncios), "Serviços" (Luz/Água/Internet), "Outros"
- Você deve deduzir a categoria automaticamente com base na descrição do usuário
- OPCIONAL: conta financeira — se o usuário mencionar uma conta, use buscar_contas para vincular

### Cadastro de Produto (criar_produto)
- OBRIGATÓRIO: nome, descrição e valor
- OPCIONAL: foto (o usuário deve adicioná-la depois pelo site, não é possível via chat)
- Verifique duplicatas por nome antes de cadastrar

### Cadastro de Devedor (criar_devedor)
- Use quando o usuário disser que alguém está devendo
- OBRIGATÓRIO: nome do cliente (já cadastrado), produto/descrição e valor
- OPCIONAL: data (usa hoje se não informada)
- NUNCA invente cliente_id. NUNCA use criar_venda para representar um devedor

### Edição
- Peça o identificador e pelo menos um campo para alterar
- Busque o registro primeiro, mostre o que tem, confirme a alteração e só então edite
- Nunca invente IDs nem valores

### Exclusão
- SEMPRE confirme com o usuário antes de excluir
- Quando confirmar ("sim", "confirmo"), chame o tool imediatamente
- Só diga que excluiu após o tool retornar sucesso

## Sobre o FinMEI — Funcionalidades Detalhadas

### Dashboard (Página Inicial)
- Saudação personalizada com nome e horário do dia
- Filtro de mês para alternar entre períodos
- 4 cards de métricas: Recebido (vendas pagas do mês), A Receber (vendas pendentes), Despesas do mês, Lucro Líquido
- Saldo Geral Disponível: faturamento total menos despesas totais (histórico completo)
- Gráficos: Receitas x Despesas (barras mensais), Evolução do Lucro (linha), Distribuição de Vendas por Produto (donut)
- Comparação com o mês anterior: variação %, margem de lucro
- Lista das 5 movimentações mais recentes
- Histórico mensal de lucros

### Vendas
- Cadastro, edição e exclusão de vendas
- Status: "pago" (recebido) ou "pendente" (a receber)
- Cada venda pode estar vinculada a um cliente e/ou a um produto
- Filtros: busca por texto e filtro por mês
- Opção de exportar para CSV (premium)

### Gastos (Despesas)
- Cadastro, edição e exclusão de gastos
- 5 categorias fixas: Mercadoria/Estoque, Aluguel/Espaço, Marketing/Anúncios, Luz/Água/Internet, Outros
- Filtros: filtro por mês
- Total do mês exibido no topo
- Exportar para CSV (premium)

### Clientes
- Cadastro com nome, telefone e observação (opcional)
- Busca em tempo real por nome
- Botão de WhatsApp integrado (abre wa.me com mensagem pré-definida)
- Edição e exclusão (exclusão é soft delete — só fica inativo)
- Limite: 10 clientes no plano gratuito

### Contas Financeiras
- Cadastro de contas bancárias, poupança, caixa ou carteira digital
- Classificação por finalidade: Negócio, Pessoal ou Misto
- Tipos: Banco PJ, Banco PF, Poupança, Caixa, Carteira Digital, Outro
- Saldo inicial e atual de cada conta
- Transferência entre contas (sem contabilizar como receita/despesa)
- Saldo consolidado: soma das contas classificadas como Negócio ou Misto
- Vinculação de vendas e gastos a contas específicas
- Consulta de movimentações por conta

### Produtos
- Catálogo de produtos/serviços com nome, descrição, valor e foto (opcional)
- Fotos são comprimidas automaticamente antes de upload
- Busca por nome em tempo real
- Quando um produto é selecionado numa nova venda, nome e valor são preenchidos automaticamente
- Vínculo optional: uma venda pode ou não estar ligada a um produto

### Devedores
- Lista de vendas com status "pendente" (pagamentos pendentes)
- Botão de cobrança via WhatsApp com mensagem automática
- Botão para marcar como pago (muda status de pendente para pago)
- Total a receber e quantidade de pendentes exibidos no topo

### IA (este chat)
- Assistente financeiro que pode cadastrar, buscar, editar e excluir dados
- Acessível pela sidebar ("FinMEI IA") ou pelo botão flutuante (FAB) em todas as páginas
- Limite diário de mensagens: 10 (gratuito) ou 50 (premium)
- Sessões de conversa persistentes

### Planos
- Gratuito: 14 dias de trial, 10 clientes, 50 movimentações, 10 msgs IA/dia
- Premium (R$ 15,90/mês): ilimitado, exportação, relatórios BI, 50 msgs IA/dia
- Pagamento via Mercado Pago

### Relatórios BI (Premium)
- Dashboard analítico com gráficos avançados (Plotly)
- KPIs: Receita, A Receber, Despesas, Lucro, Ticket Médio
- Gráficos: evolução diária, status das vendas, receita vs despesas, gastos por categoria, top clientes

### Importar CSV (Premium)
- Importação de planilhas CSV para clientes, gastos e vendas
- Auto-detecção de delimitador e nomes de colunas
- Formatos de data suportados: DD/MM/AAAA e YYYY-MM-DD

## Dados do Contexto
Você recebe automaticamente um resumo dos dados do usuário (faturamento, gastos, lucro, clientes, produtos, etc). Use esses dados para dar respostas inteligentes e contextualizadas. Não repita os dados brutos — analise e aconselhe.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_vendas",
      description: "Busca vendas do usuário. Pode filtrar por período, status ou cliente.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          status: { type: "string", description: "Filtrar por status: pago, pendente, cancelado" },
          cliente_id: { type: "string", description: "ID do cliente para filtrar" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_gastos",
      description: "Busca gastos/despesas do usuário. Pode filtrar por período ou categoria.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          categoria: { type: "string", description: "Filtrar por categoria" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_clientes",
      description: "Busca clientes do usuário.",
      parameters: {
        type: "object",
        properties: {
          busca: { type: "string", description: "Nome ou telefone para buscar" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_produtos",
      description: "Busca produtos cadastrados pelo usuário. Use para encontrar um produto antes de vincular a uma venda. Retorna produtos com nome, valor e descrição.",
      parameters: {
        type: "object",
        properties: {
          busca: { type: "string", description: "Nome do produto para buscar (busca parcial, tolerante a erros)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_produto",
      description: "Cadastra um novo produto. Só chame quando nome, descrição e valor estiverem informados. Se faltar algum, pergunte ao usuário e aguarde. A foto é OPCIONAL e deve ser adicionada pelo usuário depois pelo site.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do produto" },
          descricao: { type: "string", description: "Descrição do produto" },
          valor: { type: "number", description: "Valor do produto em reais" }
        },
        required: ["nome", "descricao", "valor"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_produto",
      description: "Edita um produto existente. Só chame com produto_id válido e pelo menos um campo de alteração (nome, descricao ou valor). Se faltar, pergunte ao usuário e aguarde.",
      parameters: {
        type: "object",
        properties: {
          produto_id: { type: "string", description: "ID do produto" },
          nome: { type: "string", description: "Novo nome" },
          descricao: { type: "string", description: "Nova descrição" },
          valor: { type: "number", description: "Novo valor" }
        },
        required: ["produto_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "excluir_produto",
      description: "Exclui um produto. Confirme com o usuário antes de usar.",
      parameters: {
        type: "object",
        properties: {
          produto_id: { type: "string", description: "ID do produto" }
        },
        required: ["produto_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resumo_financeiro",
      description: "Gera resumo financeiro: total de vendas, gastos, lucro, ticket médio.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_venda",
      description: "Cria uma nova venda para o usuário. Só chame quando descrição, valor e data estiverem informados. Se faltar algum, pergunte ao usuário e aguarde. Se o usuário mencionou um produto, use buscar_produtos antes para tentar vincular (produto_id). Se o produto não for encontrado, crie sem vínculo. Se mencionou uma conta, use buscar_contas para vincular (conta_id).",
      parameters: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Descrição da venda" },
          valor: { type: "number", description: "Valor da venda em reais" },
          status: { type: "string", description: "Status: pago, pendente, cancelado" },
          data_venda: { type: "string", description: "Data da venda (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          cliente_id: { type: "string", description: "ID do cliente (opcional)" },
          produto_id: { type: "string", description: "ID do produto para vincular à venda (opcional). Use o retornado por buscar_produtos." },
          conta_id: { type: "string", description: "ID da conta financeira para vincular (opcional). Use o retornado por buscar_contas." }
        },
        required: ["descricao", "valor", "data_venda"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_devedor",
      description: "Registra uma venda pendente para um cliente existente. Use quando o usuário disser que alguém está devendo. Nome do cliente, produto/descrição e valor são obrigatórios; se faltar qualquer um, não chame a ferramenta. Localize o cliente pelo nome e nunca invente um ID.",
      parameters: {
        type: "object",
        properties: {
          cliente_nome: { type: "string", description: "Nome do cliente já cadastrado" },
          valor: { type: "number", description: "Valor devido em reais" },
          data_venda: { type: "string", description: "Data da dívida (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem'), opcional; use hoje se não informada" },
          descricao: { type: "string", description: "Produto ou descrição do que foi comprado (obrigatório)" }
        },
        required: ["cliente_nome", "valor", "descricao"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_gasto",
      description: "Cria um novo gasto/despesa para o usuário. Só chame quando descrição, valor, data e categoria estiverem informados. Se faltar algum, pergunte ao usuário e aguarde. A IA deve selecionar a categoria automaticamente com base na descrição. Se o usuário mencionar uma conta, use buscar_contas para vincular (conta_id).",
      parameters: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Descrição do gasto" },
          valor: { type: "number", description: "Valor do gasto em reais" },
          categoria: { type: "string", enum: ["Mercaria/Estoque", "Aluguel/Espaço", "Marketing/Anúncios", "Luz/Água/internet", "Outros"], description: "Categoria do gasto obrigatoriamente dentre as listadas" },
          data: { type: "string", description: "Data do gasto (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          conta_id: { type: "string", description: "ID da conta financeira para vincular (opcional). Use o retornado por buscar_contas." }
        },
        required: ["descricao", "valor", "categoria", "data"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_cliente",
      description: "Cadastra um novo cliente. Só chame quando nome e telefone estiverem informados. Se faltar algum, pergunte ao usuário e aguarde.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente" },
          telefone: { type: "string", description: "Telefone do cliente (obrigatório)" },
          observacao: { type: "string", description: "Observação sobre o cliente (OPCIONAL)" }
        },
        required: ["nome", "telefone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "verificar_duplicata",
      description: "Verifica se já existe um registro similar no banco. Use ANTES de cadastrar vendas, gastos ou clientes. Retorna os registros encontrados.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", description: "Tipo: venda, gasto ou cliente" },
          descricao: { type: "string", description: "Descrição/nome pra buscar (busca parcial)" },
          valor: { type: "number", description: "Valor pra comparar (exato)" },
          data: { type: "string", description: "Data pra comparar (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          telefone: { type: "string", description: "Telefone exato para localizar cliente" }
        },
        required: ["tipo", "descricao"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "top_gastos",
      description: "Retorna os maiores gastos do período, ordenados por valor.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          limite: { type: "number", description: "Quantidade de resultados (padrão 5)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "vendas_por_cliente",
      description: "Agrupa vendas por cliente mostrando total e quantidade.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resumo_por_categoria",
      description: "Agrupa gastos por categoria mostrando total de cada. Útil pra entender onde o dinheiro está indo.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Data início (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          data_fim: { type: "string", description: "Data fim (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_cliente",
      description: "Edita um cliente existente. Só chame com cliente_id válido e pelo menos um campo de alteração (nome, telefone ou observação). Se faltar, pergunte ao usuário e aguarde.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID do cliente" },
          nome: { type: "string", description: "Novo nome" },
          telefone: { type: "string", description: "Novo telefone" },
          observacao: { type: "string", description: "Nova observação" }
        },
        required: ["cliente_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_venda",
      description: "Edita uma venda existente. Só chame com venda_id válido e pelo menos um campo de alteração (descrição, valor, status ou data). Se faltar, pergunte ao usuário e aguarde.",
      parameters: {
        type: "object",
        properties: {
          venda_id: { type: "string", description: "ID da venda" },
          descricao: { type: "string", description: "Nova descrição" },
          valor: { type: "number", description: "Novo valor" },
          status: { type: "string", description: "Novo status: pago, pendente, cancelado" },
          data_venda: { type: "string", description: "Nova data (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" }
        },
        required: ["venda_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_gasto",
      description: "Edita um gasto/despesa existente. Só chame com gasto_id válido e pelo menos um campo de alteração (descrição, valor, categoria ou data). Se faltar, pergunte ao usuário e aguarde.",
      parameters: {
        type: "object",
        properties: {
          gasto_id: { type: "string", description: "ID do gasto" },
          descricao: { type: "string", description: "Nova descrição" },
          valor: { type: "number", description: "Novo valor" },
          categoria: { type: "string", description: "Nova categoria" },
          data: { type: "string", description: "Nova data (YYYY-MM-DD)" }
        },
        required: ["gasto_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "excluir_cliente",
      description: "Exclui um cliente após confirmação explícita do usuário. Use cliente_id quando disponível; após uma confirmação em uma mensagem seguinte, use o nome ou telefone exato informado anteriormente. Nunca exclua se houver mais de uma correspondência.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID do cliente, quando disponível" },
          nome: { type: "string", description: "Nome exato do cliente, quando o ID não estiver disponível" },
          telefone: { type: "string", description: "Telefone exato do cliente, quando o ID não estiver disponível" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "excluir_venda",
      description: "Exclui uma venda. Confirme com o usuário antes de usar.",
      parameters: {
        type: "object",
        properties: {
          venda_id: { type: "string", description: "ID da venda" }
        },
        required: ["venda_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "excluir_gasto",
      description: "Exclui um gasto/despesa. Confirme com o usuário antes de usar.",
      parameters: {
        type: "object",
        properties: {
          gasto_id: { type: "string", description: "ID do gasto" }
        },
        required: ["gasto_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_contas",
      description: "Busca contas financeiras do usuário. Pode filtrar por nome, tipo ou finalidade.",
      parameters: {
        type: "object",
        properties: {
          busca: { type: "string", description: "Nome da conta para buscar (busca parcial)" },
          tipo: { type: "string", description: "Filtrar por tipo: banco_pj, banco_pf, poupanca, caixa, carteira_digital, outro" },
          finalidade: { type: "string", description: "Filtrar por finalidade: negocio, pessoal, misto" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_conta",
      description: "Cadastra uma nova conta financeira. OBRIGATÓRIO: nome. OPCIONAL: instituição, tipo, finalidade, saldo inicial.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome da conta (ex: Nubank PJ, Itaú Negócio)" },
          instituicao: { type: "string", description: "Instituição financeira (ex: Nubank, Bradesco)" },
          tipo: { type: "string", enum: ["banco_pj", "banco_pf", "poupanca", "caixa", "carteira_digital", "outro"], description: "Tipo da conta" },
          finalidade: { type: "string", enum: ["negocio", "pessoal", "misto"], description: "Finalidade da conta" },
          saldo_inicial: { type: "number", description: "Saldo inicial da conta em reais" }
        },
        required: ["nome"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_conta",
      description: "Edita uma conta financeira existente. Só chame com conta_id válido e pelo menos um campo de alteração.",
      parameters: {
        type: "object",
        properties: {
          conta_id: { type: "string", description: "ID da conta" },
          nome: { type: "string", description: "Novo nome da conta" },
          instituicao: { type: "string", description: "Nova instituição" },
          tipo: { type: "string", enum: ["banco_pj", "banco_pf", "poupanca", "caixa", "carteira_digital", "outro"], description: "Novo tipo" },
          finalidade: { type: "string", enum: ["negocio", "pessoal", "misto"], description: "Nova finalidade" }
        },
        required: ["conta_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "excluir_conta",
      description: "Exclui uma conta financeira. Se não houver movimentações vinculadas, exclui permanentemente. Se houver, pede confirmação e remove o vínculo (mantém vendas/gastos). Use também para inativar (soft delete). Confirme com o usuário antes de usar.",
      parameters: {
        type: "object",
        properties: {
          conta_id: { type: "string", description: "ID da conta" },
          permanente: { type: "boolean", description: "Se true, exclui permanentemente. Se false ou omitido, inativa (soft delete). Default: false" }
        },
        required: ["conta_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "saldo_por_conta",
      description: "Mostra o saldo de uma conta específica ou o saldo consolidado de todas as contas de negócio.",
      parameters: {
        type: "object",
        properties: {
          conta_id: { type: "string", description: "ID da conta (opcional — se não informado, retorna saldo consolidado)" },
          consolidado: { type: "boolean", description: "Se true, retorna saldo consolidado das contas de negócio" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "transferir_entre_contas",
      description: "Transfere valor de uma conta para outra. IMPORTANTE: isso NÃO é receita nem despesa — é apenas movimentação entre contas próprias.",
      parameters: {
        type: "object",
        properties: {
          conta_origem_id: { type: "string", description: "ID da conta de origem" },
          conta_destino_id: { type: "string", description: "ID da conta de destino" },
          valor: { type: "number", description: "Valor a transferir em reais" }
        },
        required: ["conta_origem_id", "conta_destino_id", "valor"]
      }
    }
  }
];

function formatarTelefone(tel: string): string {
  const nums = tel.replace(/\D/g, '');
  if (nums.length === 11) return `(${nums.slice(0,2)}) ${nums.slice(2,7)}-${nums.slice(7)}`;
  if (nums.length === 10) return `(${nums.slice(0,2)}) ${nums.slice(2,6)}-${nums.slice(6)}`;
  return tel;
}

function idValido(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function dataValida(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value);
}

function parseData(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const hoje = new Date();
  if (v === 'hoje') return hoje.toISOString().split('T')[0];
  if (v === 'amanhã' || v === 'amanha') {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  if (v === 'ontem') {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  const dm = v.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dm) {
    const dia = parseInt(dm[1], 10);
    const mes = parseInt(dm[2], 10);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      const d = new Date(hoje.getFullYear(), mes - 1, dia);
      return d.toISOString().split('T')[0];
    }
  }
  const dmy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const dia = parseInt(dmy[1], 10);
    const mes = parseInt(dmy[2], 10);
    const ano = parseInt(dmy[3], 10);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100) {
      const d = new Date(ano, mes - 1, dia);
      return d.toISOString().split('T')[0];
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

function textoValido(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function numeroValido(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function pago(status: string): boolean {
  return status === 'pago' || status === 'recebido';
}

function calcDeltaVenda(valor: number, status: string, acao: string, valorAntigo?: number, statusAntigo?: number): number {
  const v = Number(valor) || 0;
  const va = Number(valorAntigo) || 0;
  if (acao === 'criar') return pago(status) ? v : 0;
  if (acao === 'excluir') return pago(status) ? -v : 0;
  if (acao === 'editar') {
    const eraPago = pago(statusAntigo || '');
    const agoraPago = pago(status);
    if (!eraPago && agoraPago) return v;
    if (eraPago && !agoraPago) return -va;
    if (eraPago && agoraPago) return v - va;
    return 0;
  }
  return 0;
}

async function atualizarSaldoConta(supabaseAdmin: any, contaId: string, delta: number) {
  if (!contaId || !delta) return;
  const { data: conta } = await supabaseAdmin.from('contas').select('saldo_atual').eq('id', contaId).single();
  if (!conta) return;
  await supabaseAdmin.from('contas').update({
    saldo_atual: Number(conta.saldo_atual || 0) + delta,
    updated_at: new Date().toISOString()
  }).eq('id', contaId);
}

async function executeTool(name: string, args: Record<string, unknown>, supabaseAdmin: any, userId: string) {
  const hoje = new Date();
  const thirtyDaysAgo = new Date(hoje.getTime() - 30 * 86400000);
  const defaultStart = thirtyDaysAgo.toISOString().split('T')[0];
  const defaultEnd = hoje.toISOString().split('T')[0];

  switch (name) {
    case "buscar_vendas": {
      let q = supabaseAdmin.from('vendas').select('*, clientes(nome)').eq('user_id', userId);
      if (args.data_inicio) {
        const di = parseData(args.data_inicio);
        if (di) q = q.gte('data_venda', di);
      }
      if (args.data_fim) {
        const df = parseData(args.data_fim);
        if (df) q = q.lte('data_venda', df + 'T23:59:59');
      }
      if (args.status) q = q.eq('status', args.status);
      if (args.cliente_id) q = q.eq('cliente_id', args.cliente_id);
      q = q.order('data_venda', { ascending: false });
      const { data } = await q;
      return data || [];
    }
    case "buscar_gastos": {
      let q = supabaseAdmin.from('despesas').select('*').eq('user_id', userId);
      if (args.data_inicio) {
        const di = parseData(args.data_inicio);
        if (di) q = q.gte('data', di);
      }
      if (args.data_fim) {
        const df = parseData(args.data_fim);
        if (df) q = q.lte('data', df);
      }
      if (args.categoria) q = q.ilike('categoria', `%${args.categoria}%`);
      q = q.order('data', { ascending: false });
      const { data } = await q;
      return data || [];
    }
    case "buscar_clientes": {
      let q = supabaseAdmin.from('clientes').select('*').eq('user_id', userId).eq('ativo', true);
      if (args.busca) q = q.or(`nome.ilike.%${args.busca}%,telefone.ilike.%${args.busca}%`);
      q = q.order('nome');
      const { data } = await q;
      return data || [];
    }
    case "buscar_produtos": {
      let q = supabaseAdmin.from('produtos').select('id, nome, descricao, valor').eq('user_id', userId);
      if (args.busca) q = q.ilike('nome', `%${args.busca}%`);
      q = q.order('nome');
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data || [];
    }
    case "criar_produto": {
      if (!textoValido(args.nome) || !textoValido(args.descricao) || !numeroValido(args.valor)) {
        return { error: 'Produto exige nome, descrição e valor.' };
      }
      if (Number(args.valor) <= 0) return { error: 'O valor do produto deve ser maior que zero.' };

      const dup = await supabaseAdmin.from('produtos')
        .select('id, nome').eq('user_id', userId)
        .ilike('nome', String(args.nome).trim())
        .limit(1);
      if (dup.error) throw dup.error;
      if (dup.data?.length) {
        return { error: `Já existe um produto com nome similar: "${dup.data[0].nome}". Use editar se quiser alterar.` };
      }

      const { data, error } = await supabaseAdmin.from('produtos').insert({
        user_id: userId,
        nome: args.nome,
        descricao: args.descricao,
        valor: args.valor
      }).select().single();
      if (error) return { error: error.message };
      return data;
    }
    case "editar_produto": {
      const { produto_id, ...updates } = args;
      if (!idValido(produto_id)) return { error: 'O ID do produto é obrigatório e inválido.' };
      const { data: produtoAtual, error: findError } = await supabaseAdmin.from('produtos')
        .select('id, nome, descricao, valor').eq('id', produto_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!produtoAtual) return { error: 'Produto não encontrado ou sem permissão para alterar.' };

      const allowed = ['nome', 'descricao', 'valor'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
      if (!Object.keys(patch).length) return { error: 'Informe pelo menos um campo do produto para alterar.' };
      if (patch.nome !== undefined && !textoValido(patch.nome)) return { error: 'O nome não pode ficar vazio.' };
      if (patch.descricao !== undefined && !textoValido(patch.descricao)) return { error: 'A descrição não pode ficar vazia.' };
      if (patch.valor !== undefined && Number(patch.valor) <= 0) return { error: 'O valor do produto deve ser maior que zero.' };

      if (patch.nome) {
        const dup = await supabaseAdmin.from('produtos')
          .select('id, nome').eq('user_id', userId).neq('id', produto_id)
          .ilike('nome', String(patch.nome).trim()).limit(1);
        if (dup.error) throw dup.error;
        if (dup.data?.length) return { error: `Já existe outro produto com nome similar: "${dup.data[0].nome}".` };
      }

      const { data, error } = await supabaseAdmin.from('produtos')
        .update(patch).eq('id', produto_id).eq('user_id', userId).select().maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'Produto não encontrado ou sem permissão para alterar.' };
      return data;
    }
    case "excluir_produto": {
      if (!args.produto_id) return { error: 'Informe o ID do produto para excluir.' };
      if (!idValido(args.produto_id)) return { error: 'ID do produto inválido.' };
      const { data: produto, error: findError } = await supabaseAdmin.from('produtos')
        .select('id, nome').eq('id', args.produto_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!produto) return { error: 'Produto não encontrado. Busque o produto novamente e tente outra vez.' };
      const { error } = await supabaseAdmin.from('produtos')
        .delete().eq('id', produto.id).eq('user_id', userId);
      if (error) return { error: error.message };
      return { sucesso: true, mensagem: `Produto "${produto.nome}" excluído` };
    }
    case "resumo_financeiro": {
      const di = args.data_inicio ? parseData(args.data_inicio) : defaultStart;
      const df = args.data_fim ? parseData(args.data_fim) : defaultEnd;
      const [vendasRes, gastosRes] = await Promise.all([
        supabaseAdmin.from('vendas').select('valor, status, data_venda').eq('user_id', userId).gte('data_venda', di).lte('data_venda', df + 'T23:59:59'),
        supabaseAdmin.from('despesas').select('valor, data').eq('user_id', userId).gte('data', di).lte('data', df)
      ]);
      const vendas = vendasRes.data || [];
      const gastos = gastosRes.data || [];
      const vendasPagas = vendas.filter((v: any) => v.status === 'pago' || v.status === 'recebido');
      const totalVendas = vendasPagas.reduce((s: number, v: any) => s + Number(v.valor), 0);
      const totalGastos = gastos.reduce((s: number, g: any) => s + Number(g.valor), 0);
      return {
        periodo: `${di} a ${df}`,
        total_vendas: totalVendas,
        total_gastos: totalGastos,
        lucro: totalVendas - totalGastos,
        qtd_vendas: vendasPagas.length,
        qtd_gastos: gastos.length,
        ticket_medio: vendasPagas.length ? totalVendas / vendasPagas.length : 0
      };
    }
    case "criar_venda": {
      if (!textoValido(args.descricao) || !numeroValido(args.valor) || !args.data_venda) {
        return { error: 'Venda exige descrição, valor e data.' };
      }
      if (Number(args.valor) <= 0) return { error: 'O valor da venda deve ser maior que zero.' };
      const dataVenda = parseData(args.data_venda);
      if (!dataVenda) return { error: 'Data inválida. Use YYYY-MM-DD, dd/mm/aaaa, "hoje", "amanhã" ou "ontem".' };
      if (args.status && !['pago', 'pendente', 'cancelado', 'recebido'].includes(String(args.status))) {
        return { error: 'Status de venda inválido.' };
      }

      let clienteId = null;
      if (args.cliente_id) {
        if (!idValido(args.cliente_id)) return { error: 'O ID do cliente é inválido.' };
        const { data: cliente, error: clienteError } = await supabaseAdmin.from('clientes')
          .select('id').eq('id', args.cliente_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
        if (clienteError) throw clienteError;
        if (!cliente) return { error: 'Cliente não encontrado ou inativo. Busque o cliente antes de vincular a venda.' };
        clienteId = cliente.id;
      }

      let produtoId = null;
      if (args.produto_id) {
        if (!idValido(args.produto_id)) return { error: 'O ID do produto é inválido.' };
        const { data: produto, error: produtoError } = await supabaseAdmin.from('produtos')
          .select('id').eq('id', args.produto_id).eq('user_id', userId).maybeSingle();
        if (produtoError) throw produtoError;
        if (!produto) return { error: 'Produto não encontrado. Busque o produto antes de vincular à venda.' };
        produtoId = produto.id;
      }

      let contaId = null;
      if (args.conta_id) {
        if (!idValido(args.conta_id)) return { error: 'O ID da conta é inválido.' };
        const { data: conta, error: contaError } = await supabaseAdmin.from('contas')
          .select('id').eq('id', args.conta_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
        if (contaError) throw contaError;
        if (!conta) return { error: 'Conta não encontrada ou inativa. Busque a conta antes de vincular.' };
        contaId = conta.id;
      }

      const dup = await supabaseAdmin.from('vendas')
        .select('id, descricao, valor, data_venda, status')
        .eq('user_id', userId)
        .ilike('descricao', `%${args.descricao}%`)
        .eq('valor', args.valor)
        .gte('data_venda', dataVenda)
        .lte('data_venda', dataVenda + 'T23:59:59')
        .limit(1);
      if (dup.error) return { error: dup.error.message };
      if (dup.data?.length) {
        const d = dup.data[0];
        return { error: `Já existe venda similar: "${d.descricao}" R$ ${Number(d.valor).toFixed(2)} em ${d.data_venda.slice(0,10)} (${d.status}).` };
      }

      const { data, error } = await supabaseAdmin.from('vendas').insert({
        user_id: userId, descricao: args.descricao, valor: args.valor,
        status: args.status || 'pago', data_venda: dataVenda,
        cliente_id: clienteId, produto_id: produtoId, conta_id: contaId
      }).select().single();
      if (error) return { error: error.message };

      if (contaId) {
        const delta = calcDeltaVenda(Number(args.valor), args.status || 'pago', 'criar');
        if (delta !== 0) await atualizarSaldoConta(supabaseAdmin, contaId, delta);
      }

      return data;
    }
    case "criar_devedor": {
      if (!textoValido(args.cliente_nome) || !textoValido(args.descricao) || !numeroValido(args.valor)) {
        return { error: 'Devedor exige nome do cliente, produto/descrição e valor.' };
      }
      if (Number(args.valor) <= 0) return { error: 'O valor devido deve ser maior que zero.' };
      const dataVenda = args.data_venda ? parseData(args.data_venda) : new Date().toISOString().split('T')[0];
      if (args.data_venda && !dataVenda) return { error: 'Data inválida. Use YYYY-MM-DD, dd/mm/aaaa, "hoje", "amanhã" ou "ontem".' };

      const { data: clientes, error: clienteError } = await supabaseAdmin.from('clientes')
        .select('id, nome, telefone')
        .eq('user_id', userId)
        .eq('ativo', true)
        .ilike('nome', String(args.cliente_nome).trim())
        .limit(5);
      if (clienteError) throw clienteError;
      if (!clientes?.length) return { error: `Cliente "${args.cliente_nome}" não encontrado. Cadastre o cliente antes.` };
      if (clientes.length > 1) {
        const nomes = clientes.map(c => `${c.nome} (${c.telefone})`).join(', ');
        return { error: `Encontrei vários clientes com nome similar: ${nomes}. Informe o telefone exato ou ID.` };
      }

      const cliente = clientes[0];
      const dataInicio = String(dataVenda).slice(0, 10);
      const dataFim = dataInicio + 'T23:59:59';

      const { data: duplicatas, error: duplicateError } = await supabaseAdmin.from('vendas')
        .select('id, descricao, valor, data_venda')
        .eq('user_id', userId)
        .eq('cliente_id', cliente.id)
        .eq('status', 'pendente')
        .eq('valor', args.valor)
        .gte('data_venda', dataInicio)
        .lte('data_venda', dataFim)
        .limit(1);
      if (duplicateError) throw duplicateError;
      if (duplicatas?.length) return { error: `Já existe uma dívida de R$ ${Number(args.valor).toFixed(2)} para ${cliente.nome} nessa data.` };

      const { data, error } = await supabaseAdmin.from('vendas').insert({
        user_id: userId,
        cliente_id: cliente.id,
        descricao: args.descricao,
        valor: args.valor,
        status: 'pendente',
        data_venda: dataVenda
      }).select('id, cliente_id, descricao, valor, status, data_venda, clientes(nome)').single();
      if (error) throw error;
      return data;
    }
    case "criar_gasto": {
      if (!textoValido(args.descricao) || !numeroValido(args.valor) || !args.data || !textoValido(args.categoria)) {
        return { error: 'Gasto exige descrição, valor, data e categoria.' };
      }
      if (Number(args.valor) <= 0) return { error: 'O valor do gasto deve ser maior que zero.' };
      const dataGasto = parseData(args.data);
      if (!dataGasto) return { error: 'Data inválida. Use YYYY-MM-DD, dd/mm/aaaa, "hoje", "amanhã" ou "ontem".' };

      let contaId = null;
      if (args.conta_id) {
        if (!idValido(args.conta_id)) return { error: 'O ID da conta é inválido.' };
        const { data: conta, error: contaError } = await supabaseAdmin.from('contas')
          .select('id').eq('id', args.conta_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
        if (contaError) throw contaError;
        if (!conta) return { error: 'Conta não encontrada ou inativa. Busque a conta antes de vincular.' };
        contaId = conta.id;
      }

      const { data, error } = await supabaseAdmin.from('despesas').insert({
        user_id: userId, descricao: args.descricao, valor: args.valor,
        categoria: args.categoria || null, data: dataGasto, conta_id: contaId
      }).select().single();
      if (error) return { error: error.message };

      if (contaId) {
        await atualizarSaldoConta(supabaseAdmin, contaId, -Number(args.valor));
      }

      return data;
    }
    case "criar_cliente": {
      if (!textoValido(args.nome) || !textoValido(args.telefone)) return { error: 'Cliente exige nome e telefone.' };
      const telLimpo = String(args.telefone).replace(/\D/g, '');
      if (telLimpo.length < 10) return { error: 'Informe um telefone válido para o cliente (mín. 10 dígitos).' };
      const tel = formatarTelefone(args.telefone as string);

      const dup = await supabaseAdmin.from('clientes')
        .select('id, nome, telefone')
        .eq('user_id', userId)
        .eq('telefone', tel)
        .limit(1);
      if (dup.error) throw dup.error;
      if (dup.data?.length) {
        const c = dup.data[0];
        return { error: `Já existe cliente com esse telefone: "${c.nome}" (${c.telefone}).` };
      }

      const dupNome = await supabaseAdmin.from('clientes')
        .select('id, nome, telefone')
        .eq('user_id', userId)
        .ilike('nome', String(args.nome).trim())
        .eq('ativo', true)
        .limit(1);
      if (dupNome.error) return { error: dupNome.error.message };
      if (dupNome.data?.length) {
        const c = dupNome.data[0];
        return { error: `Já existe cliente ativo com nome similar: "${c.nome}" (${c.telefone}).` };
      }

      const { data, error } = await supabaseAdmin.from('clientes').insert({
        user_id: userId, nome: args.nome, telefone: tel,
        observacao: args.observacao || null
      }).select().single();
      if (error) return { error: error.message };
      return data;
    }
    case "top_gastos": {
      const di = args.data_inicio ? parseData(args.data_inicio) : defaultStart;
      const df = args.data_fim ? parseData(args.data_fim) : defaultEnd;
      const limite = Math.min(50, Math.max(1, Number(args.limite) || 5));
      const { data } = await supabaseAdmin.from('despesas')
        .select('descricao, valor, categoria, data').eq('user_id', userId)
        .gte('data', di).lte('data', df).order('valor', { ascending: false }).limit(limite);
      return data || [];
    }
    case "vendas_por_cliente": {
      const di = args.data_inicio ? parseData(args.data_inicio) : defaultStart;
      const df = args.data_fim ? parseData(args.data_fim) : defaultEnd;
      const { data } = await supabaseAdmin.from('vendas')
        .select('cliente_id, valor, clientes(nome)').eq('user_id', userId).eq('status', 'pago')
        .gte('data_venda', di).lte('data_venda', df + 'T23:59:59');
      const grouped: Record<string, { nome: string, total: number, qtd: number }> = {};
      for (const v of data || []) {
        const nome = (v as any).clientes?.nome || 'Sem cliente';
        if (!grouped[nome]) grouped[nome] = { nome, total: 0, qtd: 0 };
        grouped[nome].total += Number(v.valor);
        grouped[nome].qtd++;
      }
      return Object.values(grouped).sort((a, b) => b.total - a.total);
    }
    case "verificar_duplicata": {
      const tipo = args.tipo as string;
      const descricao = args.descricao as string;
      const results: any[] = [];

      if (tipo === 'venda') {
        let q = supabaseAdmin.from('vendas')
          .select('id, descricao, valor, data_venda, status')
          .eq('user_id', userId)
          .ilike('descricao', `%${descricao}%`);
        if (args.valor !== undefined) q = q.eq('valor', args.valor);
        if (args.data) {
          const parsedData = parseData(args.data);
          if (parsedData) q = q.gte('data_venda', parsedData).lte('data_venda', parsedData + 'T23:59:59');
        }
        const { data, error } = await q.limit(5);
        if (error) throw error;
        if (data) results.push(...data.map((v: any) => ({ tipo: 'venda', ...v })));
      } else if (tipo === 'gasto') {
        let q = supabaseAdmin.from('despesas')
          .select('id, descricao, valor, data, categoria')
          .eq('user_id', userId)
          .ilike('descricao', `%${descricao}%`);
        if (args.valor !== undefined) q = q.eq('valor', args.valor);
        if (args.data) {
          const parsedData = parseData(args.data);
          if (parsedData) q = q.eq('data', parsedData);
        }
        const { data, error } = await q.limit(5);
        if (error) throw error;
        if (data) results.push(...data.map((g: any) => ({ tipo: 'gasto', ...g })));
      } else if (tipo === 'cliente') {
        let q = supabaseAdmin.from('clientes')
          .select('id, nome, telefone')
          .eq('user_id', userId)
          .eq('ativo', true)
          .ilike('nome', `%${descricao}%`);
        if (args.telefone) q = q.eq('telefone', formatarTelefone(String(args.telefone)));
        const { data, error } = await q.limit(5);
        if (error) throw error;
        if (data) results.push(...data.map((c: any) => ({ tipo: 'cliente', ...c })));
      }

      return { encontrados: results.length, registros: results };
    }
    case "resumo_por_categoria": {
      const di = args.data_inicio ? parseData(args.data_inicio) : defaultStart;
      const df = args.data_fim ? parseData(args.data_fim) : defaultEnd;
      const { data } = await supabaseAdmin.from('despesas')
        .select('categoria, valor')
        .eq('user_id', userId)
        .gte('data', di).lte('data', df);
      const grouped: Record<string, number> = {};
      for (const g of data || []) {
        const cat = (g as any).categoria || 'Sem categoria';
        grouped[cat] = (grouped[cat] || 0) + Number((g as any).valor);
      }
      return Object.entries(grouped)
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total);
    }
    case "editar_cliente": {
      const { cliente_id, ...updates } = args;
      if (!idValido(cliente_id)) return { error: 'O ID do cliente é obrigatório e inválido.' };
      const { data: clienteExistente, error: findError } = await supabaseAdmin.from('clientes')
        .select('id').eq('id', cliente_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
      if (findError) throw findError;
      if (!clienteExistente) return { error: 'Cliente não encontrado ou inativo.' };
      const allowed = ['nome', 'telefone', 'observacao'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
      if (!Object.keys(patch).length) return { error: 'Informe pelo menos um campo do cliente para alterar.' };
      if (patch.nome !== undefined && !textoValido(patch.nome)) return { error: 'O nome não pode ficar vazio.' };
      if (patch.observacao !== undefined && typeof patch.observacao !== 'string') return { error: 'A observação deve ser um texto.' };
      if (patch.telefone) patch.telefone = formatarTelefone(patch.telefone as string);
      if (patch.telefone && String(patch.telefone).replace(/\D/g, '').length < 10) return { error: 'Informe um telefone válido.' };
      const { data, error } = await supabaseAdmin.from('clientes')
        .update(patch).eq('id', cliente_id).eq('user_id', userId).select().maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'Cliente não encontrado ou sem permissão para alterar.' };
      return data;
    }
    case "editar_venda": {
      const { venda_id, ...updates } = args;
      if (!idValido(venda_id)) return { error: 'O ID da venda é obrigatório e inválido.' };
      const { data: vendaAtual, error: findError } = await supabaseAdmin.from('vendas')
        .select('id, descricao, valor, data_venda, cliente_id').eq('id', venda_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!vendaAtual) return { error: 'Venda não encontrada ou sem permissão para alterar.' };

      const allowed = ['descricao', 'valor', 'status', 'data_venda'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
      if (!Object.keys(patch).length) return { error: 'Informe pelo menos um campo da venda para alterar.' };
      if (patch.descricao !== undefined && !textoValido(patch.descricao)) return { error: 'A descrição não pode ficar vazia.' };
      if (patch.valor !== undefined && Number(patch.valor) <= 0) return { error: 'O valor da venda deve ser maior que zero.' };
      if (patch.data_venda !== undefined) {
        const parsed = parseData(patch.data_venda);
        if (!parsed) return { error: 'Data inválida. Use YYYY-MM-DD, dd/mm/aaaa, "hoje", "amanhã" ou "ontem".' };
        patch.data_venda = parsed;
      }
      if (patch.status !== undefined && !['pago', 'pendente', 'cancelado', 'recebido'].includes(String(patch.status))) return { error: 'Status de venda inválido.' };

      const desc = patch.descricao ?? vendaAtual.descricao;
      const val = patch.valor ?? vendaAtual.valor;
      const dt = patch.data_venda ?? vendaAtual.data_venda.slice(0,10);
      const dup = await supabaseAdmin.from('vendas')
        .select('id').eq('user_id', userId).neq('id', venda_id)
        .ilike('descricao', `%${desc}%`).eq('valor', val)
        .gte('data_venda', dt).lte('data_venda', dt + 'T23:59:59')
        .limit(1);
      if (dup.error) throw dup.error;
      if (dup.data?.length) return { error: 'Já existe outra venda com mesma descrição, valor e data.' };

      if (patch.cliente_id) {
        if (!idValido(patch.cliente_id)) return { error: 'O ID do cliente é inválido.' };
        const { data: cli } = await supabaseAdmin.from('clientes')
          .select('id').eq('id', patch.cliente_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
        if (!cli) return { error: 'Cliente não encontrado ou inativo.' };
      }

      const { data, error } = await supabaseAdmin.from('vendas')
        .update(patch).eq('id', venda_id).eq('user_id', userId).select().maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'Venda não encontrada ou sem permissão para alterar.' };

      const novaStatus = String(patch.status || vendaAtual.status);
      const novoValor = Number(patch.valor || vendaAtual.valor);
      const novaConta = patch.conta_id !== undefined ? patch.conta_id : null;
      const oldStatus = vendaAtual.status;
      const oldValor = Number(vendaAtual.valor);

      if (novaConta || vendaAtual.conta_id) {
        const delta = calcDeltaVenda(novoValor, novaStatus, 'editar', oldValor, oldStatus);
        if (delta !== 0) {
          const contaAlvo = novaConta || vendaAtual.conta_id;
          if (contaAlvo) await atualizarSaldoConta(supabaseAdmin, contaAlvo, delta);
        }
      }

      return data;
    }
    case "editar_gasto": {
      const { gasto_id, ...updates } = args;
      if (!idValido(gasto_id)) return { error: 'O ID do gasto é obrigatório e inválido.' };
      const { data: gastoAtual, error: findError } = await supabaseAdmin.from('despesas')
        .select('id, descricao, valor, data, categoria').eq('id', gasto_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!gastoAtual) return { error: 'Gasto não encontrado ou sem permissão para alterar.' };

      const allowed = ['descricao', 'valor', 'categoria', 'data'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
      if (!Object.keys(patch).length) return { error: 'Informe pelo menos um campo do gasto para alterar.' };
      if (patch.descricao !== undefined && !textoValido(patch.descricao)) return { error: 'A descrição não pode ficar vazia.' };
      if (patch.categoria !== undefined && typeof patch.categoria !== 'string') return { error: 'A categoria deve ser um texto.' };
      if (patch.valor !== undefined && Number(patch.valor) <= 0) return { error: 'O valor do gasto deve ser maior que zero.' };
      if (patch.data !== undefined) {
        const parsed = parseData(patch.data);
        if (!parsed) return { error: 'Data inválida. Use YYYY-MM-DD, dd/mm/aaaa, "hoje", "amanhã" ou "ontem".' };
        patch.data = parsed;
      }

      const desc = patch.descricao ?? gastoAtual.descricao;
      const val = patch.valor ?? gastoAtual.valor;
      const dt = patch.data ?? gastoAtual.data;
      const dup = await supabaseAdmin.from('despesas')
        .select('id').eq('user_id', userId).neq('id', gasto_id)
        .ilike('descricao', `%${desc}%`).eq('valor', val).eq('data', dt)
        .limit(1);
      if (dup.error) throw dup.error;
      if (dup.data?.length) return { error: 'Já existe outro gasto com mesma descrição, valor e data.' };

      const { data, error } = await supabaseAdmin.from('despesas')
        .update(patch).eq('id', gasto_id).eq('user_id', userId).select().maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'Gasto não encontrado ou sem permissão para alterar.' };

      const novoValor = Number(patch.valor || gastoAtual.valor);
      const novaConta = patch.conta_id !== undefined ? patch.conta_id : null;
      const valorAntigo = Number(gastoAtual.valor);
      const contaAntiga = gastoAtual.conta_id;

      if (contaAntiga || novaConta) {
        if (contaAntiga && contaAntiga !== novaConta) {
          await atualizarSaldoConta(supabaseAdmin, contaAntiga, valorAntigo);
          if (novaConta) await atualizarSaldoConta(supabaseAdmin, novaConta, -novoValor);
        } else if (contaAntiga && contaAntiga === novaConta) {
          await atualizarSaldoConta(supabaseAdmin, novaConta, valorAntigo - novoValor);
        }
      }

      return data;
    }
    case "excluir_cliente": {
      if (!args.cliente_id && !args.nome && !args.telefone) {
        return { error: 'Informe o ID, nome ou telefone do cliente para excluir.' };
      }

      let clienteQuery = supabaseAdmin.from('clientes').select('id, nome, telefone').eq('user_id', userId).eq('ativo', true);
      if (args.cliente_id) clienteQuery = clienteQuery.eq('id', args.cliente_id);
      else if (args.telefone) clienteQuery = clienteQuery.eq('telefone', formatarTelefone(String(args.telefone)));
      else clienteQuery = clienteQuery.ilike('nome', String(args.nome).trim());

      const { data: clientes, error: findError } = await clienteQuery.limit(2);
      if (findError) throw findError;
      if (!clientes?.length) return { error: 'Cliente não encontrado. Busque o cliente novamente e tente outra vez.' };
      if (clientes.length > 1) return { error: 'Encontrei mais de um cliente com esses dados. Informe o telefone ou ID correto.' };

      const cliente = clientes[0];
      const { error } = await supabaseAdmin.from('clientes')
        .delete().eq('id', cliente.id).eq('user_id', userId);
      if (error) return { error: error.message };
      return { sucesso: true, mensagem: `Cliente "${cliente.nome}" excluído` };
    }
    case "excluir_venda": {
      if (!args.venda_id) return { error: 'Informe o ID da venda para excluir.' };
      const { data: venda, error: findError } = await supabaseAdmin.from('vendas')
        .select('id, descricao, valor, status, conta_id').eq('id', args.venda_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!venda) return { error: 'Venda não encontrada. Busque a venda novamente e tente outra vez.' };

      const { error } = await supabaseAdmin.from('vendas')
        .delete().eq('id', venda.id).eq('user_id', userId);
      if (error) throw error;

      if (venda.conta_id) {
        const delta = calcDeltaVenda(Number(venda.valor), venda.status, 'excluir');
        if (delta !== 0) await atualizarSaldoConta(supabaseAdmin, venda.conta_id, delta);
      }

      return { sucesso: true, mensagem: `Venda "${venda.descricao}" excluída` };
    }
    case "excluir_gasto": {
      if (!args.gasto_id) return { error: 'Informe o ID do gasto para excluir.' };
      const { data: gasto, error: findError } = await supabaseAdmin.from('despesas')
        .select('id, descricao, valor, conta_id').eq('id', args.gasto_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!gasto) return { error: 'Gasto não encontrado. Busque o gasto novamente e tente outra vez.' };

      const { error } = await supabaseAdmin.from('despesas')
        .delete().eq('id', gasto.id).eq('user_id', userId);
      if (error) throw error;

      if (gasto.conta_id) {
        await atualizarSaldoConta(supabaseAdmin, gasto.conta_id, Number(gasto.valor || 0));
      }

      return { sucesso: true, mensagem: `Gasto "${gasto.descricao}" excluído` };
    }
    case "buscar_contas": {
      let q = supabaseAdmin.from('contas').select('*').eq('user_id', userId).eq('ativo', true);
      if (args.busca) q = q.ilike('nome', `%${args.busca}%`);
      if (args.tipo) q = q.eq('tipo', args.tipo);
      if (args.finalidade) q = q.eq('finalidade', args.finalidade);
      q = q.order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data || [];
    }
    case "criar_conta": {
      if (!textoValido(args.nome)) return { error: 'Conta exige um nome.' };
      const tipo = args.tipo || 'banco_pj';
      const finalidade = args.finalidade || 'negocio';
      const saldoInicial = Number(args.saldo_inicial) || 0;

      const { data, error } = await supabaseAdmin.from('contas').insert({
        user_id: userId,
        nome: args.nome,
        instituicao: args.instituicao || null,
        tipo: tipo,
        finalidade: finalidade,
        saldo_inicial: saldoInicial,
        saldo_atual: saldoInicial
      }).select().single();
      if (error) return { error: error.message };
      return data;
    }
    case "editar_conta": {
      const { conta_id, ...updates } = args;
      if (!idValido(conta_id)) return { error: 'O ID da conta é obrigatório e inválido.' };
      const { data: contaAtual, error: findError } = await supabaseAdmin.from('contas')
        .select('id, nome, instituicao, tipo, finalidade, saldo_inicial, saldo_atual')
        .eq('id', conta_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
      if (findError) throw findError;
      if (!contaAtual) return { error: 'Conta não encontrada ou inativa.' };

      const allowed = ['nome', 'instituicao', 'tipo', 'finalidade'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) patch[k] = updates[k];
      if (!Object.keys(patch).length) return { error: 'Informe pelo menos um campo para alterar.' };
      if (patch.nome !== undefined && !textoValido(patch.nome)) return { error: 'O nome não pode ficar vazio.' };

      const { data, error } = await supabaseAdmin.from('contas')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', conta_id).eq('user_id', userId).select().maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'Conta não encontrada ou sem permissão.' };
      return data;
    }
    case "excluir_conta": {
      if (!args.conta_id) return { error: 'Informe o ID da conta.' };
      const { data: conta, error: findError } = await supabaseAdmin.from('contas')
        .select('id, nome').eq('id', args.conta_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!conta) return { error: 'Conta não encontrada.' };

      if (args.permanente) {
        const [resVendas, resDespesas] = await Promise.all([
          supabaseAdmin.from('vendas').select('id', { count: 'exact', head: true }).eq('conta_id', conta.id),
          supabaseAdmin.from('despesas').select('id', { count: 'exact', head: true }).eq('conta_id', conta.id)
        ]);
        const totalVinculadas = (resVendas.count || 0) + (resDespesas.count || 0);
        if (totalVinculadas > 0) {
          const { error } = await supabaseAdmin.from('contas').delete().eq('id', conta.id).eq('user_id', userId);
          if (error) return { error: error.message };
          return { sucesso: true, mensagem: `Conta "${conta.nome}" excluída. ${totalVinculadas} movimentação(ões) ficaram sem vínculo.` };
        }
        const { error } = await supabaseAdmin.from('contas').delete().eq('id', conta.id).eq('user_id', userId);
        if (error) return { error: error.message };
        return { sucesso: true, mensagem: `Conta "${conta.nome}" excluída permanentemente.` };
      }

      const { error } = await supabaseAdmin.from('contas')
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq('id', conta.id).eq('user_id', userId);
      if (error) return { error: error.message };
      return { sucesso: true, mensagem: `Conta "${conta.nome}" inativada. O histórico foi mantido.` };
    }
    case "saldo_por_conta": {
      if (args.consolidado) {
        const { data: contas, error } = await supabaseAdmin.from('contas')
          .select('saldo_atual, finalidade, nome')
          .eq('user_id', userId).eq('ativo', true);
        if (error) return { error: error.message };
        const contasNegocio = (contas || []).filter((c: any) => c.finalidade === 'negocio' || c.finalidade === 'misto');
        const total = contasNegocio.reduce((s: number, c: any) => s + Number(c.saldo_atual || 0), 0);
        return {
          saldo_consolidado: total,
          contas: contasNegocio.map((c: any) => ({ nome: c.nome, saldo: Number(c.saldo_atual) })),
          mensagem: `Saldo consolidado (Negócio/Misto): R$ ${total.toFixed(2)}`
        };
      }
      if (args.conta_id) {
        if (!idValido(args.conta_id)) return { error: 'ID da conta inválido.' };
        const { data: conta, error } = await supabaseAdmin.from('contas')
          .select('id, nome, saldo_atual, saldo_inicial, tipo, finalidade')
          .eq('id', args.conta_id).eq('user_id', userId).eq('ativo', true).maybeSingle();
        if (error) throw error;
        if (!conta) return { error: 'Conta não encontrada.' };
        return {
          nome: conta.nome,
          saldo: Number(conta.saldo_atual),
          saldo_inicial: Number(conta.saldo_inicial),
          tipo: conta.tipo,
          finalidade: conta.finalidade,
          mensagem: `Saldo da conta "${conta.nome}": R$ ${Number(conta.saldo_atual).toFixed(2)}`
        };
      }
      const { data: todas, error } = await supabaseAdmin.from('contas')
        .select('id, nome, saldo_atual, tipo, finalidade')
        .eq('user_id', userId).eq('ativo', true);
      if (error) return { error: error.message };
      const total = (todas || []).reduce((s: number, c: any) => s + Number(c.saldo_atual || 0), 0);
      return {
        total_geral: total,
        contas: (todas || []).map((c: any) => ({ id: c.id, nome: c.nome, saldo: Number(c.saldo_atual), tipo: c.tipo, finalidade: c.finalidade }))
      };
    }
    case "transferir_entre_contas": {
      if (!idValido(args.conta_origem_id) || !idValido(args.conta_destino_id)) {
        return { error: 'IDs de conta inválidos.' };
      }
      if (args.conta_origem_id === args.conta_destino_id) {
        return { error: 'A conta de origem e destino não podem ser a mesma.' };
      }
      if (!numeroValido(args.valor) || Number(args.valor) <= 0) {
        return { error: 'O valor da transferência deve ser maior que zero.' };
      }
      const valor = Number(args.valor);

      const [origemRes, destinoRes] = await Promise.all([
        supabaseAdmin.from('contas').select('id, nome, saldo_atual').eq('id', args.conta_origem_id).eq('user_id', userId).eq('ativo', true).maybeSingle(),
        supabaseAdmin.from('contas').select('id, nome').eq('id', args.conta_destino_id).eq('user_id', userId).eq('ativo', true).maybeSingle()
      ]);
      if (origemRes.error || !origemRes.data) return { error: 'Conta de origem não encontrada.' };
      if (destinoRes.error || !destinoRes.data) return { error: 'Conta de destino não encontrada.' };
      if (Number(origemRes.data.saldo_atual) < valor) {
        return { error: `Saldo insuficiente na conta "${origemRes.data.nome}". Saldo disponível: R$ ${Number(origemRes.data.saldo_atual).toFixed(2)}` };
      }

      const novoSaldoOrigem = Number(origemRes.data.saldo_atual) - valor;
      const [updateOrigem, updateDestino] = await Promise.all([
        supabaseAdmin.from('contas').update({ saldo_atual: novoSaldoOrigem, updated_at: new Date().toISOString() }).eq('id', args.conta_origem_id),
        supabaseAdmin.rpc('incrementar_saldo', { p_conta_id: args.conta_destino_id, p_valor: valor }).then(async (r: any) => {
          if (r.error) {
            const { data: dest } = await supabaseAdmin.from('contas').select('saldo_atual').eq('id', args.conta_destino_id).single();
            return supabaseAdmin.from('contas').update({ saldo_atual: Number(dest.saldo_atual) + valor, updated_at: new Date().toISOString() }).eq('id', args.conta_destino_id);
          }
          return r;
        })
      ]);

      return {
        sucesso: true,
        mensagem: `Transferência de R$ ${valor.toFixed(2)} realizada: "${origemRes.data.nome}" → "${destinoRes.data.nome}"`,
        origem: { nome: origemRes.data.nome, novo_saldo: novoSaldoOrigem },
        destino: { nome: destinoRes.data.nome }
      };
    }
    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}

// Adapter genérico: qualquer API compatível com OpenAI
async function callOpenAICompatible(provider: any, messages: any[], tools?: any[]) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.api_key) {
    headers["Authorization"] = `Bearer ${provider.api_key}`;
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: provider.max_tokens || 2000,
    temperature: provider.temperature || 0.7,
  };
  if (tools) body.tools = tools;

  const res = await fetch(provider.api_url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider.provider_name} error ${res.status}: ${err}`);
  }

  return await res.json();
}

// Adapter Gemini nativo
async function callGemini(provider: any, messages: any[], tools?: any[]) {
  const contents = messages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: messages.find((m: any) => m.role === 'system')
      ? { parts: [{ text: messages.find((m: any) => m.role === 'system')!.content }] }
      : undefined,
    generationConfig: { temperature: provider.temperature || 0.7, maxOutputTokens: provider.max_tokens || 2000 },
  };

  if (tools) {
    body.tools = [{
      functionDeclarations: tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }))
    }];
  }

  const url = provider.api_url || `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.api_key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  const textPart = parts.find((p: any) => p.text);
  const funcParts = parts.filter((p: any) => p.functionCall);

  if (funcParts.length) {
    return {
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: funcParts.map((p: any) => ({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args),
            }
          }))
        },
        finish_reason: 'tool_calls'
      }],
      usage: { total_tokens: data.usageMetadata?.totalTokenCount || 0 }
    };
  }

  return {
    choices: [{
      message: { role: 'assistant', content: textPart?.text || '' },
      finish_reason: 'stop'
    }],
    usage: { total_tokens: data.usageMetadata?.totalTokenCount || 0 }
  };
}

async function callAI(provider: any, messages: any[], tools?: any[]) {
  if (provider.provider_type === 'gemini') {
    return await callGemini(provider, messages, tools);
  }
  // Default: OpenAI-compatible (openai, groq, openrouter, together, nvidia, cerebras, etc.)
  return await callOpenAICompatible(provider, messages, tools);
}

function gerarRespostaTools(toolResults: any[]): string {
  const responses: string[] = [];
  for (const t of toolResults) {
    const r = t.result;
    if (r?.error) { responses.push(`Erro: ${r.error}`); continue; }
    switch (t.name) {
      case 'criar_cliente':
        responses.push(`Cliente "${r.nome}" cadastrado com sucesso!${r.telefone ? ' Tel: ' + r.telefone : ''}`);
        break;
      case 'editar_cliente':
        responses.push(`Cliente "${r.nome}" atualizado.`);
        break;
      case 'excluir_cliente':
        responses.push(r.mensagem || 'Cliente excluído.');
        break;
      case 'criar_venda':
        responses.push(`Venda "${r.descricao}" cadastrada: R$ ${Number(r.valor).toFixed(2)} (${r.status || 'pago'}).`);
        break;
      case 'criar_produto':
        responses.push(`Produto "${r.nome}" cadastrado: R$ ${Number(r.valor).toFixed(2)}. Adicione a foto pelo site se quiser.`);
        break;
      case 'editar_produto':
        responses.push(`Produto "${r.nome}" atualizado.`);
        break;
      case 'excluir_produto':
        responses.push(r.mensagem || 'Produto excluído.');
        break;
      case 'buscar_produtos':
        if (Array.isArray(r) && r.length > 0) {
          responses.push(`Encontrei ${r.length} produto(s): ${r.map((p: any) => `"${p.nome}" (R$ ${Number(p.valor).toFixed(2)})`).join(', ')}.`);
        }
        break;
      case 'criar_devedor':
        responses.push(`Devedor "${r.clientes?.nome || 'cliente'}" cadastrado: R$ ${Number(r.valor).toFixed(2)}.`);
        break;
      case 'editar_venda':
        responses.push(`Venda "${r.descricao}" atualizada.`);
        break;
      case 'excluir_venda':
        responses.push(r.mensagem || 'Venda excluída.');
        break;
      case 'criar_gasto':
        responses.push(`Gasto "${r.descricao}" cadastrado: R$ ${Number(r.valor).toFixed(2)}.`);
        break;
      case 'editar_gasto':
        responses.push(`Gasto "${r.descricao}" atualizado.`);
        break;
      case 'excluir_gasto':
        responses.push(r.mensagem || 'Gasto excluído.');
        break;
      case 'criar_conta':
        responses.push(`Conta "${r.nome}" cadastrada com sucesso!${r.saldo_atual ? ' Saldo: R$ ' + Number(r.saldo_atual).toFixed(2) : ''}`);
        break;
      case 'editar_conta':
        responses.push(`Conta "${r.nome}" atualizada.`);
        break;
      case 'excluir_conta':
        responses.push(r.mensagem || 'Conta inativada.');
        break;
      case 'saldo_por_conta':
        responses.push(r.mensagem || `Saldo: R$ ${Number(r.saldo || r.saldo_consolidado || r.total_geral || 0).toFixed(2)}`);
        break;
      case 'transferir_entre_contas':
        responses.push(r.mensagem || 'Transferência realizada.');
        break;
      case 'buscar_contas':
        if (Array.isArray(r) && r.length > 0) {
          responses.push(`Encontrei ${r.length} conta(s): ${r.map((c: any) => `"${c.nome}" (R$ ${Number(c.saldo_atual).toFixed(2)})`).join(', ')}.`);
        } else if (Array.isArray(r) && r.length === 0) {
          responses.push('Nenhuma conta encontrada.');
        }
        break;
      case 'verificar_duplicata':
        if (r.encontrados > 0) responses.push(`Encontrei ${r.encontrados} registro(s) similar(es).`);
        break;
      default:
        if (r?.sucesso) responses.push(r.mensagem || 'Ação concluída.');
    }
  }
  return responses.length ? responses.join('\n') : 'Ferramenta executada sem retorno visível.';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { message, session_id } = await req.json();
    if (!message || !message.trim()) {
      return new Response(JSON.stringify({ error: 'Mensagem vazia' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Criar ou usar sessão existente
    let sessionId = session_id;
    if (!sessionId) {
      const { data: newSession } = await supabaseAdmin
        .from('ai_sessions')
        .insert({ user_id: user.id, title: 'Nova conversa' })
        .select('id')
        .single();
      sessionId = newSession?.id;
    } else {
      // Verificar se a sessão pertence ao usuário
      const { data: existingSession } = await supabaseAdmin
        .from('ai_sessions').select('id').eq('id', sessionId).eq('user_id', user.id).single();
      if (!existingSession) {
        return new Response(JSON.stringify({ error: 'Sessão não encontrada' }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }
    }

    const { data: profile } = await supabaseAdmin
      .from('perfis').select('plano, role, ai_daily_limit').eq('id', user.id).single();
    const planType = profile?.role === 'admin' ? 'admin' : (profile?.plano || 'gratuito');

    const { data: limits } = await supabaseAdmin
      .from('ai_limits').select('*').eq('plan_type', planType).eq('active', true).single();

    if (!limits) {
      return new Response(JSON.stringify({ error: 'AI não disponível para este plano' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const effectiveDailyLimit = profile?.ai_daily_limit ?? limits.daily_messages;

    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabaseAdmin
      .from('ai_usage').select('*').eq('user_id', user.id).eq('usage_date', today).single();

    const currentUsage = usage || { messages_used: 0, tokens_used: 0 };
    if (currentUsage.messages_used >= effectiveDailyLimit) {
      return new Response(JSON.stringify({
        error: `Limite diário atingido (${effectiveDailyLimit} mensagens). Tente amanhã.`,
        limitReached: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 429,
      });
    }

    const { data: historyRows } = await supabaseAdmin
      .from('ai_conversations').select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limits.max_history_messages);

    const history = (historyRows || []).map((h: any) => ({
      role: h.role, content: h.content,
    }));

    // Enriquecimento de contexto: resumo dos dados do usuário
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().split('T')[0];
    const inicioMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().split('T')[0];
    const fimMesAnt = new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString().split('T')[0];

    const [vendasMes, gastosMes, clientesRes, vendasMesAnt, gastosMesAnt, ultimasVendas, devedores, perfilRes, produtosRes, contasRes] = await Promise.all([
      supabaseAdmin.from('vendas').select('valor, status, data_venda').eq('user_id', user.id).gte('data_venda', inicioMes).lte('data_venda', fimMes + 'T23:59:59'),
      supabaseAdmin.from('despesas').select('valor, categoria, data').eq('user_id', user.id).gte('data', inicioMes).lte('data', fimMes),
      supabaseAdmin.from('clientes').select('id, nome').eq('user_id', user.id).eq('ativo', true),
      supabaseAdmin.from('vendas').select('valor, status').eq('user_id', user.id).gte('data_venda', inicioMesAnt).lte('data_venda', fimMesAnt + 'T23:59:59'),
      supabaseAdmin.from('despesas').select('valor').eq('user_id', user.id).gte('data', inicioMesAnt).lte('data', fimMesAnt),
      supabaseAdmin.from('vendas').select('descricao, valor, status, data_venda, clientes(nome)').eq('user_id', user.id).order('data_venda', { ascending: false }).limit(5),
      supabaseAdmin.from('vendas').select('descricao, valor, clientes(nome)').eq('user_id', user.id).eq('status', 'pendente').order('data_venda', { ascending: false }).limit(5),
      supabaseAdmin.from('perfis').select('nome_completo, empresa').eq('id', user.id).single(),
      supabaseAdmin.from('produtos').select('id, nome, valor').eq('user_id', user.id).order('nome'),
      supabaseAdmin.from('contas').select('id, nome, saldo_atual, tipo, finalidade, ativo').eq('user_id', user.id).eq('ativo', true),
    ]);

    const vendasPagas = (vendasMes.data || []).filter((v: any) => v.status === 'pago' || v.status === 'recebido');
    const totalVendasMes = vendasPagas.reduce((s: number, v: any) => s + Number(v.valor), 0);
    const totalGastosMes = (gastosMes.data || []).reduce((s: number, g: any) => s + Number(g.valor), 0);
    const lucroMes = totalVendasMes - totalGastosMes;

    const vendasPagasAnt = (vendasMesAnt.data || []).filter((v: any) => v.status === 'pago' || v.status === 'recebido');
    const totalVendasMesAnt = vendasPagasAnt.reduce((s: number, v: any) => s + Number(v.valor), 0);
    const totalGastosMesAnt = (gastosMesAnt.data || []).reduce((s: number, g: any) => s + Number(g.valor), 0);

    const pendentes = (vendasMes.data || []).filter((v: any) => v.status === 'pendente');
    const totalPendentes = pendentes.reduce((s: number, v: any) => s + Number(v.valor), 0);

    const contexto = `
CONTEXTO DO USUÁRIO (resumo automático):
- Nome: ${perfilRes?.data?.nome_completo || 'Não informado'} | Empresa: ${perfilRes?.data?.empresa || 'Não informado'}
- Plano: ${planType}
- Clientes cadastrados: ${clientesRes.data?.length || 0}
- Mês atual (${inicioMes} a ${fimMes}): vendas R$${totalVendasMes.toFixed(2)}, gastos R$${totalGastosMes.toFixed(2)}, lucro R$${lucroMes.toFixed(2)}
- Mês anterior: vendas R$${totalVendasMesAnt.toFixed(2)}, gastos R$${totalGastosMesAnt.toFixed(2)}, lucro R$${(totalVendasMesAnt - totalGastosMesAnt).toFixed(2)}
- A receber (pendentes): R$${totalPendentes.toFixed(2)} (${pendentes.length} vendas)
- Ticket médio: R$${vendasPagas.length ? (totalVendasMes / vendasPagas.length).toFixed(2) : '0.00'}
- Top categorias de gasto: ${Object.entries((gastosMes.data || []).reduce((acc: any, g: any) => { const c = g.categoria || 'Outros'; acc[c] = (acc[c] || 0) + Number(g.valor); return acc; }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c}: R$${Number(v).toFixed(2)}`).join(', ') || 'Nenhum'}
- Últimas vendas: ${(ultimasVendas.data || []).map((v: any) => `${v.descricao} R$${Number(v.valor).toFixed(2)} (${v.status})${v.clientes?.nome ? ' - ' + v.clientes.nome : ''}`).join('; ') || 'Nenhuma'}
- Devedores: ${(devedores.data || []).map((v: any) => `${v.clientes?.nome || 'Anônimo'}: R$${Number(v.valor).toFixed(2)} - ${v.descricao}`).join('; ') || 'Nenhum'}
- Produtos cadastrados: ${(produtosRes.data || []).map((p: any) => `${p.nome} (R$ ${Number(p.valor).toFixed(2)}, id: ${p.id})`).join('; ') || 'Nenhum'}
- Contas financeiras: ${(contasRes.data || []).map((c: any) => `${c.nome} [${c.tipo}/${c.finalidade}] R$ ${Number(c.saldo_atual).toFixed(2)}`).join('; ') || 'Nenhuma'}
- Saldo consolidado (Negócio/Misto): R$${(contasRes.data || []).filter((c: any) => c.finalidade === 'negocio' || c.finalidade === 'misto').reduce((s: number, c: any) => s + Number(c.saldo_atual || 0), 0).toFixed(2)}
Use esses dados pra dar respostas inteligentes e contextualizadas. Não repita os dados brutos, analise e aconselhe.`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + contexto },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    const { data: providers } = await supabaseAdmin
      .from('ai_providers').select('*').eq('active', true).order('priority', { ascending: true });

    if (!providers || !providers.length) {
      return new Response(JSON.stringify({ error: 'Nenhum provedor de IA configurado. Configure na aba IA Config do admin.' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      });
    }

    let lastError = null;
    let finalContent = '';
    let totalTokens = 0;
    let usedProvider = '';
    let toolResults: any[] = [];

    for (const provider of providers) {
      try {
        let currentMessages = [...messages];
        let response = await callAI(provider, currentMessages, TOOLS);
        let choice = response.choices?.[0];
        totalTokens = response.usage?.total_tokens || 0;

        let iterations = 0;
        while (choice?.message?.tool_calls?.length && iterations < 10) {
          currentMessages.push(choice.message);

          for (const toolCall of choice.message.tool_calls) {
            const fnName = toolCall.function.name;
            let fnArgs = {};
            try { fnArgs = JSON.parse(toolCall.function.arguments); } catch {}

            const result = await executeTool(fnName, fnArgs, supabaseAdmin, user.id);
            toolResults.push({ name: fnName, args: fnArgs, result });

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          }

          try {
            response = await callAI(provider, currentMessages, TOOLS);
            choice = response.choices?.[0];
            totalTokens += response.usage?.total_tokens || 0;
          } catch (innerError) {
            if (innerError.message.includes('429') || innerError.message.includes('rate_limit')) {
              choice = null;
              break;
            }
            throw innerError;
          }
          iterations++;
        }

        if (choice?.message?.content) {
          finalContent = choice.message.content;
        } else if (toolResults.length > 0) {
          finalContent = gerarRespostaTools(toolResults);
        } else {
          finalContent = 'Desculpe, não consegui processar a ação. (Falha de comunicação interna)';
        }

        if (toolResults.some((toolResult: any) => toolResult.result?.error)) {
          finalContent = gerarRespostaTools(toolResults);
        }
        usedProvider = provider.provider_name;
        lastError = null;
        break;
      } catch (e) {
        lastError = e.message;
        console.error(`Erro no provedor ${provider.provider_name}:`, e.message);
        if (e.message.includes('429') || e.message.includes('rate_limit')) {
          if (toolResults.length > 0) {
            finalContent = gerarRespostaTools(toolResults);
            lastError = null;
            usedProvider = provider.provider_name;
            break;
          }
          continue;
        }
        continue;
      }
    }

    if (lastError) {
      return new Response(JSON.stringify({ error: 'Não consegui responder agora. Tente novamente em alguns segundos.' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      });
    }

    await supabaseAdmin.from('ai_conversations').insert([
      { user_id: user.id, session_id: sessionId, role: 'user', content: message.trim(), tokens_used: 0 },
      { user_id: user.id, session_id: sessionId, role: 'assistant', content: finalContent, tokens_used: totalTokens, provider: usedProvider },
    ]);

    await supabaseAdmin.from('ai_usage').upsert({
      user_id: user.id, usage_date: today,
      messages_used: currentUsage.messages_used + 1,
      tokens_used: currentUsage.tokens_used + totalTokens,
    }, { onConflict: 'user_id,usage_date' });

    return new Response(JSON.stringify({
      content: finalContent,
      session_id: sessionId,
      usage: {
        messages_used: currentUsage.messages_used + 1,
        messages_limit: effectiveDailyLimit,
        tokens_used: totalTokens,
      },
      provider: usedProvider,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
