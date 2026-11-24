// ============================================================
// Guarda de autenticação
//
// As páginas protegidas incluem este script no <head>, antes do
// body existir. Ele esconde a página até o auth.js confirmar se há
// sessão. Sem isso, a tela chega a pintar por um instante antes de
// redirecionar quem não está logado para o login.
// ============================================================
(function () {
    var raiz = document.documentElement;
    try {
        if (localStorage.getItem('finmei_tema') === 'light') {
            raiz.setAttribute('data-theme', 'light');
        }
    } catch (e) {
        // A preferência de tema não pode impedir a proteção da página.
    }
    raiz.classList.add('auth-pendente');

    // Chamado pelo auth.js quando a sessão já foi verificada.
    window.liberarPagina = function () {
        raiz.classList.remove('auth-pendente');
    };

    // Rede lenta ou Supabase fora do ar não pode deixar a tela em
    // branco para sempre: depois de alguns segundos mostramos a
    // página mesmo assim.
    setTimeout(function () {
        raiz.classList.remove('auth-pendente');
    }, 5000);
})();
