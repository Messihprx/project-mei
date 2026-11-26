import { supabase } from './auth.js';
import { formatarTelefone } from './novo-cliente.js';
import { esc, delegate, montarCsv, buscarTodasAsLinhas } from './dom-utils.js';
import { criarDataTable } from './datatable.js';

// --- FUNÇÕES DE ERRO INLINE ---
function mostrarErro(campoId, mensagem) {
    const input = document.getElementById(campoId);
    const erroDiv = document.getElementById('erro-' + campoId);
    if (input) input.classList.add('input-erro');
    if (erroDiv) {
        erroDiv.textContent = mensagem;
        erroDiv.style.display = 'block';
    }
}

function limparErro(campoId) {
    const input = document.getElementById(campoId);
    const erroDiv = document.getElementById('erro-' + campoId);
    if (input) input.classList.remove('input-erro');
    if (erroDiv) {
        erroDiv.textContent = '';
        erroDiv.style.display = 'none';
    }
}

function limparTodosErros() {
    ['editNome', 'editTelefone', 'formEditarCliente'].forEach(limparErro);
}

// --- VALIDAÇÕES ---
function validarNomeCliente(nome) {
    if (!nome) return 'O nome é obrigatório.';
    if (nome.length < 2) return 'O nome deve ter pelo menos 2 caracteres.';
    if (/\d/.test(nome)) return 'O nome não pode conter números.';
    if (/[^a-zA-ZÀ-ÿ\s]/.test(nome)) return 'O nome não pode conter caracteres especiais.';
    return null;
}

function validarTelefone(telefone) {
    const nums = telefone.replace(/\D/g, '');
    if (!nums) return 'O telefone é obrigatório.';
    if (nums.length < 10 || nums.length > 11) return 'Telefone inválido. Use o formato (DDD) 99999-9999.';
    return null;
}

// --- VERIFICAÇÃO DE DUPLICATAS ---
async function verificarDuplicata(nome, telefone, userId, excluirId = null) {
    const telefoneNum = telefone.replace(/\D/g, '');

    const [{ data: porNome }, { data: porTel }] = await Promise.all([
        supabase.from('clientes').select('id, nome, telefone').eq('user_id', userId).eq('ativo', true).ilike('nome', nome),
        supabase.from('clientes').select('id, nome, telefone').eq('user_id', userId).eq('ativo', true).eq('telefone', telefoneNum)
    ]);

    const duplicataNome = porNome?.find(c => c.id !== excluirId);
    const duplicataTel = porTel?.find(c => c.id !== excluirId);

    if (duplicataNome && duplicataTel && duplicataNome.id === duplicataTel.id) {
        return { campo: 'editNome', msg: `Já existe um cliente chamado "${duplicataNome.nome}" com este telefone.` };
    }
    if (duplicataNome) {
        return { campo: 'editNome', msg: `Já existe um cliente chamado "${duplicataNome.nome}".` };
    }
    if (duplicataTel) {
        return { campo: 'editTelefone', msg: `Este telefone já está cadastrado para "${duplicataTel.nome}".` };
    }
    return null;
}

// Guarda os clientes da última renderização. Os botões carregam só
// o id em data-*, e os dados saem daqui — assim nome, telefone e
// observação nunca entram dentro de um atributo HTML.
let clientesRenderizados = [];

// --- 1. LISTAR CLIENTES ---
let tabelaClientes = null;

