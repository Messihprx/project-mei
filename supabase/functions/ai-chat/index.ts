import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// ai-chat — assistente de IA e diagnóstico
//
// Arquivo único de propósito. As Edge Functions são publicadas pelo
// painel do Supabase, colando o código: um import do tipo
// "../_shared/algo.ts" apontaria para fora da pasta da função e o
// painel não teria como incluir o arquivo no pacote.
//
// Manter as tools e o diagnóstico aqui dentro também dá de graça a
// garantia que interessa: o teste de tools do painel admin roda
// exatamente o mesmo código que atende os usuários, porque é
// literalmente o mesmo arquivo — não há duas cópias para sair de
// sincronia.
//
// Rotas (todas POST, autenticadas):
//   { message, session_id, stream }  -> chat (qualquer usuário)
//   { action: 'test_provider' }      -> playground        (admin)
//   { action: 'list_models' }        -> listar modelos    (admin)
//   { action: 'test_tools' }         -> testar as tools   (admin)
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});


// ============================================================
// Tools da IA — definições e execução
// ============================================================
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
- OPCIONAL: cliente (se não informado, fica como "cliente avulso"), produto
- Status padrão: "pago" (se não informado)
- FLUXO COM PRODUTO: PRIMEIRO use buscar_produtos para verificar se o produto existe
  - 1 resultado → vincule automaticamente (use produto_id, valor e descrição do produto; mas se o usuário deu valor explícito diferente, use o valor do usuário)
  - Múltiplos resultados → mostre nomes e preços, peça para o usuário escolher
  - Nenhum resultado → crie a venda sem vínculo (sem produto_id)
  - Nunca invente um produto_id

### Cadastro de Gasto (criar_gasto)
- OBRIGATÓRIO: descrição, valor, data e categoria
- Categorias disponíveis (escolha a mais adequada): "Mercadoria" (Mercadoria/Estoque), "Aluguel" (Aluguel/Espaço), "Marketing" (Marketing/Anúncios), "Serviços" (Luz/Água/Internet), "Outros"
- Você deve deduzir a categoria automaticamente com base na descrição do usuário

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
- Há limite de clientes no plano gratuito (o número exato vem no contexto desta conversa)

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
- Há limite diário de mensagens, diferente por plano (o valor atual vem no contexto)
- Sessões de conversa persistentes

### Planos
- Gratuito: período de teste, com limites de clientes, movimentações,
  produtos e mensagens por dia
- Premium: sem limite de cadastro, exportação, relatórios BI e mais
  mensagens por dia
- Pagamento via Mercado Pago (cartão com renovação automática ou PIX avulso)
- NUNCA invente os números dos limites nem o preço: os valores válidos
  chegam na seção "Plano do usuário" do contexto. Se algum não estiver
  lá, diga para conferir na página de Planos em vez de chutar.

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
      description: "Cria uma nova venda para o usuário. Só chame quando descrição, valor e data estiverem informados. Se faltar algum, pergunte ao usuário e aguarde. Se o usuário mencionou um produto, use buscar_produtos antes para tentar vincular (produto_id). Se o produto não for encontrado, crie sem vínculo.",
      parameters: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Descrição da venda" },
          valor: { type: "number", description: "Valor da venda em reais" },
          status: { type: "string", description: "Status: pago, pendente, cancelado" },
          data_venda: { type: "string", description: "Data da venda (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" },
          cliente_id: { type: "string", description: "ID do cliente (opcional)" },
          produto_id: { type: "string", description: "ID do produto para vincular à venda (opcional). Use o retornado por buscar_produtos." }
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
      description: "Cria um novo gasto/despesa para o usuário. Só chame quando descrição, valor, data e categoria estiverem informados. Se faltar algum, pergunte ao usuário e aguarde. A IA deve selecionar a categoria automaticamente com base na descrição.",
      parameters: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Descrição do gasto" },
          valor: { type: "number", description: "Valor do gasto em reais" },
          categoria: { type: "string", enum: ["Mercaria/Estoque", "Aluguel/Espaço", "Marketing/Anúncios", "Luz/Água/internet", "Outros"], description: "Categoria do gasto obrigatoriamente dentre as listadas" },
          data: { type: "string", description: "Data do gasto (YYYY-MM-DD, dd/mm/aaaa, dd/mm, 'hoje', 'amanhã', 'ontem')" }
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

// Tools que gravam no banco. Usado em dois lugares:
//  - para checar o limite do plano ANTES de inserir
//  - para não repetir a ação se um provedor de IA falhar no meio
const TOOLS_ESCRITA = new Set([
  "criar_produto", "criar_venda", "criar_devedor", "criar_gasto", "criar_cliente",
  "editar_produto", "editar_cliente", "editar_venda", "editar_gasto",
  "excluir_produto", "excluir_cliente", "excluir_venda", "excluir_gasto",
]);

// Qual limite do plano cada cadastro consome
const ENTIDADE_POR_TOOL: Record<string, string> = {
  criar_cliente: 'cliente',
  criar_produto: 'produto',
  criar_venda: 'movimentacao',
  criar_devedor: 'movimentacao',
  criar_gasto: 'movimentacao',
};

const ROTULO_ENTIDADE: Record<string, string> = {
  cliente: 'clientes',
  produto: 'produtos',
  movimentacao: 'vendas e gastos',
};

// As triggers do banco (plano_limites.sql) já barram tudo isso — a
// service role ignora RLS mas não ignora trigger. A checagem aqui é
// para a IA responder com uma frase natural em vez de repassar o
// erro cru do Postgres.
async function checarPlanoParaTool(name: string, supabaseAdmin: any, userId: string) {
  if (!TOOLS_ESCRITA.has(name)) return null;

  const { data: ativo } = await supabaseAdmin.rpc('plano_ativo', { uid: userId });
  if (ativo === false) {
    return { error: 'O período de acesso do usuário terminou. Ele precisa assinar o Premium para cadastrar ou alterar registros.' };
  }

  const entidade = ENTIDADE_POR_TOOL[name];
  if (!entidade) return null;

  const { data: disponivel } = await supabaseAdmin.rpc('limite_disponivel', {
    uid: userId, entidade,
  });
  if (disponivel === false) {
    return { error: `O plano atual do usuário atingiu o limite de ${ROTULO_ENTIDADE[entidade]}. Para cadastrar mais, ele precisa assinar o Premium.` };
  }

  return null;
}

