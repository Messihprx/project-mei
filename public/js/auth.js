import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://grszaitpgnyrbxktxauc.supabase.co'
const supabaseKey = 'sb_publishable_6Ndppbw2HKqwb0x9s3TN5A_Uhm3Oa1F'
const supabase = createClient(supabaseUrl, supabaseKey)

// Exportamos para que você possa usar "import { supabase } from './auth.js'" em outros arquivos
export { supabase };

// --- FUNÇÕES DE VALIDAÇÃO ---
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
    ['nomeCadastro', 'emailCadastro', 'senhaCadastro', 'senhaConfirmar'].forEach(limparErro);
}

function validarNome(nome) {
    if (!nome) return 'O nome é obrigatório.';
    if (nome.length < 3) return 'O nome deve ter pelo menos 3 caracteres.';
    if (!nome.includes(' ')) return 'Informe o nome completo (nome e sobrenome).';
    if (/\d/.test(nome)) return 'O nome não pode conter números.';
    if (/[^a-zA-ZÀ-ÿ\s]/.test(nome)) return 'O nome não pode conter caracteres especiais.';
    const partes = nome.trim().split(/\s+/).filter(p => p.length > 0);
    if (partes.length < 2) return 'Informe nome e sobrenome.';
    return null;
}

function validarEmail(email) {
    if (!email) return 'O e-mail é obrigatório.';
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!regex.test(email)) return 'Informe um e-mail válido (ex: nome@email.com).';
    return null;
}

function validarSenhaForte(senha) {
    if (!senha) return 'A senha é obrigatória.';
    if (senha.length < 8) return 'A senha deve ter no mínimo 8 caracteres.';
    if (!/[A-Z]/.test(senha)) return 'A senha deve conter pelo menos uma letra maiúscula.';
    if (!/[a-z]/.test(senha)) return 'A senha deve conter pelo menos uma letra minúscula.';
    if (!/[0-9]/.test(senha)) return 'A senha deve conter pelo menos um número.';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(senha)) return 'A senha deve conter pelo menos um caractere especial (!@#$%...).';
    return null;
}