function montarTabelaClientes(container) {
    tabelaClientes = criarDataTable({
        container,
        idLinha: (cliente) => cliente.id,
        porPagina: 10,
        placeholderBusca: 'Buscar por nome, telefone ou observação...',
        textoVazio: 'Nenhum cliente encontrado.',
        ordenacaoInicial: { coluna: 'nome', direcao: 'asc' },
        filtros: [
            {
                id: 'contato',
                rotulo: 'Contato',
                opcoes: [
                    { valor: '', texto: 'Todos' },
                    { valor: 'com', texto: 'Com telefone' },
                    { valor: 'sem', texto: 'Sem telefone' },
                ],
                testar: (cliente, valor) => valor === 'com'
                    ? Boolean(cliente.telefone)
                    : !cliente.telefone,
            },
        ],
        colunas: [
            {
                id: 'nome',
                titulo: 'Cliente',
                valor: (cliente) => cliente.nome || '',
                render: (cliente) => `<div class="dt-celula-principal">
                    <span class="dt-avatar">${esc((cliente.nome || '?').charAt(0).toUpperCase())}</span>
                    <span class="dt-nome">${esc(cliente.nome)}</span>
                </div>`,
            },
            {
                id: 'telefone',
                titulo: 'Telefone',
                valor: (cliente) => cliente.telefone || '',
                render: (cliente) => cliente.telefone
                    ? `<span>${esc(cliente.telefone)}</span>`
                    : '<span class="dt-sub" style="margin-top:0;">Sem contato</span>',
            },
            {
                id: 'observacao',
                titulo: 'Observação',
                valor: (cliente) => cliente.observacao || '',
                render: (cliente) => cliente.observacao
                    ? `<span class="dt-obs" title="${esc(cliente.observacao)}">${esc(cliente.observacao)}</span>`
                    : '<span class="dt-sub" style="margin-top:0;">—</span>',
            },
            {
                id: 'acoes',
                titulo: '',
                ordenavel: false,
                busca: false,
                alinhamento: 'right',
                render: (cliente) => `<div class="dt-acoes">
                    <button data-acao="whatsapp" data-id="${esc(cliente.id)}" class="btn-acao btn-whatsapp" title="Conversar">
                        <i data-lucide="message-circle"></i>
                    </button>
                    <button data-acao="editar" data-id="${esc(cliente.id)}" class="btn-acao btn-edit" title="Editar">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button data-acao="excluir" data-id="${esc(cliente.id)}" class="btn-acao btn-delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>`,
            },
        ],
    });
}

async function carregarClientes() {
    const container = document.getElementById("listaClientes");
    if (!container) return;

    if (!tabelaClientes) {
        container.innerHTML = '<p class="dt-carregando">Carregando clientes...</p>';
    }

    try {
        const clientes = await buscarTodasAsLinhas((inicio, fim) =>
            supabase.from('clientes')
                .select('id, nome, telefone, observacao')
                .eq('ativo', true)
                .order('nome')
                .order('id')
                .range(inicio, fim)
        );

        clientesRenderizados = clientes;

        if (!tabelaClientes) montarTabelaClientes(container);
        tabelaClientes.atualizar(clientes);

    } catch (err) {
        console.error("Erro ao carregar:", err.message);
        if (!tabelaClientes) {
            container.innerHTML = '<p style="color:red">Erro ao carregar dados.</p>';
        } else {
            mostrarModal('Erro ao carregar', 'Não foi possível carregar os clientes. Tente novamente.', 'alerta');
        }
    }
}

// --- 2. EDITAR CLIENTE ---
window.editarCliente = (id, nome, telefone, observacao) => {
    limparTodosErros();
    document.getElementById("editId").value = id;
    document.getElementById("editNome").value = nome;
    document.getElementById("editTelefone").value = telefone;
    document.getElementById("editObs").value = observacao === 'undefined' ? '' : observacao;
    document.getElementById("modalEditar").style.display = "flex";
};

// Máscara telefone no modal de edição
const inputTelefoneEdit = document.getElementById("editTelefone");
if (inputTelefoneEdit) {
    inputTelefoneEdit.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 0) value = "(" + value;
        if (value.length > 3) value = value.slice(0, 3) + ") " + value.slice(3);
        if (value.length > 10) value = value.slice(0, 10) + "-" + value.slice(10, 14);
        e.target.value = value.slice(0, 15);
        limparErro('editTelefone');
    });
}

window.fecharModal = () => {
    limparTodosErros();
    document.getElementById("modalEditar").style.display = "none";
};

