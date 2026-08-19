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
    ['nomeCliente', 'telefoneCliente', 'formNovoCliente'].forEach(limparErro);
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

// --- MÁSCARA DE TELEFONE ---
const inputTelefone = document.getElementById("telefoneCliente");

if (inputTelefone) {
    inputTelefone.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 0) value = "(" + value;
        if (value.length > 3) value = value.slice(0, 3) + ") " + value.slice(3);
        if (value.length > 10) value = value.slice(0, 10) + "-" + value.slice(10, 14);
        e.target.value = value.slice(0, 15);
        limparErro('telefoneCliente');
    });
}

// --- VALIDAÇÃO EM TEMPO REAL (blur) ---
const nomeInput = document.getElementById("nomeCliente");
if (nomeInput) {
    nomeInput.addEventListener("blur", () => {
        const err = validarNomeCliente(nomeInput.value.trim());
        err ? mostrarErro('nomeCliente', err) : limparErro('nomeCliente');
    });
    nomeInput.addEventListener("input", () => limparErro('nomeCliente'));
}

// --- VERIFICAÇÃO DE DUPLICATAS ---
async function verificarDuplicata(nome, telefone, userId, excluirId = null) {
    const telefoneNum = telefone.replace(/\D/g, '');

    // Busca clientes do mesmo user com mesmo nome (case-insensitive)
    let queryNome = supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('user_id', userId)
        .eq('ativo', true)
        .ilike('nome', nome);

    // Busca clientes do mesmo user com mesmo telefone
    let queryTel = supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('user_id', userId)
        .eq('ativo', true)
        .eq('telefone', telefoneNum);

    const [{ data: porNome }, { data: porTel }] = await Promise.all([queryNome, queryTel]);

    // Filtra o próprio registro se estiver editando
    const duplicataNome = porNome?.find(c => c.id !== excluirId);
    const duplicataTel = porTel?.find(c => c.id !== excluirId);

    if (duplicataNome && duplicataTel && duplicataNome.id === duplicataTel.id) {
        return { campo: 'nomeCliente', msg: `Já existe um cliente chamado "${duplicataNome.nome}" com este telefone.` };
    }
    if (duplicataNome) {
        return { campo: 'nomeCliente', msg: `Já existe um cliente chamado "${duplicataNome.nome}".` };
    }
    if (duplicataTel) {
        return { campo: 'telefoneCliente', msg: `Este telefone já está cadastrado para "${duplicataTel.nome}".` };
    }
    return null;
}

// --- ENVIO DO FORMULÁRIO ---
const formNovoCliente = document.getElementById("formNovoCliente");
import { protegerAcao } from './planos.js';

if (formNovoCliente) {
    // Proteger formulário caso o teste tenha expirado
    protegerAcao("formNovoCliente", "cliente");

    formNovoCliente.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        // Verificação extra de segurança no submit 
        if(await protegerAcao("formNovoCliente", "cliente")) return;
        const btn = formNovoCliente.querySelector('button[type="submit"]');
        const nome = document.getElementById("nomeCliente").value.trim();
        const telefone = document.getElementById("telefoneCliente").value.trim();
        const observacao = document.getElementById("obsCliente").value.trim();

        limparTodosErros();

        const erroNome = validarNomeCliente(nome);
        const erroTel = validarTelefone(telefone);

        if (erroNome) mostrarErro('nomeCliente', erroNome);
        if (erroTel) mostrarErro('telefoneCliente', erroTel);
        if (erroNome || erroTel) return;

        try {
            btn.disabled = true;
            btn.innerText = "Salvando...";

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado.");

            const duplicata = await verificarDuplicata(nome, telefone, user.id);
            if (duplicata) {
                mostrarErro(duplicata.campo, duplicata.msg);
                return;
            }

            const { error } = await supabase.from('clientes').insert([{
                nome,
                telefone: telefone.replace(/\D/g, ""),
                observacao,
                user_id: user.id
            }]);

            if (error) throw error;

            window.location.href = "clientes.html";

        } catch (err) {
            mostrarErro('formNovoCliente', 'Erro ao cadastrar: ' + err.message);
            console.error("Erro cadastro cliente:", err);
        } finally {
            btn.disabled = false;
            btn.innerText = "Salvar Cliente";
        }
    });
}

// Exporta para uso no clientes.js
export { mostrarErro, limparErro, limparTodosErros, validarNomeCliente, validarTelefone, verificarDuplicata };