async function executeTool(name: string, args: Record<string, unknown>, supabaseAdmin: any, userId: string) {
  const hoje = new Date();
  const thirtyDaysAgo = new Date(hoje.getTime() - 30 * 86400000);
  const defaultStart = thirtyDaysAgo.toISOString().split('T')[0];
  const defaultEnd = hoje.toISOString().split('T')[0];

  const bloqueio = await checarPlanoParaTool(name, supabaseAdmin, userId);
  if (bloqueio) return bloqueio;

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
        cliente_id: clienteId, produto_id: produtoId
      }).select().single();
      if (error) return { error: error.message };
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

      const { data, error } = await supabaseAdmin.from('despesas').insert({
        user_id: userId, descricao: args.descricao, valor: args.valor,
        categoria: args.categoria || null, data: dataGasto
      }).select().single();
      if (error) return { error: error.message };
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
        .select('id, descricao').eq('id', args.venda_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!venda) return { error: 'Venda não encontrada. Busque a venda novamente e tente outra vez.' };
      const { error } = await supabaseAdmin.from('vendas')
        .delete().eq('id', venda.id).eq('user_id', userId);
      if (error) throw error;
      return { sucesso: true, mensagem: `Venda "${venda.descricao}" excluída` };
    }
    case "excluir_gasto": {
      if (!args.gasto_id) return { error: 'Informe o ID do gasto para excluir.' };
      const { data: gasto, error: findError } = await supabaseAdmin.from('despesas')
        .select('id, descricao').eq('id', args.gasto_id).eq('user_id', userId).maybeSingle();
      if (findError) throw findError;
      if (!gasto) return { error: 'Gasto não encontrado. Busque o gasto novamente e tente outra vez.' };
      const { error } = await supabaseAdmin.from('despesas')
        .delete().eq('id', gasto.id).eq('user_id', userId);
      if (error) throw error;
      return { sucesso: true, mensagem: `Gasto "${gasto.descricao}" excluído` };
    }
    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}

// ============================================================
// Montagem de headers
//
// Antes era fixo em "Authorization: Bearer <chave>", o que deixava
// de fora o Azure OpenAI (header api-key, sem prefixo), gateways
// que exigem X-Api-Key e o Ollama local (sem chave nenhuma).
// Agora sai da configuração do provedor.
// ============================================================
// ============================================================
// Robustez das chamadas a provedor
//
// O objetivo aqui é simples: nenhum provedor com problema pode
// impedir que o próximo seja tentado. Isso exige quatro coisas que
// faltavam — timeout, mensagem de erro utilizável, leitura segura
// do corpo, e uma nova tentativa quando a falha é claramente
// passageira.
// ============================================================

// Um provedor pendurado travava a requisição inteira até a plataforma
// matar a função — e o fallback nunca chegava a acontecer.
//
// 30s por chamada, e não mais: o loop de tools faz várias chamadas por
// provedor, e ainda há os provedores seguintes na fila. Passar disso
// arrisca estourar o tempo total da Edge Function antes de tentar todo
// mundo — o oposto do que o fallback existe para fazer.
const TEMPO_LIMITE_MS = 30000;

// Falhas que costumam passar sozinhas: vale uma segunda tentativa
// antes de desistir do provedor.
const STATUS_TRANSITORIO = new Set([408, 425, 429, 500, 502, 503, 504]);

// Orçamento de tempo da requisição inteira.
//
// O timeout por chamada não basta: o loop de tools faz até 10 chamadas
// por provedor, então um provedor lento sozinho poderia consumir 300s e
// a função seria morta pela plataforma antes de tentar os outros — o
// fallback nunca aconteceria justamente quando é mais necessário.
//
// O prazo fica no objeto do provedor (e não numa variável de módulo)
// porque o mesmo isolate atende várias requisições ao mesmo tempo: uma
// variável compartilhada faria uma conversa encurtar o prazo da outra.
const ORCAMENTO_TOTAL_MS = 100000;
const MINIMO_PARA_TENTAR_MS = 5000;
// Tempo guardado para cada provedor ainda não tentado.
const RESERVA_POR_PROVEDOR_MS = 25000;

function restanteMs(provider: any) {
  return provider?._prazo ? Math.max(0, provider._prazo - Date.now()) : TEMPO_LIMITE_MS;
}

// Qualquer coisa pode ser lançada em JS. Sem isto, um throw de string
// fazia `e.message` virar undefined e o `.includes()` seguinte
// derrubava a requisição inteira de dentro do próprio catch.
function msgErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function erroProvedor(nome: string, status: number | null, corpo: string) {
  const erro: any = new Error(
    status ? `${nome} error ${status}: ${corpo}` : `${nome}: ${corpo}`
  );
  erro.status = status;
  erro.corpo = corpo;
  erro.transitorio = status === null || STATUS_TRANSITORIO.has(status);
  return erro;
}

// Antes de gastar uma chamada: configuração incompleta dá TypeError
// críptico no fetch (ex.: fetch('') com api_url vazia).
function validarProvedor(provider: any) {
  if (!provider?.model) {
    throw erroProvedor(provider?.provider_name || 'provedor', null, 'modelo não configurado');
  }
  if (provider.provider_type !== 'gemini' && !provider.api_url) {
    throw erroProvedor(provider.provider_name, null, 'URL da API não configurada');
  }
}

async function fetchProvedor(provider: any, url: string, init: RequestInit) {
  // Nunca esperar mais do que sobra do orçamento: o tempo que resta
  // pertence também aos provedores seguintes.
  const limite = Math.min(TEMPO_LIMITE_MS, restanteMs(provider));
  if (limite < MINIMO_PARA_TENTAR_MS) {
    const esgotado = erroProvedor(provider.provider_name, null, 'tempo total da requisição esgotado');
    esgotado.transitorio = false;
    esgotado.semTempo = true;
    throw esgotado;
  }

  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), limite);

  try {
    return await fetch(url, { ...init, signal: controle.signal });
  } catch (e) {
    const msg = msgErro(e);
    const ehTimeout = msg.includes('abort') || (e as any)?.name === 'AbortError';
    const erro = erroProvedor(
      provider.provider_name,
      null,
      ehTimeout ? `não respondeu em ${Math.round(limite / 1000)}s` : `falha de conexão — ${msg}`,
    );
    // Timeout não se repete: já esperamos o tempo inteiro uma vez, e
    // insistir só atrasaria o próximo provedor. Queda de conexão, sim.
    if (ehTimeout) erro.transitorio = false;
    throw erro;
  } finally {
    clearTimeout(alarme);
  }
}

// Um proxy mal configurado devolve HTML de erro com status 200. Ler
// como texto primeiro deixa a mensagem legível em vez de um
// "Unexpected token < in JSON".
async function lerJson(provider: any, res: Response) {
  const texto = await res.text();

  if (!res.ok) {
    throw erroProvedor(provider.provider_name, res.status, texto.slice(0, 2000));
  }

  try {
    return JSON.parse(texto);
  } catch {
    throw erroProvedor(
      provider.provider_name,
      res.status,
      `resposta não é JSON — ${texto.slice(0, 400)}`,
    );
  }
}

// Uma segunda tentativa só quando a falha aparenta ser passageira.
// Não há risco de efeito colateral duplicado: se a chamada falhou,
// nenhuma tool chegou a rodar nessa rodada.
async function comRetry<T>(provider: any, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e as any)?.transitorio) throw e;
    console.warn(`[${provider.provider_name}] falha passageira, tentando de novo: ${msgErro(e)}`);
    await new Promise(r => setTimeout(r, 800));
    return await fn();
  }
}

