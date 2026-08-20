import { supabase } from './auth.js';

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

// --- 1. LISTAR CLIENTES ---
async function carregarClientes(filtro = "") {
    const container = document.getElementById("listaClientes");
    if (!container) return;

    try {
        let query = supabase.from('clientes').select('*').eq('ativo', true).order('nome');
        if (filtro) query = query.ilike('nome', `%${filtro}%`);

        const { data: clientes, error } = await query;
        if (error) throw error;

        if (clientes.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">
                ${filtro ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
            </p>`;
            return;
        }

        container.innerHTML = clientes.map(cliente => `
            <div class="card-item-flex">
                <div class="info-principal">
                    <div class="avatar-cliente">
                        ${cliente.nome.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h4>${cliente.nome}</h4>
                        <p><i data-lucide="phone" style="width:12px"></i> ${cliente.telefone || 'Sem contato'}</p>
                        ${cliente.observacao ? `<small class="obs-tag">${cliente.observacao}</small>` : ''}
                    </div>
                </div>
                <div class="acoes">
                    <button onclick="window.open('https://wa.me/55${cliente.telefone?.replace(/\D/g, "")}', '_blank')" class="btn-acao btn-whatsapp" title="Conversar">
                        <i data-lucide="message-circle"></i>
                    </button>
                    <button onclick="editarCliente('${cliente.id}', '${cliente.nome.replace(/'/g, "\\'")}', '${cliente.telefone}', '${(cliente.observacao || '').replace(/'/g, "\\'")}')" class="btn-acao" style="color: var(--cor-primaria);" title="Editar">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button onclick="deletarCliente('${cliente.id}')" class="btn-acao btn-delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `).join('');

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar:", err.message);
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

window.fecharModal = () => {
    limparTodosErros();
    document.getElementById("modalEditar").style.display = "none";
};

// Salvar edição com validações
import { protegerAcao } from './planos.js';
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
                .update({ nome, telefone: telefone.replace(/\D/g, ""), observacao })
                .eq('id', id);

            if (error) throw error;

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
    if (!confirm("Tem certeza que deseja excluir este cliente?")) return;

    try {
        const { error } = await supabase
            .from('clientes')
            .update({ ativo: false })
            .eq('id', id);

        if (error) throw error;
        carregarClientes(document.getElementById("buscarCliente")?.value || "");
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

// --- 4. BUSCA ---
const inputBusca = document.getElementById("buscarCliente");
if (inputBusca) {
    inputBusca.addEventListener("input", (e) => {
        clearTimeout(window.buscaTimer);
        window.buscaTimer = setTimeout(() => {
            carregarClientes(e.target.value);
        }, 300);
    });
}

import { verificarStatusPlano } from './planos.js';

// --- INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && document.getElementById("listaClientes")) {
        carregarClientes();
    }

    // --- 5. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarClientes");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                mostrarModal('Recurso Premium', 'A exportação de contatos é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos.html"; }, 2000);
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

                // Gerar CSV
                let csv = "Nome;Telefone;Observacao\n";
                clientes.forEach(c => {
                    const tel = c.telefone || '';
                    const obs = (c.observacao || '').replace(/\n/g, ' ');
                    csv += `${c.nome};${tel};${obs}\n`;
                });

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
