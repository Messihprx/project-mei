import { supabase } from './auth.js';

const AVATAR_PADRAO = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
const BUCKET_AVATAR = 'avatars';
const TAMANHO_AVATAR = 512;
const QUALIDADE_AVATAR = 0.82;

let usuarioAtual = null;
let perfilAtual = null;
let fotoPendente = null;
let removerFoto = false;
let previewUrl = null;

const CAMPOS = [
    'nome_completo', 'cpf', 'data_nascimento', 'celular', 'telefone',
    'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_municipal', 'cnae',
    'data_abertura', 'cep', 'logradouro', 'numero', 'complemento', 'bairro',
    'cidade', 'estado', 'site', 'instagram', 'chave_pix', 'bio'
];

const CAMPOS_VALIDADOS = [
    'nome_completo', 'cpf', 'cnpj', 'celular', 'telefone', 'cep',
    'data_nascimento', 'data_abertura', 'site'
];

// ------------------------------------------------------------------
// Helpers de tela
// ------------------------------------------------------------------
function el(id) {
    return document.getElementById(id);
}

function valorDe(id) {
    const campo = el(id);
    return campo ? campo.value.trim() : '';
}

function valorOpcional(id) {
    const valor = valorDe(id);
    return valor || null;
}

function mostrarErro(id, mensagem) {
    const campo = el(id);
    const erro = el('erro-' + id);
    if (campo) campo.classList.add('input-erro');
    if (erro) {
        erro.textContent = mensagem;
        erro.style.display = 'block';
    }
}

function limparErro(id) {
    const campo = el(id);
    const erro = el('erro-' + id);
    if (campo) campo.classList.remove('input-erro');
    if (erro) {
        erro.textContent = '';
        erro.style.display = 'none';
    }
}

function limparTodosErros() {
    CAMPOS_VALIDADOS.forEach(limparErro);
}

function definirStatus(texto, tipo) {
    const status = el('perfilStatus');
    if (!status) return;

    const icone = tipo === 'ok' ? 'check-circle' : tipo === 'pendente' ? 'clock' : 'shield-check';
    status.classList.remove('ok', 'pendente');
    if (tipo) status.classList.add(tipo);
    status.innerHTML = `<i data-lucide="${icone}"></i> ${texto}`;
    if (window.lucide) lucide.createIcons();
}

function traduzir(mensagem) {
    return window.traduzirErro ? window.traduzirErro(mensagem) : mensagem;
}

function avisar(titulo, mensagem, tipo = 'erro') {
    if (window.mostrarModal) {
        window.mostrarModal(titulo, mensagem, tipo);
    } else {
        alert(`${titulo}\n\n${mensagem}`);
    }
}

function formatarDataBR(valor) {
    if (!valor) return '—';
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '—';
    return data.toLocaleDateString('pt-BR');
}

function somenteDigitos(valor) {
    return (valor || '').replace(/\D/g, '');
}