function montarHeaders(provider: any): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (provider.api_key) {
    const nome = (provider.auth_header || 'Authorization').trim();
    const prefixo = provider.auth_prefix ?? 'Bearer ';
    headers[nome] = `${prefixo}${provider.api_key}`;
  }

  // extra_headers é jsonb; pode chegar como objeto ou como texto
  let extras = provider.extra_headers;
  if (typeof extras === 'string') {
    try { extras = JSON.parse(extras); } catch { extras = null; }
  }
  if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
    for (const [k, v] of Object.entries(extras)) {
      if (typeof v === 'string' && k.trim()) headers[k.trim()] = v;
    }
  }

  return headers;
}

// URL de listagem de modelos. Se o provedor não tiver uma explícita,
// deriva do endpoint de chat — quase todo mundo compatível com OpenAI
// troca /chat/completions por /models.
function urlDeModelos(provider: any): string | null {
  if (provider.models_url) return provider.models_url;

  if (provider.provider_type === 'gemini') {
    const chave = provider.api_key ? `?key=${provider.api_key}` : '';
    return `https://generativelanguage.googleapis.com/v1beta/models${chave}`;
  }

  if (provider.provider_type === 'anthropic') {
    return 'https://api.anthropic.com/v1/models';
  }

  if (!provider.api_url) return null;
  if (provider.api_url.includes('/chat/completions')) {
    return provider.api_url.replace('/chat/completions', '/models');
  }
  try {
    return new URL('./models', provider.api_url).href;
  } catch {
    return null;
  }
}

// Normaliza a resposta de cada formato numa lista simples de ids
function extrairModelos(provider: any, dados: any): string[] {
  if (!dados) return [];

  if (provider.provider_type === 'gemini') {
    return (dados.models || [])
      .filter((m: any) => !m.supportedGenerationMethods
        || m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  // OpenAI, Anthropic, Groq, OpenRouter, LiteLLM, Ollama: { data: [{ id }] }
  if (Array.isArray(dados.data)) {
    return dados.data.map((m: any) => m.id || m.name).filter(Boolean);
  }
  if (Array.isArray(dados.models)) {
    return dados.models.map((m: any) => m.id || m.name).filter(Boolean);
  }
  return [];
}
// ============================================================
// Adapter Anthropic (Claude)
//
// A API da Anthropic não é compatível com a da OpenAI: o system vai
// num campo separado, as tools usam input_schema, e a resposta vem
// em blocos de conteúdo com type 'tool_use' no lugar de tool_calls.
//
// Assim como o adapter do Gemini, este traduz nos dois sentidos e
// devolve no formato OpenAI — o loop de tools da ai-chat não muda.
// ============================================================
async function callAnthropic(provider: any, messages: any[], tools?: any[]) {
  const sistema = messages.find((m: any) => m.role === 'system')?.content;

  // Anthropic exige alternância e não aceita role 'tool': os
  // resultados viram blocos tool_result dentro de uma mensagem user.
  const conversa: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const bloco = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      };
      const ultima = conversa[conversa.length - 1];
      if (ultima?.role === 'user' && Array.isArray(ultima.content)) {
        ultima.content.push(bloco);
      } else {
        conversa.push({ role: 'user', content: [bloco] });
      }
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocos: any[] = [];
      if (m.content) blocos.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        let entrada = {};
        try { entrada = JSON.parse(tc.function.arguments || '{}'); } catch { entrada = {}; }
        blocos.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: entrada,
        });
      }
      conversa.push({ role: 'assistant', content: blocos });
      continue;
    }

    conversa.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: provider.max_tokens || 2000,
    temperature: provider.temperature ?? 0.7,
    messages: conversa,
  };
  if (sistema) body.system = sistema;

  if (tools?.length) {
    body.tools = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const headers = montarHeaders(provider);
  // A Anthropic usa x-api-key e exige a versão da API. O admin pode
  // sobrescrever pelos campos avançados; estes são só o padrão.
  if (!provider.auth_header || provider.auth_header === 'Authorization') {
    delete headers['Authorization'];
    if (provider.api_key) headers['x-api-key'] = provider.api_key;
  }
  if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';

  const url = provider.api_url || 'https://api.anthropic.com/v1/messages';
  const res = await fetchProvedor(provider, url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await lerJson(provider, res);
  const blocos = data.content || [];
  const texto = blocos.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const usos = blocos.filter((b: any) => b.type === 'tool_use');

  const totalTokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

  if (usos.length) {
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: texto || null,
          tool_calls: usos.map((b: any) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
          })),
        },
        finish_reason: 'tool_calls',
      }],
      usage: { total_tokens: totalTokens },
    };
  }

  return {
    choices: [{
      message: { role: 'assistant', content: texto },
      finish_reason: data.stop_reason || 'stop',
    }],
    usage: { total_tokens: totalTokens },
  };
}

// ============================================================
// Registro de falhas (ai_error_logs)
//
// Nunca lança: um problema ao gravar o log não pode derrubar a
// resposta ao usuário. Se falhar, sobra o console.
//
// O detalhe é truncado porque os argumentos de tool carregam nome
// de cliente e valores — guardar o payload inteiro de toda falha
// transformaria a tabela de log num espelho da base.
// ============================================================
const LIMITE_DETALHE = 4000;

function truncar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return valor;
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  if (texto === undefined) return null;
  if (texto.length <= LIMITE_DETALHE) {
    return typeof valor === 'string' ? valor : valor;
  }
  return texto.slice(0, LIMITE_DETALHE) + `… (+${texto.length - LIMITE_DETALHE} caracteres)`;
}

interface FalhaIA {
  tipo: 'provider' | 'tool' | 'args' | 'fallback' | 'config';
  mensagem: string;
  user_id?: string | null;
  session_id?: string | null;
  provider?: string | null;
  model?: string | null;
  tool_name?: string | null;
  http_status?: number | null;
  detalhe?: Record<string, unknown> | null;
}

async function registrarErro(supabaseAdmin: any, falha: FalhaIA) {
  try {
    const detalhe = falha.detalhe
      ? Object.fromEntries(Object.entries(falha.detalhe).map(([k, v]) => [k, truncar(v)]))
      : null;

    await supabaseAdmin.from('ai_error_logs').insert({
      user_id: falha.user_id ?? null,
      session_id: falha.session_id ?? null,
      tipo: falha.tipo,
      provider: falha.provider ?? null,
      model: falha.model ?? null,
      tool_name: falha.tool_name ?? null,
      http_status: falha.http_status ?? null,
      mensagem: String(falha.mensagem).slice(0, 2000),
      detalhe,
    });
  } catch (e) {
    console.error('Falha ao registrar erro de IA:', (e as Error).message);
  }
}


