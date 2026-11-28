# Rodando o FinMEI localmente com URLs limpas

## Problema
No localhost, acessar `/planos`, `/dashboard`, etc. dava **404** porque o navegador tenta abrir o arquivo `planos` (sem extensão), que não existe — o arquivo real é `public/planos.html`. O `netlify.toml` só funciona em produção no Netlify, não no seu computador.

## Solução
Use o servidor local `server.py` que criei. Ele faz o rewrite de URLs limpas para `.html`, igual ao Netlify.

### Como rodar

```bash
# Na raiz do projeto (C:\VScode\Site Mei\Mei4)
python server.py
```

Depois acesse:

| URL | Arquivo servido |
|-----|----------------|
| `http://localhost:8000/` | Landing page (`public/index.html`) |
| `http://localhost:8000/login` | `public/login.html` |
| `http://localhost:8000/dashboard` | `public/dashboard.html` |
| `http://localhost:8000/planos` | `public/planos.html` |
| `http://localhost:8000/vendas` | `public/vendas.html` |
| `http://localhost:8000/gastos` | `public/gastos.html` |
| `http://localhost:8000/contas` | `public/contas.html` |
| `http://localhost:8000/clientes` | `public/clientes.html` |
| `http://localhost:8000/produtos` | `public/produtos.html` |
| `http://localhost:8000/mei` | `public/mei.html` |
| `http://localhost:8000/ia` | `public/ia.html` |
| `http://localhost:8000/perfil` | `public/perfil.html` |
| `http://localhost:8000/cadastro` | `public/cadastro.html` |
| `http://localhost:8000/nova-venda` | `public/nova-venda.html` |
| `http://localhost:8000/novo-cliente` | `public/novo-cliente.html` |
| `http://localhost:8000/importar` | `public/importar.html` |
| `http://localhost:8000/offline` | `public/offline.html` |
| `http://localhost:8000/checkout_sucesso` | `public/checkout_sucesso.html` |
| `http://localhost:8000/checkout_erro` | `public/checkout_erro.html` |
| `http://localhost:8000/checkout_pendente` | `public/checkout_pendente.html` |
| `http://localhost:8000/recuperar` | `public/recuperar.html` |
| `http://localhost:8000/redefinir-senha` | `public/redefinir-senha.html` |
| `http://localhost:8000/confirmar-email` | `public/confirmar-email.html` |
| `http://localhost:8000/admin/admin` | `public/admin/admin.html` |
| `http://localhost:8000/admin/admin-login` | `public/admin/admin-login.html` |

### Para parar
Pressione `Ctrl+C` no terminal onde o servidor está rodando.

---

## Arquivo criado
- `server.py` — Servidor local com rewrite de URLs limpas (sem `.html`)

## Em produção (Netlify)
Não precisa de nada. O `netlify.toml` já tem todos os redirects configurados e a pasta `public` é publicada como raiz. As URLs já vão limpas no navegador (sem `.html`).