// ------------------------------------------------------------------
// Máscaras
// ------------------------------------------------------------------
function mascararCPF(valor) {
    const d = somenteDigitos(valor).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function mascararCNPJ(valor) {
    const d = somenteDigitos(valor).slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function mascararTelefone(valor, maximo = 11) {
    const d = somenteDigitos(valor).slice(0, maximo);
    if (!d) return '';
    if (d.length <= 2) return `(${d}`;
    const ddd = d.slice(0, 2);
    const resto = d.slice(2);
    if (resto.length <= 4) return `(${ddd}) ${resto}`;
    const corte = resto.length > 8 ? 5 : 4;
    return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

function mascararCEP(valor) {
    const d = somenteDigitos(valor).slice(0, 8);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)}-${d.slice(5)}`;
}

// ------------------------------------------------------------------
// Validações
// ------------------------------------------------------------------
function cpfValido(digitos) {
    if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

    let soma = 0;
    for (let i = 0; i < 9; i++) soma += Number(digitos[i]) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== Number(digitos[9])) return false;

    soma = 0;
    for (let i = 0; i < 10; i++) soma += Number(digitos[i]) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    return resto === Number(digitos[10]);
}

function cnpjValido(digitos) {
    if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false;

    const calcular = (base, pesos) => {
        let soma = 0;
        for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };

    const d1 = calcular(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = calcular(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(digitos[12]) && d2 === Number(digitos[13]);
}

function normalizarSite(valor) {
    if (!valor) return '';
    const limpo = valor.trim();
    return /^https?:\/\//i.test(limpo) ? limpo : `https://${limpo}`;
}

function siteValido(valor) {
    try {
        const url = new URL(valor);
        return Boolean(url.hostname && url.hostname.includes('.'));
    } catch {
        return false;
    }
}

function dataNaoFutura(valor) {
    if (!valor) return true;
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    return valor <= iso;
}

function validarFormulario() {
    limparTodosErros();
    let valido = true;

    const nome = valorDe('nome_completo');
    if (nome.length < 3) {
        mostrarErro('nome_completo', 'Informe seu nome completo (pelo menos 3 caracteres).');
        valido = false;
    }

    const cpf = somenteDigitos(valorDe('cpf'));
    if (cpf && !cpfValido(cpf)) {
        mostrarErro('cpf', 'CPF inválido. Confira os números digitados.');
        valido = false;
    }

    const cnpj = somenteDigitos(valorDe('cnpj'));
    if (cnpj && !cnpjValido(cnpj)) {
        mostrarErro('cnpj', 'CNPJ inválido. Confira os números digitados.');
        valido = false;
    }

    const celular = somenteDigitos(valorDe('celular'));
    if (celular && ![10, 11].includes(celular.length)) {
        mostrarErro('celular', 'Informe o celular com DDD (10 ou 11 números).');
        valido = false;
    }

    const telefone = somenteDigitos(valorDe('telefone'));
    if (telefone && ![10, 11].includes(telefone.length)) {
        mostrarErro('telefone', 'Informe o telefone com DDD (10 ou 11 números).');
        valido = false;
    }

    const cep = somenteDigitos(valorDe('cep'));
    if (cep && cep.length !== 8) {
        mostrarErro('cep', 'Informe um CEP com 8 números.');
        valido = false;
    }

    if (!dataNaoFutura(valorDe('data_nascimento'))) {
        mostrarErro('data_nascimento', 'A data de nascimento não pode estar no futuro.');
        valido = false;
    }

    if (!dataNaoFutura(valorDe('data_abertura'))) {
        mostrarErro('data_abertura', 'A data de abertura não pode estar no futuro.');
        valido = false;
    }

    const site = normalizarSite(valorDe('site'));
    if (site && !siteValido(site)) {
        mostrarErro('site', 'Informe um endereço de site válido.');
        valido = false;
    }

    if (!valido) {
        const primeiroErro = document.querySelector('#formPerfil .input-erro');
        if (primeiroErro) primeiroErro.focus();
    }

    return valido;
}

// ------------------------------------------------------------------
// Imagem: recorte quadrado + compressão antes de subir
// ------------------------------------------------------------------
function comprimirAvatar(file, qualidade = QUALIDADE_AVATAR) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const imagem = new Image();

        imagem.onload = () => {
            const lado = Math.min(imagem.width, imagem.height);
            const origemX = (imagem.width - lado) / 2;
            const origemY = (imagem.height - lado) / 2;
            const destino = Math.min(TAMANHO_AVATAR, lado);

            const canvas = document.createElement('canvas');
            canvas.width = destino;
            canvas.height = destino;

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, destino, destino);
            ctx.drawImage(imagem, origemX, origemY, lado, lado, 0, 0, destino, destino);

            URL.revokeObjectURL(objectUrl);

            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Não foi possível processar a imagem.'));
                    return;
                }

                // Segunda passada para fotos que ainda ficaram pesadas.
                if (blob.size > 250 * 1024 && qualidade > 0.6) {
                    comprimirAvatar(file, 0.6).then(resolve).catch(reject);
                    return;
                }

                resolve(new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }));
            }, 'image/jpeg', qualidade);
        };

        imagem.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Não foi possível ler a imagem selecionada.'));
        };

        imagem.src = objectUrl;
    });
}

async function enviarFoto(userId, file) {
    const caminho = `${userId}/avatar-${Date.now()}.jpg`;
    const { error } = await supabase.storage
        .from(BUCKET_AVATAR)
        .upload(caminho, file, {
            cacheControl: '31536000',
            contentType: 'image/jpeg',
            upsert: false
        });

    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET_AVATAR).getPublicUrl(caminho);
    return data.publicUrl;
}

async function removerArquivoFoto(fotoUrl) {
    if (!fotoUrl) return;
    try {
        const url = new URL(fotoUrl);
        const partes = url.pathname.split(`/${BUCKET_AVATAR}/`);
        if (partes[1]) {
            await supabase.storage.from(BUCKET_AVATAR).remove([decodeURIComponent(partes[1])]);
        }
    } catch (erro) {
        console.warn('Não foi possível remover a foto antiga:', erro);
    }
}