// Salvar edição com validações
import { protegerAcao, invalidarCachePlano } from './planos.js';
const formEditar = document.getElementById("formEditarCliente");
if (formEditar) {
    protegerAcao("formEditarCliente", "cliente");
    formEditar.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        if(await protegerAcao("formEditarCliente", "cliente")) return;

        const id = document.getElementById("editId").value;
        const nome = document.getElementById("editNome").value.trim();
        const telefone = document.getElementById("editTelefone").value.trim();
        const observacao = document.getElementById("editObs").value.trim();

        limparTodosErros();

        const erroNome = validarNomeCliente(nome);
        const erroTel = validarTelefone(telefone);

        if (erroNome) mostrarErro('editNome', erroNome);
        if (erroTel) mostrarErro('editTelefone', erroTel);
        if (erroNome || erroTel) return;

        const btn = formEditar.querySelector('button[type="submit"]');

        try {
            btn.disabled = true;
            btn.innerText = "Salvando...";

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado.");

            const duplicata = await verificarDuplicata(nome, telefone, user.id, id);
            if (duplicata) {
                mostrarErro(duplicata.campo, duplicata.msg);
                return;
            }

            const { error } = await supabase
                .from('clientes')
                .update({ nome, telefone: formatarTelefone(telefone), observacao })
                .eq('id', id);

            if (error) throw error;
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            fecharModal();
            carregarClientes();

        } catch (err) {
            mostrarErro('formEditarCliente', 'Erro ao atualizar: ' + err.message);
            console.error("Erro ao editar cliente:", err);
        } finally {
            btn.disabled = false;
            btn.innerText = "Salvar Alterações";
        }
    });
}

// Fechar modal ao clicar fora
window.onclick = (event) => {
    const modal = document.getElementById("modalEditar");
    if (event.target == modal) fecharModal();
};

// --- 3. DELETAR CLIENTE ---
window.deletarCliente = async (id) => {
    const confirmed = await confirmModal("Excluir cliente", "Tem certeza que deseja excluir este cliente? Essa ação não pode ser desfeita.");
    if (!confirmed) return;

    try {
        const { error } = await supabase
            .from('clientes')
            .update({ ativo: false })
            .eq('id', id);

        if (error) throw error;
        // A contagem mudou: o aviso de limite não pode continuar
        // mostrando o número anterior a esta operação.
        invalidarCachePlano();
        carregarClientes();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

import { verificarStatusPlano } from './planos.js';

// --- INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const lista = document.getElementById("listaClientes");

    if (session && lista) {
        carregarClientes();
    }

    // Um listener só para a lista inteira. Substituiu os onclick
    // inline, que quebravam quando o nome do cliente tinha apóstrofo.
    delegate(lista, 'button[data-acao]', 'click', (e, botao) => {
        const cliente = clientesRenderizados.find(c => c.id === botao.dataset.id);
        if (!cliente) return;

        switch (botao.dataset.acao) {
            case 'whatsapp': {
                const numero = (cliente.telefone || '').replace(/\D/g, '');
                if (!numero) {
                    window.mostrarModal('Sem telefone', 'Este cliente não tem telefone cadastrado.', 'alerta');
                    return;
                }
                window.open(`https://wa.me/55${numero}`, '_blank');
                break;
            }
            case 'editar':
                window.editarCliente(cliente.id, cliente.nome, cliente.telefone, cliente.observacao || '');
                break;
            case 'excluir':
                window.deletarCliente(cliente.id);
                break;
        }
    });

    // --- 5. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarClientes");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                mostrarModal('Recurso Premium', 'A exportação de contatos é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos"; }, 2000);
                return;
            }

            btnExport.disabled = true;
            btnExport.innerText = "Exportando...";

            try {
                const { data: { user } } = await supabase.auth.getUser();
                const { data: clientes, error } = await supabase
                    .from('clientes')
                    .select('nome, telefone, observacao')
                    .eq('user_id', user.id)
                    .eq('ativo', true)
                    .order('nome');

                if (error) throw error;

                if (!clientes || clientes.length === 0) {
                    mostrarModal('Nenhum cliente', 'Você não possui clientes para exportar.', 'alerta');
                    return;
                }

                // Gerar CSV (montarCsv neutraliza células que o Excel
                // interpretaria como fórmula: = + - @)
                const csv = montarCsv(
                    ["Nome", "Telefone", "Observacao"],
                    clientes.map(c => [c.nome, c.telefone || '', c.observacao || ''])
                );

                const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Clientes_FinMEI.csv`;
                link.click();
                URL.revokeObjectURL(link.href);

            } catch (err) {
                console.error("Erro ao exportar:", err.message);
                mostrarModal('Erro ao exportar', 'Não foi possível exportar os dados. Tente novamente.');
            } finally {
                btnExport.disabled = false;
                btnExport.innerHTML = '<i data-lucide="download" style="width: 16px;"></i> Exportar CSV';
                if (window.lucide) lucide.createIcons();
            }
        });
    }
});