// Adapter genérico: qualquer API compatível com OpenAI
async function callOpenAICompatible(provider: any, messages: any[], tools?: any[]) {
  const headers = montarHeaders(provider);

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: provider.max_tokens || 2000,
    temperature: provider.temperature || 0.7,
  };
  if (tools) body.tools = tools;

  const res = await fetchProvedor(provider, provider.api_url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return await lerJson(provider, res);
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
  // O Gemini leva a chave na URL, então aqui só entram os headers
  // extras que o admin tenha configurado.
  const res = await fetchProvedor(provider, url, {
    method: "POST",
    headers: montarHeaders({ ...provider, api_key: null }),
    body: JSON.stringify(body),
  });

  const data = await lerJson(provider, res);
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

// ------------------------------------------------------------------
// Streaming
//
// Sem isto o usuário via três pontinhos por 15-30s (o loop de tools
// chega a 10 rodadas) e a resposta caía de uma vez. Agora o texto
// aparece conforme a IA escreve, e durante as ações o chat mostra o
// que está acontecendo ("consultando suas vendas...").
//
// Cada chamada ao provedor é transmitida: se vierem tool_calls, os
// pedaços são acumulados e nada é exibido; se vier texto, ele sai na
// hora. Assim a rodada que de fato produz a resposta é a que faz o
// streaming, sem precisar adivinhar antes qual será.
// ------------------------------------------------------------------
async function callOpenAICompatibleStream(
  provider: any,
  messages: any[],
  tools: any[] | undefined,
  onDelta: (texto: string) => void,
) {
  const headers = montarHeaders(provider);

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: provider.max_tokens || 2000,
    temperature: provider.temperature || 0.7,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools) body.tools = tools;

  const res = await fetchProvedor(provider, provider.api_url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => '');
    throw erroProvedor(provider.provider_name, res.status, err || 'resposta sem corpo');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let conteudo = '';
  const toolCalls: any[] = [];
  let finishReason: string | null = null;
  let usage: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';

    for (const linha of linhas) {
      const t = linha.trim();
      if (!t.startsWith('data:')) continue;

      const dado = t.slice(5).trim();
      if (dado === '[DONE]') continue;

      let pacote: any;
      try { pacote = JSON.parse(dado); } catch { continue; }

      if (pacote.usage) usage = pacote.usage;

      const escolha = pacote.choices?.[0];
      if (!escolha) continue;
      if (escolha.finish_reason) finishReason = escolha.finish_reason;

      const delta = escolha.delta || {};

      if (delta.content) {
        conteudo += delta.content;
        onDelta(delta.content);
      }

      // tool_calls chegam fatiados e precisam ser remontados por índice
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) {
            toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.type) toolCalls[i].type = tc.type;
          if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const message: any = { role: 'assistant', content: conteudo || null };
  const chamadas = toolCalls.filter(Boolean);
  if (chamadas.length) message.tool_calls = chamadas;

  return {
    choices: [{ message, finish_reason: finishReason }],
    usage: usage || { total_tokens: 0 },
  };
}

// O adapter do Gemini continua sem streaming: entregamos o texto
// completo num único delta, e o fallback segue funcionando igual.
// Valida a configuração e concede uma segunda tentativa em falha
// passageira antes de deixar o provedor cair para o próximo.
async function callAIStream(
  provider: any,
  messages: any[],
  tools: any[] | undefined,
  onDelta: (texto: string) => void,
) {
  validarProvedor(provider);

  // Anthropic e Gemini não fazem streaming aqui: entregam o texto num
  // delta só. O importante é que o retorno tenha sempre o mesmo
  // formato, para o loop de tools não precisar saber quem respondeu.
  if (provider.provider_type === 'anthropic' || provider.provider_type === 'gemini') {
    const chamar = provider.provider_type === 'anthropic' ? callAnthropic : callGemini;
    const resposta = await comRetry(provider, () => chamar(provider, messages, tools));
    exigirRespostaUtil(provider, resposta);
    const texto = resposta?.choices?.[0]?.message?.content;
    if (texto) onDelta(texto);
    return resposta;
  }

  // No streaming o retry só vale enquanto nada foi transmitido: o
  // cliente já teria recebido a primeira metade do texto.
  let jaEmitiu = false;
  const onDeltaMarcado = (t: string) => { jaEmitiu = true; onDelta(t); };

  const resposta = await comRetry(provider, async () => {
    if (jaEmitiu) throw erroProvedor(provider.provider_name, null, 'falhou no meio da transmissão');
    return await callOpenAICompatibleStream(provider, messages, tools, onDeltaMarcado);
  });

  exigirRespostaUtil(provider, resposta);
  return resposta;
}

// Um 200 OK sem texto e sem tool_call é uma falha silenciosa: o
// usuário recebia "não consegui processar" e o próximo provedor nunca
// era tentado. Agora vira erro, e o fallback acontece.
function exigirRespostaUtil(provider: any, resposta: any) {
  const msg = resposta?.choices?.[0]?.message;
  const temTexto = typeof msg?.content === 'string' && msg.content.trim().length > 0;
  const temTool = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
  if (!temTexto && !temTool) {
    throw erroProvedor(provider.provider_name, null, 'respondeu vazio (sem texto e sem tool)');
  }
}

// Frase curta mostrada enquanto a ação roda
function rotuloTool(nome: string) {
  const mapa: Record<string, string> = {
    buscar_vendas: 'Consultando suas vendas...',
    buscar_gastos: 'Consultando seus gastos...',
    buscar_clientes: 'Consultando seus clientes...',
    buscar_produtos: 'Consultando seus produtos...',
    resumo_financeiro: 'Calculando o resumo financeiro...',
    top_gastos: 'Levantando os maiores gastos...',
    top_clientes: 'Levantando os melhores clientes...',
    criar_venda: 'Registrando a venda...',
    criar_gasto: 'Registrando o gasto...',
    criar_cliente: 'Cadastrando o cliente...',
    criar_produto: 'Cadastrando o produto...',
    criar_devedor: 'Registrando o devedor...',
    editar_venda: 'Atualizando a venda...',
    editar_gasto: 'Atualizando o gasto...',
    editar_cliente: 'Atualizando o cliente...',
    editar_produto: 'Atualizando o produto...',
    excluir_venda: 'Excluindo a venda...',
    excluir_gasto: 'Excluindo o gasto...',
    excluir_cliente: 'Excluindo o cliente...',
    excluir_produto: 'Excluindo o produto...',
  };
  return mapa[nome] || 'Processando...';
}

async function callAI(provider: any, messages: any[], tools?: any[]) {
  validarProvedor(provider);

  const chamar = provider.provider_type === 'anthropic' ? callAnthropic
    : provider.provider_type === 'gemini' ? callGemini
    // Default: OpenAI-compatible (groq, openrouter, together, litellm, ollama...)
    : callOpenAICompatible;

  const resposta = await comRetry(provider, () => chamar(provider, messages, tools));
  exigirRespostaUtil(provider, resposta);
  return resposta;
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
      case 'verificar_duplicata':
        if (r.encontrados > 0) responses.push(`Encontrei ${r.encontrados} registro(s) similar(es).`);
        break;
      default:
        if (r?.sucesso) responses.push(r.mensagem || 'Ação concluída.');
    }
  }
  return responses.length ? responses.join('\n') : 'Ferramenta executada sem retorno visível.';
}


// ============================================================
// Diagnóstico (painel admin)
// ============================================================

async function verifyAdmin(req: Request) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: 'Não autenticado', status: 401 };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: 'Token inválido', status: 401 };

  const { data: profile } = await supabase
    .from('perfis').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return { error: 'Sem permissão', status: 403 };

  return { supabase, user };
}