// ------------------------------------------------------------------
// Foto na tela
// ------------------------------------------------------------------
function fotoGoogle() {
    const meta = usuarioAtual?.user_metadata || {};
    return meta.avatar_url || meta.picture || meta.avatar || null;
}

function fotoSalva() {
    const url = perfilAtual?.foto_url || fotoGoogle();
    return url || AVATAR_PADRAO;
}

function atualizarAvatar() {
    const avatar = el('perfilAvatar');
    if (avatar) avatar.src = fotoSalva();
    atualizarBotoesFoto();

    const fotoHeader = document.getElementById('fotoUsuario');
    if (fotoHeader) fotoHeader.src = fotoSalva();
}

window.toggleProfileDropdown = function (event) {
    const dropdown = document.getElementById('profileDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');
    if (event) event.stopPropagation();
};

function atualizarBotoesFoto() {
    const remover = el('btnRemoverFoto');
    if (!remover) return;
    const temFoto = Boolean(fotoPendente || removerFoto || perfilAtual?.foto_url || usuarioAtual?.user_metadata?.avatar_url);
    remover.disabled = !temFoto;
}

function limparPreview() {
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
}

function selecionarArquivo() {
    el('inputFoto')?.click();
}

async function tratarArquivoSelecionado(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        avisar('Formato inválido', 'Selecione um arquivo de imagem (JPG, PNG ou WebP).');
        return;
    }

    if (file.size > 12 * 1024 * 1024) {
        avisar('Imagem muito grande', 'Escolha uma imagem de até 12 MB.');
        return;
    }

    try {
        const comprimida = await comprimirAvatar(file);
        limparPreview();
        previewUrl = URL.createObjectURL(comprimida);
        fotoPendente = comprimida;
        removerFoto = false;

        const avatar = el('perfilAvatar');
        if (avatar) avatar.src = previewUrl;

        atualizarBotoesFoto();
        definirStatus('Nova foto pronta. Clique em "Salvar alterações" para confirmar.', 'pendente');
    } catch (erro) {
        avisar('Erro na imagem', erro.message || 'Não foi possível processar a imagem.');
    }
}

function tratarRemocaoFoto() {
    if (fotoPendente) {
        fotoPendente = null;
        limparPreview();
        atualizarAvatar();
        definirStatus('Nova foto descartada.');
        return;
    }

    if (removerFoto) {
        removerFoto = false;
        atualizarAvatar();
        definirStatus('Remoção cancelada.');
        return;
    }

    if (!perfilAtual?.foto_url && !usuarioAtual?.user_metadata?.avatar_url) return;

    removerFoto = true;
    limparPreview();
    const avatar = el('perfilAvatar');
    if (avatar) avatar.src = AVATAR_PADRAO;
    atualizarBotoesFoto();
    definirStatus('A foto será removida quando você salvar.', 'pendente');
}

// ------------------------------------------------------------------
// Cabeçalho do cartão de perfil
// ------------------------------------------------------------------
function atualizarCabecalho() {
    const nome = perfilAtual?.nome_completo
        || usuarioAtual?.user_metadata?.nome
        || usuarioAtual?.user_metadata?.full_name
        || usuarioAtual?.email?.split('@')[0]
        || 'Meu perfil';

    const nomeEl = el('perfilNome');
    if (nomeEl) nomeEl.textContent = nome;

    const emailEl = el('perfilEmail');
    if (emailEl) emailEl.textContent = usuarioAtual?.email || perfilAtual?.email || '';

    const plano = String(perfilAtual?.plano || 'gratuito').toLowerCase();
    const planoEl = el('perfilPlano');
    if (planoEl) {
        const premium = plano === 'premium';
        planoEl.innerHTML = premium
            ? '<i data-lucide="gem"></i> Premium'
            : '<i data-lucide="sparkles"></i> Plano gratuito';
        planoEl.classList.toggle('premium', premium);
        planoEl.classList.toggle('gratuito', !premium);
        if (window.lucide) lucide.createIcons();
    }

    const membroEl = el('perfilMembroDesde');
    if (membroEl) membroEl.textContent = formatarDataBR(perfilAtual?.criado_em || perfilAtual?.data_criacao);

    const status = String(perfilAtual?.assinatura_status || 'trial').toLowerCase();
    const situacaoEl = el('perfilSituacao');
    if (situacaoEl) {
        situacaoEl.className = '';
        if (status === 'active') {
            situacaoEl.textContent = 'Assinatura ativa';
            situacaoEl.classList.add('situacao-ativa');
        } else if (status === 'cancelled') {
            situacaoEl.textContent = 'Cancelada';
            situacaoEl.classList.add('situacao-cancelada');
        } else {
            situacaoEl.textContent = 'Período de teste';
            situacaoEl.classList.add('situacao-teste');
        }
    }
}