// --- MODAL DE VALIDAÇÃO (SUBSTITUI OS ALERTS) ---
function mostrarModal(titulo, mensagem, tipo = 'erro') {
    let overlay = document.getElementById('modalAlertaOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modalAlertaOverlay';
        overlay.className = 'modal-alerta-overlay';
        overlay.innerHTML = `
            <div class="modal-alerta">
                <div class="modal-alerta-icone" id="modalAlertaIcone">!</div>
                <h3 class="modal-alerta-titulo" id="modalAlertaTitulo"></h3>
                <p class="modal-alerta-mensagem" id="modalAlertaMensagem"></p>
                <button type="button" class="modal-alerta-btn" id="modalAlertaBtn">Entendi</button>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) fecharModal();
        });
        document.getElementById('modalAlertaBtn').addEventListener('click', fecharModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') fecharModal();
        });
    }

    const icone = document.getElementById('modalAlertaIcone');
    const btn = document.getElementById('modalAlertaBtn');

    icone.className = 'modal-alerta-icone ' + tipo;
    btn.className = 'modal-alerta-btn ' + tipo;
    icone.textContent = tipo === 'sucesso' ? '✓' : (tipo === 'alerta' ? '⚠' : '!');

    document.getElementById('modalAlertaTitulo').textContent = titulo;
    document.getElementById('modalAlertaMensagem').textContent = mensagem;
    overlay.classList.add('active');
    btn.focus();
}

function fecharModal() {
    const overlay = document.getElementById('modalAlertaOverlay');
    if (overlay) overlay.classList.remove('active');
}

window.mostrarModal = mostrarModal;
window.fecharModal = fecharModal;
window.traduzirErro = traduzirErro;

// --- TRADUÇÃO DE ERROS DO SUPABASE ---
function traduzirErro(mensagem) {
    const msg = (mensagem || '').toLowerCase();
    const erros = [
        ['invalid login credentials', 'E-mail ou senha incorretos. Verifique os dados e tente novamente.'],
        ['email not confirmed', 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada (e o spam).'],
        ['email already registered', 'Este e-mail já possui uma conta. Faça login ou recupere a senha.'],
        ['user already registered', 'Este e-mail já possui uma conta. Faça login ou recupere a senha.'],
        ['password should be at least', 'A senha deve ter no mínimo 8 caracteres.'],
        ['password should contain at least', 'A senha deve conter letras, números e símbolos.'],
        ['weak password', 'Senha fraca. Use no mínimo 8 caracteres com letras, números e símbolos.'],
        ['too many requests', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
        ['rate limit', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
        ['invalid email', 'Informe um e-mail válido.'],
        ['user not found', 'Usuário não encontrado. Verifique o e-mail informado.'],
        ['token has expired', 'O link de redefinição expirou. Solicite um novo link.'],
        ['unexpected failure', 'Ocorreu um erro inesperado. Tente novamente mais tarde.'],
        ['network error', 'Falha de conexão. Verifique sua internet e tente novamente.'],
        ['signup not enabled', 'O cadastro está temporariamente desativado. Tente novamente mais tarde.'],
        ['for security purposes, you can only request this once', 'Você já solicitou a redefinição. Verifique seu e-mail.'],
    ];
    for (const [chave, texto] of erros) {
        if (msg.includes(chave)) return texto;
    }
    return `Ocorreu um erro: ${mensagem}`;
}

import { injetarBannerPlano } from './planos.js';

// 1. VERIFICAR ACESSO (Proteção de Rotas)
const paginasPublicas = ["login", "cadastro", "recuperar", "redefinir-senha", "planos", "confirmar-email", ""];
const paginaAtual = (window.location.pathname.split("/").pop() || "index").split(".")[0];
const isPaginaProtegida = !paginasPublicas.includes(paginaAtual);

// Verifica se veio do OAuth (tokens na URL)
const temHashTokens = window.location.hash.includes('access_token');

function inicializarPagina(session) {
    injetarBannerPlano();
    inicializarMenuMobileGlobal();
}

// Escuta mudanças de autenticação PRIMEIRO (captura o retorno do Google)
supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
        if (window.location.pathname.includes("login.html") || window.location.pathname.includes("index.html")) {
            window.location.href = "redefinir-senha.html";
        }
        return;
    }

    if (session && isPaginaProtegida) {
        inicializarPagina(session);
    } else if (session && (paginaAtual === "login" || paginaAtual === "cadastro" || paginaAtual === "confirmar-email")) {
        window.location.href = "index.html";
    } else if (!session && isPaginaProtegida && !temHashTokens) {
        window.location.href = "login.html";
    }
});

// Só verifica a sessão DEPOIS de dar tempo pro Supabase processar os tokens
(async () => {
    // Se veio do OAuth, espera o Supabase processar o hash da URL
    if (temHashTokens) {
        await new Promise(r => setTimeout(r, 1500));
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (session && isPaginaProtegida) {
        inicializarPagina(session);
    } else if (session && (paginaAtual === "login" || paginaAtual === "cadastro" || paginaAtual === "confirmar-email")) {
        window.location.href = "index.html";
    } else if (!session && isPaginaProtegida && !temHashTokens) {
        window.location.href = "login.html";
    }
})();

// --- LOGICA DE MENU MOBILE GLOBAL ---
function inicializarMenuMobileGlobal() {
    const btn = document.getElementById("btnMenuMobile");
    const sidebar = document.querySelector(".sidebar");
    
    if (!btn || !sidebar) return;

    // Criar overlay se não existir
    let overlay = document.querySelector(".sidebar-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);
    }

    const alternarMenu = () => {
        const estaAtivo = sidebar.classList.toggle("active");
        overlay.classList.toggle("active");
        
        // Trocar ícone do botão
        const icon = btn.querySelector("i");
        if (icon) {
            icon.setAttribute("data-lucide", estaAtivo ? "x" : "menu");
            if (window.lucide) lucide.createIcons();
        }

        // Impedir scroll do body quando menu aberto
        document.body.style.overflow = estaAtivo ? "hidden" : "";
    };

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        alternarMenu();
    });

    overlay.addEventListener("click", alternarMenu);

    // Fechar ao clicar em links do menu no mobile
    const navLinks = sidebar.querySelectorAll(".nav-item");
    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            if (sidebar.classList.contains("active")) alternarMenu();
        });
    });
}

// --- VALIDAÇÃO EM TEMPO REAL (blur) ---
const nomeInput = document.getElementById("nomeCadastro");
const emailInput = document.getElementById("emailCadastro");
const senhaInput = document.getElementById("senhaCadastro");
const confirmaInput = document.getElementById("senhaConfirmar");

if (nomeInput) {
    nomeInput.addEventListener("blur", () => {
        const err = validarNome(nomeInput.value.trim());
        err ? mostrarErro('nomeCadastro', err) : limparErro('nomeCadastro');
    });
    nomeInput.addEventListener("input", () => limparErro('nomeCadastro'));
}
if (emailInput) {
    emailInput.addEventListener("blur", () => {
        const err = validarEmail(emailInput.value.trim());
        err ? mostrarErro('emailCadastro', err) : limparErro('emailCadastro');
    });
    emailInput.addEventListener("input", () => limparErro('emailCadastro'));
}
if (senhaInput) {
    senhaInput.addEventListener("blur", () => {
        const err = validarSenhaForte(senhaInput.value);
        err ? mostrarErro('senhaCadastro', err) : limparErro('senhaCadastro');
    });
    senhaInput.addEventListener("input", () => limparErro('senhaCadastro'));
}
if (confirmaInput) {
    confirmaInput.addEventListener("blur", () => {
        if (senhaInput && confirmaInput.value !== senhaInput.value) {
            mostrarErro('senhaConfirmar', 'As senhas não coincidem.');
        } else {
            limparErro('senhaConfirmar');
        }
    });
    confirmaInput.addEventListener("input", () => limparErro('senhaConfirmar'));
}

// 2. CADASTRO MANUAL
const formCadastro = document.getElementById("formCadastro");
if (formCadastro) {
    formCadastro.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = formCadastro.querySelector('button');
        const nome = document.getElementById("nomeCadastro").value.trim();
        const email = document.getElementById("emailCadastro").value.trim();
        const senha = document.getElementById("senhaCadastro").value;
        const confirma = document.getElementById("senhaConfirmar").value;

        limparTodosErros();

        const erroNome = validarNome(nome);
        const erroEmail = validarEmail(email);
        const erroSenha = validarSenhaForte(senha);

        if (erroNome) { mostrarErro('nomeCadastro', erroNome); }
        if (erroEmail) { mostrarErro('emailCadastro', erroEmail); }
        if (erroSenha) { mostrarErro('senhaCadastro', erroSenha); }
        if (senha !== confirma) { mostrarErro('senhaConfirmar', 'As senhas não coincidem.'); }

        if (erroNome || erroEmail || erroSenha || senha !== confirma) return;

        try {
            btn.disabled = true;
            btn.innerText = "Enviando e-mail...";

            const { data, error } = await supabase.auth.signUp({
                email,
                password: senha,
                options: { 
                    data: { nome: nome },
                    emailRedirectTo: window.location.origin + '/confirmar-email.html'
                }
            });

            if (error) {
                const msg = error.message.toLowerCase();

                // E-mail já cadastrado (conta existente com identidade)
                if (error.status === 422 || msg.includes("user already registered")) {
                    mostrarErro('emailCadastro', 'Este e-mail já possui uma conta. Faça login ou recupere a senha.');
                    return;
                }

                // E-mail vinculado a conta social (Google) — sem identidade local
                if (data?.user?.identities?.length === 0 || msg.includes("identity")) {
                    mostrarErro('emailCadastro', 'Este e-mail está vinculado ao login pelo Google. Use o botão "Entrar com Google".');
                    return;
                }

                // Rate limit (muitas tentativas)
                if (error.status === 429 || msg.includes("rate") || msg.includes("too many")) {
                    mostrarErro('formCadastro', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
                    return;
                }

                // Senha muito fraca (rejeitada pelo Supabase)
                if (msg.includes("password") && (msg.includes("short") || msg.includes("weak") || msg.includes("minimum"))) {
                    mostrarErro('senhaCadastro', 'Senha rejeitada. Use no mínimo 8 caracteres com letras, números e símbolos.');
                    return;
                }

                // E-mail inválido (rejeitado pelo Supabase)
                if (msg.includes("email") && msg.includes("invalid")) {
                    mostrarErro('emailCadastro', 'Este e-mail não é válido. Verifique e tente novamente.');
                    return;
                }

                // Erro genérico
                mostrarErro('formCadastro', 'Erro no cadastro: ' + error.message);
                return;
            }

            // Se retornou usuário sem identidade (duplicata silenciosa)
            if (data.user && data.user.identities && data.user.identities.length === 0) {
                mostrarErro('emailCadastro', 'Este e-mail já possui uma conta vinculada. Faça login ou use a recuperação de senha.');
                return;
            }

            // Sucesso
            localStorage.setItem('emailConfirmacao', email);
            window.location.href = "confirmar-email.html";

        } catch (err) {
            mostrarErro('formCadastro', 'Erro inesperado. Tente novamente mais tarde.');
            console.error("Erro cadastro:", err);
        } finally {
            btn.disabled = false;
            btn.innerText = "Finalizar Cadastro";
        }
    });
}

// --- E-MAIL CONFIRMADO EM OUTRO DISPOSITIVO (TELA DE LOGIN) ---
if (document.getElementById('formLogin')) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('confirmado') === '1') {
        mostrarModal('E-mail confirmado!', 'Seu e-mail foi confirmado com sucesso. Agora é só entrar com sua senha.', 'sucesso');
    }
    const emailPendente = localStorage.getItem('emailConfirmacao');
    if (emailPendente) {
        const campo = document.getElementById('emailLogin');
        if (campo) campo.value = emailPendente;
    }
}

// 3. LOGIN MANUAL
const formLogin = document.getElementById("formLogin");
if (formLogin) {
    formLogin.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("emailLogin").value.trim();
        const senha = document.getElementById("senhaLogin").value;

        const erroEmail = validarEmail(email);
        if (erroEmail) { mostrarModal('E-mail inválido', erroEmail); return; }
        if (!senha) { mostrarModal('Senha obrigatória', 'Digite sua senha para continuar.'); return; }

        const { data, error } = await supabase.auth.signInWithPassword({ 
            email, 
            password: senha 
        });

        if (error) {
            mostrarModal('Não foi possível entrar', traduzirErro(error.message));
        } else {
            window.location.href = "index.html";
        }
    });
}

// 4. LOGIN COM GOOGLE
const loginGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { 
            redirectTo: window.location.origin + '/public/index.html',
            queryParams: {
                access_type: 'offline',
                prompt: 'select_account',
            },
        }
    });
    if (error) mostrarModal('Erro no login com Google', traduzirErro(error.message));
};

// Vincula à janela global para o onclick funcionar
window.loginGoogle = loginGoogle;

// 5. UTILITÁRIOS GLOBAIS
window.logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Erro ao sair:", error.message);
    window.location.href = "login.html";
};

window.togglePassword = (id) => {
    const input = document.getElementById(id);
    if (!input) return;

    // Encontra o botão que está logo após o input ou dentro do mesmo container
    const btn = input.parentElement.querySelector('.btn-ver-senha');

    if (input.type === "password") {
        input.type = "text";
        btn.classList.add('slash'); // Adiciona o risquinho
    } else {
        input.type = "password";
        btn.classList.remove('slash'); // Remove o risquinho
    }
};

// 6. RECUPERAR SENHA
const formRecuperar = document.getElementById("formRecuperar");
if (formRecuperar) {
    formRecuperar.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("emailRecuperar").value.trim();
        const btn = document.getElementById("btnRecuperar");

        const erroEmail = validarEmail(email);
        if (erroEmail) { mostrarModal('E-mail inválido', erroEmail); return; }

        try {
            btn.disabled = true;
            btn.innerText = "Enviando...";

            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                // Para onde o usuário vai depois de clicar no e-mail (crie esta página depois)
                redirectTo: window.location.origin + '/redefinir-senha.html',
            });

            if (error) throw error;

            mostrarModal('E-mail enviado!', 'Enviamos um link de redefinição para o seu e-mail. Verifique sua caixa de entrada (e o spam).', 'sucesso');
            setTimeout(() => { window.location.href = "login.html"; }, 2500);
        } catch (err) {
            mostrarModal('Erro ao enviar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Enviar Link";
        }
    });
}

// 7. ATUALIZAR SENHA (Página redefinir-senha.html)
const formNovaSenha = document.getElementById("formNovaSenha");
if (formNovaSenha) {
    formNovaSenha.addEventListener("submit", async (e) => {
        e.preventDefault();
        const senha = document.getElementById("novaSenha").value;
        const confirma = document.getElementById("confirmarNovaSenha").value;
        const btn = document.getElementById("btnAtualizar");

        if (senha !== confirma) {
            mostrarModal('Senhas diferentes', 'As senhas não coincidem. Digite a mesma senha nos dois campos.');
            return;
        }

        if (senha.length < 8) {
            mostrarModal('Senha fraca', 'A senha deve ter no mínimo 8 caracteres.');
            return;
        }

        try {
            btn.disabled = true;
            btn.innerText = "Atualizando...";

            const { error } = await supabase.auth.updateUser({
                password: senha
            });

            if (error) throw error;

            mostrarModal('Senha atualizada!', 'Sua senha foi alterada com sucesso. Você será redirecionado para o login.', 'sucesso');
            setTimeout(() => { window.location.href = "login.html"; }, 2500);
        } catch (err) {
            mostrarModal('Erro ao atualizar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Atualizar Senha";
        }
    });
}

// 7. DETECTOR DE LINKS DE E-MAIL (Recuperação de Senha)
// (onAuthStateChange agora é chamado no topo do arquivo para capturar retorno do Google)