// A tela manda a config do provedor para dar para testar ANTES de
// salvar. A chave, porém, nunca volta do servidor mascarada nem em
// claro — então quando vier vazia ou mascarada, buscamos a salva.
async function resolverProvedor(supabase: any, enviado: any) {
  const provider = { ...enviado };

  const semChave = !provider.api_key || String(provider.api_key).includes('••••');

  if (semChave && provider.provider_name) {
    const { data } = await supabase
      .from('ai_providers')
      .select('api_key')
      .eq('provider_name', provider.provider_name)
      .maybeSingle();
    provider.api_key = data?.api_key || null;
  }

  return provider;
}

// ------------------------------------------------------------------
// Uma chamada ao provedor, medindo tempo e devolvendo o erro cru
// ------------------------------------------------------------------
async function chamarProvedor(provider: any, messages: any[], tools?: any[]) {
  const inicio = Date.now();

  try {
    if (provider.provider_type === 'anthropic') {
      const r = await callAnthropic(provider, messages, tools);
      return { ok: true, ms: Date.now() - inicio, resposta: r };
    }

    if (provider.provider_type === 'gemini') {
      const contents = messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content ?? '') }],
        }));

      const sistema = messages.find((m: any) => m.role === 'system');
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: provider.temperature ?? 0.7,
          maxOutputTokens: provider.max_tokens || 2000,
        },
      };
      if (sistema) body.systemInstruction = { parts: [{ text: sistema.content }] };
      if (tools?.length) {
        body.tools = [{
          functionDeclarations: tools.map((t: any) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        }];
      }

      const url = provider.api_url
        || `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.api_key}`;

      // Mesmo timeout do chat: sem isso o painel do admin ficaria
      // pendurado num provedor que não responde.
      const res = await fetchProvedor(provider, url, {
        method: 'POST',
        headers: montarHeaders({ ...provider, api_key: null }),
        body: JSON.stringify(body),
      });
      const texto = await res.text();
      if (!res.ok) {
        return { ok: false, ms: Date.now() - inicio, status: res.status, corpo: texto };
      }
      return { ok: true, ms: Date.now() - inicio, resposta: JSON.parse(texto) };
    }

    // OpenAI-compatible (Groq, OpenRouter, LiteLLM, Ollama, Azure...)
    const body: Record<string, unknown> = {
      model: provider.model,
      messages,
      max_tokens: provider.max_tokens || 2000,
      temperature: provider.temperature ?? 0.7,
    };
    if (tools?.length) body.tools = tools;

    const res = await fetchProvedor(provider, provider.api_url, {
      method: 'POST',
      headers: montarHeaders(provider),
      body: JSON.stringify(body),
    });
    const texto = await res.text();

    if (!res.ok) {
      return { ok: false, ms: Date.now() - inicio, status: res.status, corpo: texto };
    }
    return { ok: true, ms: Date.now() - inicio, resposta: JSON.parse(texto) };

  } catch (e) {
    // Erro de rede, DNS, timeout ou URL inválida
    return { ok: false, ms: Date.now() - inicio, status: null, corpo: (e as Error).message };
  }
}

// Extrai texto e tool calls de qualquer um dos formatos
function resumirResposta(provider: any, resposta: any) {
  if (provider.provider_type === 'gemini') {
    const partes = resposta?.candidates?.[0]?.content?.parts || [];
    return {
      texto: partes.filter((p: any) => p.text).map((p: any) => p.text).join(''),
      tools: partes.filter((p: any) => p.functionCall).map((p: any) => p.functionCall.name),
      tokens: resposta?.usageMetadata?.totalTokenCount || 0,
    };
  }

  const msg = resposta?.choices?.[0]?.message;
  return {
    texto: msg?.content || '',
    tools: (msg?.tool_calls || []).map((t: any) => t.function?.name).filter(Boolean),
    tokens: resposta?.usage?.total_tokens || 0,
  };
}

// ------------------------------------------------------------------
// Diagnóstico das tools
// ------------------------------------------------------------------
const HOJE = () => new Date().toISOString().split('T')[0];

// Leitura: rodam sempre, não deixam rastro
const TESTES_LEITURA: Array<{ nome: string; args: Record<string, unknown> }> = [
  { nome: 'buscar_vendas',     args: { limite: 3 } },
  { nome: 'buscar_gastos',     args: { limite: 3 } },
  { nome: 'buscar_clientes',   args: {} },
  { nome: 'buscar_produtos',   args: {} },
  { nome: 'resumo_financeiro', args: {} },
  { nome: 'top_gastos',        args: { limite: 3 } },
  { nome: 'vendas_por_cliente', args: {} },
  { nome: 'resumo_por_categoria', args: {} },
];

const MARCA = '[TESTE] diagnostico';

async function testarTools(supabase: any, userId: string, incluirEscrita: boolean) {
  const linhas: any[] = [];

  const rodar = async (nome: string, args: Record<string, unknown>, rotulo?: string) => {
    const inicio = Date.now();
    try {
      const r: any = await executeTool(nome, args, supabase, userId);
      const ms = Date.now() - inicio;
      if (r && r.error) {
        linhas.push({ tool: rotulo || nome, ok: false, ms, mensagem: String(r.error) });
        return null;
      }
      const qtd = Array.isArray(r) ? r.length : null;
      linhas.push({
        tool: rotulo || nome,
        ok: true,
        ms,
        mensagem: qtd !== null ? `${qtd} registro(s)` : 'ok',
      });
      return r;
    } catch (e) {
      linhas.push({
        tool: rotulo || nome,
        ok: false,
        ms: Date.now() - inicio,
        mensagem: (e as Error).message,
      });
      return null;
    }
  };

  for (const t of TESTES_LEITURA) {
    await rodar(t.nome, t.args);
  }

  if (!incluirEscrita) return linhas;

  // Faxina antes de começar. As tools de criação recusam duplicata
  // (mesmo telefone, mesma descrição+valor+data), então uma sobra de
  // execução anterior faria o teste reportar falha que não existe.
  const sobras = { clientes: 0, despesas: 0, vendas: 0, produtos: 0 };
  for (const [tabela, campo] of [
    ['clientes', 'nome'], ['despesas', 'descricao'],
    ['vendas', 'descricao'], ['produtos', 'nome'],
  ] as Array<[string, string]>) {
    const { data } = await supabase.from(tabela).select(`id, ${campo}`)
      .eq('user_id', userId).like(campo, `${MARCA}%`);
    if (data?.length) {
      await supabase.from(tabela).delete().eq('user_id', userId).like(campo, `${MARCA}%`);
      (sobras as any)[tabela] = data.length;
    }
  }
  const totalSobras = Object.values(sobras).reduce((a, b) => a + b, 0);
  if (totalSobras) {
    linhas.push({
      tool: 'limpeza prévia', ok: true, ms: 0,
      mensagem: `${totalSobras} registro(s) de teste de uma execução anterior foram removidos`,
    });
  }

  // Escrita: cria com marca visível e apaga em seguida. Se a limpeza
  // falhar, a linha diz qual id ficou para trás — nunca some calado.
  const limpar = async (tabela: string, id: string, rotulo: string) => {
    const { error } = await supabase.from(tabela).delete().eq('id', id).eq('user_id', userId);
    linhas.push(error
      ? { tool: rotulo, ok: false, ms: 0, mensagem: `NÃO REMOVIDO (id ${id}): ${error.message}` }
      : { tool: rotulo, ok: true, ms: 0, mensagem: 'registro de teste removido' });
  };

  const cliente: any = await rodar('criar_cliente', {
    nome: `${MARCA} cliente`,
    // Número improvável de existir de verdade: a tool recusa cadastro
    // com telefone repetido, e 11999999999 é comum demais em teste.
    telefone: '11900000001',
  });
  if (cliente?.id) await limpar('clientes', cliente.id, 'criar_cliente · limpeza');

  const gasto: any = await rodar('criar_gasto', {
    descricao: `${MARCA} gasto`,
    valor: 1,
    data: HOJE(),
    categoria: 'Outros',
  });
  if (gasto?.id) await limpar('despesas', gasto.id, 'criar_gasto · limpeza');

  const venda: any = await rodar('criar_venda', {
    descricao: `${MARCA} venda`,
    valor: 1,
    data_venda: HOJE(),
    status: 'pago',
  });
  if (venda?.id) await limpar('vendas', venda.id, 'criar_venda · limpeza');

  const produto: any = await rodar('criar_produto', {
    nome: `${MARCA} produto`,
    descricao: 'Registro temporário de diagnóstico',
    valor: 1,
  });
  if (produto?.id) await limpar('produtos', produto.id, 'criar_produto · limpeza');

  return linhas;
}