// ------------------------------------------------------------------
// Carregar / preencher
// ------------------------------------------------------------------
function preencherFormulario() {
    const dados = perfilAtual || {};
    const meta = usuarioAtual?.user_metadata || {};

    const valores = {
        nome_completo: dados.nome_completo || meta.nome || meta.full_name || '',
        cpf: mascararCPF(dados.cpf || ''),
        data_nascimento: dados.data_nascimento ? String(dados.data_nascimento).slice(0, 10) : '',
        celular: mascararTelefone(dados.celular || '', 11),
        telefone: mascararTelefone(dados.telefone || '', 10),
        nome_fantasia: dados.nome_fantasia || '',
        razao_social: dados.razao_social || '',
        cnpj: mascararCNPJ(dados.cnpj || ''),
        inscricao_municipal: dados.inscricao_municipal || '',
        cnae: dados.cnae || '',
        data_abertura: dados.data_abertura ? String(dados.data_abertura).slice(0, 10) : '',
        cep: mascararCEP(dados.cep || ''),
        logradouro: dados.logradouro || '',
        numero: dados.numero || '',
        complemento: dados.complemento || '',
        bairro: dados.bairro || '',
        cidade: dados.cidade || '',
        estado: dados.estado || '',
        site: dados.site || '',
        instagram: dados.instagram || '',
        chave_pix: dados.chave_pix || '',
        bio: dados.bio || ''
    };

    CAMPOS.forEach((campo) => {
        const input = el(campo);
        if (input) input.value = valores[campo] ?? '';
    });

    const emailEl = el('email');
    if (emailEl) emailEl.value = usuarioAtual?.email || dados.email || '';
}

async function carregarPerfil() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login';
        return;
    }

    usuarioAtual = session.user;

    const { data, error } = await supabase
        .from('perfis')
        .select('*')
        .eq('id', usuarioAtual.id)
        .maybeSingle();

    if (error) {
        console.error('Erro ao carregar perfil:', error);
        avisar('Erro ao carregar perfil', traduzir(error.message));
    }

    perfilAtual = data || null;
    preencherFormulario();
    atualizarCabecalho();
    atualizarAvatar();
}

// ------------------------------------------------------------------
// Salvar
// ------------------------------------------------------------------
function coletarDados() {
    return {
        nome_completo: valorDe('nome_completo'),
        cpf: valorOpcional('cpf'),
        data_nascimento: valorOpcional('data_nascimento'),
        celular: valorOpcional('celular'),
        telefone: valorOpcional('telefone'),
        nome_fantasia: valorOpcional('nome_fantasia'),
        razao_social: valorOpcional('razao_social'),
        cnpj: valorOpcional('cnpj'),
        inscricao_municipal: valorOpcional('inscricao_municipal'),
        cnae: valorOpcional('cnae'),
        data_abertura: valorOpcional('data_abertura'),
        cep: valorOpcional('cep'),
        logradouro: valorOpcional('logradouro'),
        numero: valorOpcional('numero'),
        complemento: valorOpcional('complemento'),
        bairro: valorOpcional('bairro'),
        cidade: valorOpcional('cidade'),
        estado: valorOpcional('estado'),
        site: valorDe('site') ? normalizarSite(valorDe('site')) : null,
        instagram: valorOpcional('instagram'),
        chave_pix: valorOpcional('chave_pix'),
        bio: valorOpcional('bio')
    };
}