// ------------------------------------------------------------------


// As três ações de diagnóstico. Só admin chega aqui.
async function tratarDiagnostico(req: Request, body: any) {
  const admin = await verifyAdmin(req);
  if (admin.error) return json({ error: admin.error }, admin.status);

  const supabase = admin.supabase!;
  const acao = body.action;

  // --------------------------------------------------------------
  // Playground: uma chamada de teste ao provedor
  // --------------------------------------------------------------
  if (acao === 'test_provider') {
    const provider = await resolverProvedor(supabase, body.provider || {});
    if (body.model) provider.model = body.model;

    if (!provider.model) return json({ error: 'Informe o modelo.' }, 400);
    if (provider.provider_type !== 'gemini' && !provider.api_url) {
      return json({ error: 'Informe a URL da API.' }, 400);
    }

    const mensagem = String(body.mensagem || 'Responda apenas: ok').trim();
    const comContexto = Boolean(body.com_contexto);

    const messages = comContexto
      ? [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: mensagem }]
      : [{ role: 'user', content: mensagem }];

    const r = await chamarProvedor(provider, messages, comContexto ? TOOLS : undefined);

    if (!r.ok) {
      return json({
        ok: false,
        ms: r.ms,
        http_status: r.status,
        erro: r.corpo,
        provider: provider.provider_name,
        model: provider.model,
      });
    }

    const resumo = resumirResposta(provider, r.resposta);
    return json({
      ok: true,
      ms: r.ms,
      provider: provider.provider_name,
      model: provider.model,
      texto: resumo.texto,
      tools_chamadas: resumo.tools,
      tokens: resumo.tokens,
    });
  }

  // --------------------------------------------------------------
  // Lista de modelos do provedor
  // --------------------------------------------------------------
  if (acao === 'list_models') {
    const provider = await resolverProvedor(supabase, body.provider || {});
    const url = urlDeModelos(provider);
    if (!url) {
      return json({ error: 'Não deu para descobrir a URL de modelos. Preencha "URL de modelos" nos campos avançados.' }, 400);
    }

    try {
      const headers = provider.provider_type === 'gemini'
        ? montarHeaders({ ...provider, api_key: null })
        : montarHeaders(provider);

      if (provider.provider_type === 'anthropic' && provider.api_key) {
        delete headers['Authorization'];
        headers['x-api-key'] = provider.api_key;
        headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
      }

      const res = await fetchProvedor(provider, url, { headers });
      const texto = await res.text();

      if (!res.ok) {
        return json({ error: `O provedor respondeu ${res.status}`, detalhe: texto.slice(0, 1500) });
      }

      const modelos = extrairModelos(provider, JSON.parse(texto));
      return json({ modelos: modelos.sort(), total: modelos.length, url });
    } catch (e) {
      return json({ error: 'Falha ao consultar os modelos', detalhe: (e as Error).message });
    }
  }

  // --------------------------------------------------------------
  // Diagnóstico das tools
  // --------------------------------------------------------------
  if (acao === 'test_tools') {
    const linhas = await testarTools(supabase, admin.user!.id, Boolean(body.incluir_escrita));
    return json({
      linhas,
      total: linhas.length,
      falhas: linhas.filter((l: any) => !l.ok).length,
    });
  }


  return json({ error: 'Ação inválida.' }, 400);
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
    // O corpo é lido uma vez e serve às duas rotas.
    const corpo = await req.json().catch(() => ({} as any));

    // Diagnóstico do painel admin. Vem antes do fluxo de chat porque
    // tem outra regra de acesso (exige admin) e não consome cota.
    if (corpo.action === 'test_provider' || corpo.action === 'list_models' || corpo.action === 'test_tools') {
      return await tratarDiagnostico(req, corpo);
    }

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

    const { message, session_id, stream: querStream } = corpo;
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

    // Trial vencido continuava com 10 mensagens/dia, porque a busca em
    // ai_limits usa só perfis.plano — que segue 'gratuito' mesmo depois
    // de o período acabar. Agora o acesso ao chat segue o plano_ativo().
    const { data: acessoAtivo } = await supabaseAdmin.rpc('plano_ativo', { uid: user.id });
    if (acessoAtivo === false) {
      return new Response(JSON.stringify({
        error: 'Seu período de acesso terminou. Assine o Premium para voltar a usar o assistente.',
        planExpired: true,
      }), {
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

    const [vendasMes, gastosMes, clientesRes, vendasMesAnt, gastosMesAnt, ultimasVendas, devedores, perfilRes, produtosRes] = await Promise.all([
      supabaseAdmin.from('vendas').select('valor, status, data_venda').eq('user_id', user.id).gte('data_venda', inicioMes).lte('data_venda', fimMes + 'T23:59:59'),
      supabaseAdmin.from('despesas').select('valor, categoria, data').eq('user_id', user.id).gte('data', inicioMes).lte('data', fimMes),
      supabaseAdmin.from('clientes').select('id, nome').eq('user_id', user.id).eq('ativo', true),
      supabaseAdmin.from('vendas').select('valor, status').eq('user_id', user.id).gte('data_venda', inicioMesAnt).lte('data_venda', fimMesAnt + 'T23:59:59'),
      supabaseAdmin.from('despesas').select('valor').eq('user_id', user.id).gte('data', inicioMesAnt).lte('data', fimMesAnt),
      supabaseAdmin.from('vendas').select('descricao, valor, status, data_venda, clientes(nome)').eq('user_id', user.id).order('data_venda', { ascending: false }).limit(5),
      supabaseAdmin.from('vendas').select('descricao, valor, clientes(nome)').eq('user_id', user.id).eq('status', 'pendente').order('data_venda', { ascending: false }).limit(5),
      supabaseAdmin.from('perfis').select('nome_completo, empresa').eq('id', user.id).single(),
      supabaseAdmin.from('produtos').select('id, nome, valor').eq('user_id', user.id).order('nome'),
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

    // Limites reais do plano deste usuário. Vão para o contexto porque
    // são configuráveis no painel: com os números cravados no prompt, a
    // IA passaria a informar valores errados assim que o admin mudasse
    // qualquer limite.
    const { data: limitesPlano } = await supabaseAdmin
      .from('plano_limites')
      .select('*')
      .eq('plan_type', planType)
      .maybeSingle();

    const ouIlimitado = (v: number | null | undefined) =>
      (v === null || v === undefined) ? 'ilimitado' : String(v);

    const blocoLimites = [
      `- Plano do usuário: ${planType}`,
      `- Limite de clientes: ${ouIlimitado(limitesPlano?.max_clientes)}`,
      `- Limite de vendas + gastos somados: ${ouIlimitado(limitesPlano?.max_movimentacoes)}`,
      `- Limite de produtos: ${ouIlimitado(limitesPlano?.max_produtos)}`,
      `- Mensagens de IA por dia: ${effectiveDailyLimit} (usadas hoje: ${currentUsage.messages_used})`,
      limitesPlano?.trial_dias
        ? `- Dias de teste do plano gratuito: ${limitesPlano.trial_dias}`
        : null,
    ].filter(Boolean).join('\n');

    const contexto = `
CONTEXTO DO USUÁRIO (resumo automático):
- Nome: ${perfilRes?.data?.nome_completo || 'Não informado'} | Empresa: ${perfilRes?.data?.empresa || 'Não informado'}
${blocoLimites}
- Clientes cadastrados: ${clientesRes.data?.length || 0}
- Mês atual (${inicioMes} a ${fimMes}): vendas R$${totalVendasMes.toFixed(2)}, gastos R$${totalGastosMes.toFixed(2)}, lucro R$${lucroMes.toFixed(2)}
- Mês anterior: vendas R$${totalVendasMesAnt.toFixed(2)}, gastos R$${totalGastosMesAnt.toFixed(2)}, lucro R$${(totalVendasMesAnt - totalGastosMesAnt).toFixed(2)}
- A receber (pendentes): R$${totalPendentes.toFixed(2)} (${pendentes.length} vendas)
- Ticket médio: R$${vendasPagas.length ? (totalVendasMes / vendasPagas.length).toFixed(2) : '0.00'}
- Top categorias de gasto: ${Object.entries((gastosMes.data || []).reduce((acc: any, g: any) => { const c = g.categoria || 'Outros'; acc[c] = (acc[c] || 0) + Number(g.valor); return acc; }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c}: R$${Number(v).toFixed(2)}`).join(', ') || 'Nenhum'}
- Últimas vendas: ${(ultimasVendas.data || []).map((v: any) => `${v.descricao} R$${Number(v.valor).toFixed(2)} (${v.status})${v.clientes?.nome ? ' - ' + v.clientes.nome : ''}`).join('; ') || 'Nenhuma'}
- Devedores: ${(devedores.data || []).map((v: any) => `${v.clientes?.nome || 'Anônimo'}: R$${Number(v.valor).toFixed(2)} - ${v.descricao}`).join('; ') || 'Nenhum'}
- Produtos cadastrados: ${(produtosRes.data || []).map((p: any) => `${p.nome} (R$ ${Number(p.valor).toFixed(2)}, id: ${p.id})`).join('; ') || 'Nenhum'}
Use esses dados pra dar respostas inteligentes e contextualizadas. Não repita os dados brutos, analise e aconselhe.`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + contexto },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    const { data: providers } = await supabaseAdmin
      .from('ai_providers').select('*').eq('active', true).order('priority', { ascending: true });

    if (!providers || !providers.length) {
      await registrarErro(supabaseAdmin, {
        tipo: 'config',
        user_id: user.id,
        mensagem: 'Nenhum provedor de IA ativo cadastrado.',
      });
      return new Response(JSON.stringify({ error: 'Nenhum provedor de IA configurado. Configure na aba IA Config do admin.' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      });
    }

    // ----------------------------------------------------------------
    // A conversa roda dentro desta função para servir aos dois modos:
    // JSON (compatibilidade) e SSE (streaming). O `emitir` é no-op no
    // primeiro caso e escreve no fluxo no segundo.
    // ----------------------------------------------------------------
    async function conduzirConversa(emitir: (evento: any) => void) {
      let lastError = null;
      let finalContent = '';
      let totalTokens = 0;
      let usedProvider = '';
      let toolResults: any[] = [];

      // Se um provedor já gravou algo no banco, não podemos tentar o
      // próximo: ele receberia as mesmas mensagens e executaria o mesmo
      // cadastro de novo, duplicando o registro.
      let efeitoColateralExecutado = false;

      // Se o provedor anterior chegou a transmitir texto antes de
      // falhar, o cliente já mostrou aquele pedaço. Sem avisar para
      // limpar, o texto do próximo provedor era concatenado no do
      // anterior e o usuário via duas meias respostas grudadas.
      let algumTextoTransmitido = false;

      // Prazo global da requisição, e uma fatia por provedor dentro
      // dele. Sem a fatia, um modelo que fica pedindo tools sem parar
      // consome o orçamento inteiro no primeiro provedor e os demais
      // nem chegam a ser tentados — que é o cenário em que o fallback
      // mais faz falta.
      const prazoGlobal = Date.now() + ORCAMENTO_TOTAL_MS;

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const restantesNaFila = providers.length - i;
        const sobra = prazoGlobal - Date.now();

        // Este provedor pode usar quase tudo, menos um slot reservado
        // para cada um que ainda vem depois. Assim um modelo que fica
        // pedindo tools sem parar não deixa a fila sem tempo.
        const reservado = RESERVA_POR_PROVEDOR_MS * (restantesNaFila - 1);
        const fatia = Math.max(TEMPO_LIMITE_MS, sobra - reservado);
        provider._prazo = Math.min(prazoGlobal, Date.now() + fatia);

        try {
          if (restanteMs(provider) < MINIMO_PARA_TENTAR_MS) {
            console.warn(`Sem tempo para tentar ${provider.provider_name}; encerrando o fallback.`);
            break;
          }

          if (algumTextoTransmitido) {
            emitir({ type: 'reset' });
            algumTextoTransmitido = false;
          }

          // Cada tentativa começa limpa — sem isso os resultados de um
          // provedor que falhou vazavam para a resposta do próximo.
          toolResults = [];
          let textoStreamado = '';
          const onDelta = (t: string) => {
            textoStreamado += t;
            algumTextoTransmitido = true;
            emitir({ type: 'delta', text: t });
          };

          let currentMessages = [...messages];
          let response = await callAIStream(provider, currentMessages, TOOLS, onDelta);
          let choice = response.choices?.[0];
          totalTokens = response.usage?.total_tokens || 0;

          let iterations = 0;
          // Além do teto de rodadas, o loop para quando o orçamento
          // acaba — senão um modelo que fica pedindo tools sem parar
          // consumiria o tempo de todos os provedores seguintes.
          while (choice?.message?.tool_calls?.length && iterations < 10
                 && restanteMs(provider) > MINIMO_PARA_TENTAR_MS) {
            currentMessages.push(choice.message);

            for (const toolCall of choice.message.tool_calls) {
              const fnName = toolCall.function.name;
              let fnArgs = {};
              // Era um catch vazio: quando o modelo devolvia JSON quebrado,
              // a tool rodava com {} e cadastrava errado sem deixar rastro.
              try {
                fnArgs = JSON.parse(toolCall.function.arguments);
              } catch (erroArgs) {
                await registrarErro(supabaseAdmin, {
                  tipo: 'args',
                  user_id: user.id,
                  session_id: sessionId,
                  provider: provider.provider_name,
                  model: provider.model,
                  tool_name: fnName,
                  mensagem: `Argumentos inválidos para ${fnName}: ${(erroArgs as Error).message}`,
                  detalhe: { argumentos_crus: toolCall.function.arguments },
                });
              }

              emitir({ type: 'status', text: rotuloTool(fnName) });

              const result = await executeTool(fnName, fnArgs, supabaseAdmin, user.id);
              if (TOOLS_ESCRITA.has(fnName) && !result?.error) {
                efeitoColateralExecutado = true;
              }
              if (result?.error) {
                await registrarErro(supabaseAdmin, {
                  tipo: 'tool',
                  user_id: user.id,
                  session_id: sessionId,
                  provider: provider.provider_name,
                  model: provider.model,
                  tool_name: fnName,
                  mensagem: String(result.error),
                  detalhe: { argumentos: fnArgs },
                });
              }
              toolResults.push({ name: fnName, args: fnArgs, result });

              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              });
            }

            try {
              response = await callAIStream(provider, currentMessages, TOOLS, onDelta);
              choice = response.choices?.[0];
              totalTokens += response.usage?.total_tokens || 0;
            } catch (innerError) {
              const msgInterna = msgErro(innerError);
              if (msgInterna.includes('429') || msgInterna.includes('rate_limit')) {
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

          // O texto pode ter sido montado por gerarRespostaTools em vez
          // de vir do modelo. Nesse caso o que já foi transmitido não
          // corresponde ao final: o cliente troca pelo conteúdo do
          // evento 'replace'.
          if (finalContent !== textoStreamado) {
            emitir({ type: 'replace', text: finalContent });
          }

          usedProvider = provider.provider_name;
          lastError = null;
          break;
        } catch (e) {
          // msgErro porque nem todo throw em JS é um Error — um throw
          // de string fazia e.message virar undefined e o .includes()
          // logo abaixo derrubava a requisição de dentro do catch.
          const msg = msgErro(e);
          lastError = msg;
          console.error('Erro no provedor ' + provider.provider_name + ':', msg);

          await registrarErro(supabaseAdmin, {
            tipo: 'provider',
            user_id: user.id,
            session_id: sessionId,
            provider: provider.provider_name,
            model: provider.model,
            http_status: (e as any)?.status ?? null,
            mensagem: msg,
            detalhe: { corpo: (e as any).corpo ?? null, tools_executadas: toolResults.map((t: any) => t.name) },
          });

          // Já cadastrou/alterou algo antes de falhar: não tenta outro
          // provedor, senão a ação seria executada duas vezes.
          if (efeitoColateralExecutado) {
            console.warn('Provedor falhou após gravar no banco — fallback cancelado para não duplicar.');
            finalContent = toolResults.length
              ? gerarRespostaTools(toolResults)
              : 'A ação foi registrada, mas não consegui montar o resumo. Confira na tela correspondente.';
            emitir({ type: 'replace', text: finalContent });
            lastError = null;
            usedProvider = provider.provider_name;
            break;
          }

          if (msg.includes('429') || msg.includes('rate_limit')) {
            if (toolResults.length > 0) {
              finalContent = gerarRespostaTools(toolResults);
              emitir({ type: 'replace', text: finalContent });
              lastError = null;
              usedProvider = provider.provider_name;
              break;
            }
            continue;
          }

          // Vai tentar o próximo provedor: registra a troca para o
          // admin conseguir ver que houve fallback e por quê.
          const proximo = providers[providers.indexOf(provider) + 1];
          if (proximo) {
            await registrarErro(supabaseAdmin, {
              tipo: 'fallback',
              user_id: user.id,
              session_id: sessionId,
              provider: provider.provider_name,
              model: provider.model,
              mensagem: `Fallback: ${provider.provider_name} falhou, tentando ${proximo.provider_name}.`,
              detalhe: { motivo: msg, proximo: proximo.provider_name },
            });
          }
          continue;
        }
      }

      if (lastError) {
        // Todos os provedores falharam. O detalhe de cada um já está no
        // log de erros do painel; aqui o usuário recebe algo curto.
        console.error(`Todos os ${providers.length} provedores falharam. Último: ${lastError}`);
        return { erro: 'Não consegui responder agora. Tente novamente em alguns segundos.' };
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

      return {
        content: finalContent,
        session_id: sessionId,
        usage: {
          messages_used: currentUsage.messages_used + 1,
          messages_limit: effectiveDailyLimit,
          tokens_used: totalTokens,
        },
        provider: usedProvider,
      };
    }

    // ----------------------------------------------------------------
    // Modo SSE
    // ----------------------------------------------------------------
    if (querStream) {
      const encoder = new TextEncoder();
      const fluxo = new ReadableStream({
        async start(controller) {
          const emitir = (evento: any) => {
            try {
              controller.enqueue(encoder.encode('data: ' + JSON.stringify(evento) + '\n\n'));
            } catch { /* cliente desconectou */ }
          };

          try {
            emitir({ type: 'session', session_id: sessionId });
            const resultado = await conduzirConversa(emitir);

            if (resultado.erro) {
              emitir({ type: 'error', error: resultado.erro });
            } else {
              emitir({
                type: 'done',
                content: resultado.content,
                session_id: resultado.session_id,
                usage: resultado.usage,
                provider: resultado.provider,
              });
            }
          } catch (e) {
            emitir({ type: 'error', error: (e as Error).message });
          } finally {
            try { controller.close(); } catch { /* já fechado */ }
          }
        },
      });

      return new Response(fluxo, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
        status: 200,
      });
    }

    // ----------------------------------------------------------------
    // Modo JSON (comportamento anterior, mantido por compatibilidade)
    // ----------------------------------------------------------------
    const resultado = await conduzirConversa(() => {});

    if (resultado.erro) {
      return new Response(JSON.stringify({ error: resultado.erro }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      });
    }

    return new Response(JSON.stringify(resultado), {
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