async function salvarPerfil(event) {
    event.preventDefault();
    if (!usuarioAtual) return;
    if (!validarFormulario()) return;

    const botao = el('btnSalvarPerfil');
    const textoOriginal = botao ? botao.innerHTML : '';

    try {
        if (botao) {
            botao.disabled = true;
            botao.innerHTML = '<i data-lucide="loader-2"></i> Salvando...';
            if (window.lucide) lucide.createIcons();
        }

        const dados = coletarDados();
        const fotoAnterior = perfilAtual?.foto_url || null;
        let fotoUrl = fotoAnterior;

        if (removerFoto) fotoUrl = null;

        if (fotoPendente) {
            fotoUrl = await enviarFoto(usuarioAtual.id, fotoPendente);
        }

        dados.foto_url = fotoUrl;

        const { data: linhas, error } = await supabase
            .from('perfis')
            .update(dados)
            .eq('id', usuarioAtual.id)
            .select('id');

        if (error) throw error;

        if (!linhas || linhas.length === 0) {
            throw new Error('Perfil não encontrado. Recarregue a página e tente novamente.');
        }

        if ((fotoPendente || removerFoto) && fotoAnterior && fotoAnterior !== fotoUrl) {
            await removerArquivoFoto(fotoAnterior);
        }

        // Mantém o avatar e o nome do menu do dashboard em sincronia.
        try {
            await supabase.auth.updateUser({
                data: {
                    nome: dados.nome_completo || null,
                    avatar_url: fotoUrl
                }
            });
            usuarioAtual = (await supabase.auth.getUser()).data.user || usuarioAtual;
        } catch (erro) {
            console.warn('Perfil salvo, mas os dados do usuário não foram sincronizados:', erro);
        }

        perfilAtual = { ...(perfilAtual || {}), ...dados };
        fotoPendente = null;
        removerFoto = false;
        limparPreview();
        atualizarAvatar();
        atualizarCabecalho();

        const siteEl = el('site');
        if (siteEl && dados.site) siteEl.value = dados.site;

        definirStatus('Dados salvos com sucesso.', 'ok');
        avisar('Perfil atualizado', 'Seus dados foram salvos com sucesso.', 'sucesso');
    } catch (erro) {
        console.error('Erro ao salvar perfil:', erro);
        avisar('Erro ao salvar', traduzir(erro.message));
        definirStatus('Não foi possível salvar. Tente novamente.');
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.innerHTML = textoOriginal;
            if (window.lucide) lucide.createIcons();
        }
    }
}

// ------------------------------------------------------------------
// CEP: preenche endereço pelo ViaCEP
// ------------------------------------------------------------------
async function buscarCEP() {
    const cep = somenteDigitos(valorDe('cep'));
    if (cep.length !== 8) return;

    try {
        const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!resposta.ok) return;
        const endereco = await resposta.json();
        if (endereco.erro) return;

        const preencher = (id, valor) => {
            const campo = el(id);
            if (campo && valor) campo.value = valor;
        };

        preencher('logradouro', endereco.logradouro);
        preencher('bairro', endereco.bairro);
        preencher('cidade', endereco.localidade);
        preencher('estado', endereco.uf);

        definirStatus('Endereço preenchido pelo CEP. Confira os dados.', 'pendente');
    } catch (erro) {
        console.warn('Não foi possível buscar o CEP:', erro);
    }
}

// ------------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------------
function configurarEventos() {
    el('formPerfil')?.addEventListener('submit', salvarPerfil);

    el('btnTrocarFoto')?.addEventListener('click', selecionarArquivo);
    el('btnTrocarFoto2')?.addEventListener('click', selecionarArquivo);
    el('btnRemoverFoto')?.addEventListener('click', tratarRemocaoFoto);
    el('inputFoto')?.addEventListener('change', tratarArquivoSelecionado);

    const mascaras = {
        cpf: mascararCPF,
        cnpj: mascararCNPJ,
        celular: (valor) => mascararTelefone(valor, 11),
        telefone: (valor) => mascararTelefone(valor, 10),
        cep: mascararCEP
    };

    Object.entries(mascaras).forEach(([id, mascarar]) => {
        const campo = el(id);
        if (!campo) return;
        campo.addEventListener('input', () => {
            campo.value = mascarar(campo.value);
            limparErro(id);
        });
    });

    el('cep')?.addEventListener('blur', buscarCEP);

    CAMPOS_VALIDADOS.forEach((id) => {
        el(id)?.addEventListener('input', () => limparErro(id));
    });

    document.addEventListener('click', (e) => {
        const dd = document.getElementById('profileDropdown');
        if (dd && !e.target.closest('.profile-dropdown')) dd.classList.remove('active');
    });

    el('site')?.addEventListener('blur', () => {
        const campo = el('site');
        if (!campo || !campo.value.trim()) return;
        const normalizado = normalizarSite(campo.value);
        if (siteValido(normalizado)) campo.value = normalizado;
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    configurarEventos();
    await carregarPerfil();
});
