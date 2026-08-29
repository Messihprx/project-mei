import { supabase } from './auth.js';

// ============================================================
// Cache do estado do plano
//
// O site é multipágina: cada navegação recarrega tudo. Sem cache,
// abrir 5 telas custava 5x (getSession + perfis + meu_uso_plano),
// e meu_uso_plano sozinho faz ~7 consultas no Postgres. Isso pesa
// no plano gratuito do Supabase sem trazer nada — o plano de
// alguém não muda entre um clique e outro.
//
// sessionStorage (e não uma variável) porque precisa sobreviver à
// troca de página. Vale só para a aba atual e some ao fechar.
//
// TTL curto e invalidação explícita em toda ação que muda a
// contagem: cadastrar, excluir, assinar ou cancelar.
// ============================================================

const CACHE_TTL_MS = 60000;

function lerCache(chave) {
    try {
        const bruto = sessionStorage.getItem(chave);
        if (!bruto) return null;
        const { valor, em } = JSON.parse(bruto);
        if (Date.now() - em > CACHE_TTL_MS) return null;
        return valor;
    } catch {
        return null;
    }
}

function gravarCache(chave, valor) {
    try {
        sessionStorage.setItem(chave, JSON.stringify({ valor, em: Date.now() }));
    } catch {
        // Modo privado ou cota cheia: seguir sem cache é aceitável.
    }
}

/** Zera o cache. Chamar depois de qualquer coisa que mude plano ou contagem. */
export function invalidarCachePlano() {
    _usoPlanoCache = null;
    try {
        sessionStorage.removeItem('finmei_uso_plano');
        sessionStorage.removeItem('finmei_status_plano');
    } catch { /* sem sessionStorage, nada a fazer */ }
}

// Base do site em que o app está rodando: ".../public/" quando aberto
// da raiz do repositório, ".../" quando a pasta public é a raiz do
// deploy. As Edge Functions usam isso para montar as URLs de retorno
// do pagamento, em vez de terem um domínio fixo no código.
function baseDoSite() {
    return new URL('./', window.location.href).href;
}

export async function verificarStatusPlano(forcar = false) {
    if (!forcar) {
        const emCache = lerCache('finmei_status_plano');
        if (emCache) {
            // As datas voltam como texto do JSON
            if (emCache.validadePremium) emCache.validadePremium = new Date(emCache.validadePremium);
            return emCache;
        }
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { expirado: false, premium: false };

    const userId = session.user.id;

    // Fetch perfil
    const { data: perfil, error } = await supabase
        .from('perfis')
        .select('plano, criado_em, expira_em, assinatura_status, metodo_assinatura, assinatura_cancelada_em')
        .eq('id', userId)
        .single();

    let isPremium = false;
    let premiumVencido = false;
    let createdDate = new Date(session.user.created_at);
    let expiracaoPremium = null;

    if (perfil) {
        if (perfil.plano === 'premium') isPremium = true;
        if (perfil.criado_em) createdDate = new Date(perfil.criado_em);
        if (perfil.expira_em) expiracaoPremium = new Date(perfil.expira_em);
    }

    const hoje = new Date();

    // Lógica para Premium: Se a data de expiração passou, ele é considerado VENCIDO
    let diasRestantesPremium = null;
    if (isPremium && expiracaoPremium) {
        const difPremium = expiracaoPremium.getTime() - hoje.getTime();
        diasRestantesPremium = Math.ceil(difPremium / (1000 * 3600 * 24));
        
        if (hoje > expiracaoPremium) {
            isPremium = false;
            premiumVencido = true;
        }
    }

    const difTempo = hoje.getTime() - createdDate.getTime();
    const diasPassados = Math.floor(difTempo / (1000 * 3600 * 24));

    // Os dias de teste são configuráveis no painel admin. Com o 14
    // fixo aqui, mudar o limite fazia o banco bloquear numa data e o
    // banner anunciar outra.
    const uso = await carregarUsoPlano();
    const diasTrial = Number(uso?.trial_dias ?? 14);
    const diasRestantesTrial = diasTrial - diasPassados;

    // Está expirado se: 
    // 1. O Premium venceu (premiumVencido)
    // 2. OU não é premium e os 14 dias de teste acabaram
    const expirado = premiumVencido || (!isPremium && diasRestantesTrial <= 0);

    const resultado = {
        expirado,
        premiumVencido,
        diasRestantes: diasRestantesTrial < 0 ? 0 : diasRestantesTrial,
        premium: isPremium,
        validadePremium: expiracaoPremium,
        diasRestantesPremium: diasRestantesPremium,
        // Assinatura cancelada não derruba o acesso na hora: o usuário
        // pagou o período corrente e segue premium até expira_em.
        assinaturaCancelada: perfil?.assinatura_status === 'cancelled',
        metodoAssinatura: perfil?.metodo_assinatura || null,
        diasTrialConfigurados: diasTrial
    };

    gravarCache('finmei_status_plano', resultado);
    return resultado;
}

export async function assinarPlanoPremium(emailDoUsuario) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, message: "Sessão inválida" };

    try {
        // Agora chamamos a nossa Edge Function em vez de atualizar o banco direto!
        const { data, error } = await supabase.functions.invoke('mp-checkout', {
            body: {
                baseUrl: baseDoSite(),
                items: [
                    {
                        title: 'Assinatura Premium FinMEI',
                        quantity: 1,
                        unit_price: 15.90
                    }
                ],
                payerEmail: session.user.email,
                userId: session.user.id
            }
        });

        if (error) throw error;

        // Se a função retornou o link do Mercado Pago com sucesso
        if (data && data.init_point) {
            invalidarCachePlano();
            return { success: true, init_point: data.init_point };
        } else {
            throw new Error("Não foi possível gerar o link de pagamento.");
        }

    } catch (err) {
        console.error("Erro ao gerar checkout MP:", err.message);
        return { success: false, message: err.message };
    }
}

export async function injetarBannerPlano() {
    // Não injeta em páginas não-protegidas
    const paginasPublicas = ["login.html", "cadastro.html", "recuperar.html", "redefinir-senha.html", "planos.html"];
    const paginaAtual = window.location.pathname.split("/").pop() || "index.html";
    if (paginasPublicas.includes(paginaAtual)) return;

    const status = await verificarStatusPlano();

    // Se for Premium, mostra o badge de elite
    if (status.premium) {
        const userInfo = document.querySelector('.user-info');
        if (userInfo && !document.getElementById('badge-premium-user')) {
            const badge = document.createElement('div');
            badge.id = 'badge-premium-user';
            badge.innerHTML = `<i data-lucide="shield-check" style="width: 14px; margin-right: 4px;"></i> PREMIUM`;
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
            badge.style.color = '#38bdf8';
            badge.style.padding = '4px 10px';
            badge.style.borderRadius = '20px';
            badge.style.fontSize = '0.65rem';
            badge.style.fontWeight = '800';
            badge.style.border = '1px solid rgba(56, 189, 248, 0.3)';
            badge.style.marginRight = '15px';
            badge.style.letterSpacing = '0.5px';

            userInfo.prepend(badge);
        }

        // Card bonitinho na tela principal (Dashboard)
        if (paginaAtual === "index.html") {
            const contentWrapper = document.querySelector('.content-wrapper');
            if (contentWrapper && !document.getElementById('card-status-premium')) {
                const card = document.createElement('div');
                card.id = 'card-status-premium';
                card.style.background = 'linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%)';
                card.style.border = '1px solid rgba(56, 189, 248, 0.2)';
                card.style.borderRadius = '12px';
                card.style.padding = '15px 20px';
                card.style.marginBottom = '20px';
                card.style.display = 'flex';
                card.style.alignItems = 'center';
                card.style.justifyContent = 'space-between';

                const expDate = status.validadePremium ? new Date(status.validadePremium).toLocaleDateString('pt-BR') : 'Ativa';
                const cancelada = status.assinaturaCancelada;

                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="background: ${cancelada ? 'var(--cor-alerta)' : 'var(--cor-primaria)'}; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white;">
                            <i data-lucide="${cancelada ? 'alert-circle' : 'gem'}"></i>
                        </div>
                        <div>
                            <h4 style="margin: 0; font-size: 1rem; color: var(--texto-principal);">${cancelada ? 'Assinatura cancelada' : 'Você é Premium!'}</h4>
                            <p style="margin: 0; font-size: 0.8rem; color: var(--texto-secundario);">
                                ${cancelada
                                    ? `Seu acesso Premium continua até <b>${expDate}</b> e não será renovado.`
                                    : `Sua assinatura está ativa até: <b>${expDate}</b>`}
                            </p>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        ${cancelada
                            ? `<a href="planos.html" class="btn-upgrade" style="font-size:0.75rem;">Reativar</a>`
                            : `<span style="font-size: 0.7rem; color: var(--cor-primaria); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Status: Ativo</span>`}
                    </div>
                `;
                contentWrapper.prepend(card);
            }
        }

        // --- NOVO: Banner de aviso para Premium com expiração próxima (3 dias ou menos) ---
        if (status.premium && status.diasRestantesPremium !== null && status.diasRestantesPremium <= 3) {
            const mainContent = document.querySelector('.main-content');
            if (mainContent && !document.getElementById('banner-premium-expiring')) {
                const banner = document.createElement('div');
                banner.id = 'banner-premium-expiring';
                banner.className = 'notice-banner premium-expiring-banner';
                
                banner.innerHTML = `
                    <span class="notice-banner-text"><i data-lucide="alert-circle" style="width: 18px; position:relative; top:3px;"></i> Sua assinatura Premium expira em ${status.diasRestantesPremium} dia(s).</span>
                    <a href="planos.html" class="btn-upgrade">Renovar Agora</a>
                `;
                mainContent.prepend(banner);
            }
        }

        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    if (document.getElementById('banner-plano-teste')) return;

    // Injeta o CSS uma única vez
    if (!document.getElementById('style-trial-banner')) {
        const style = document.createElement('style');
        style.id = 'style-trial-banner';
        style.innerHTML = `
            .trial-bar{
                position:fixed;top:0;left:0;
                width:100%;
                z-index:9999;
                display:flex;align-items:center;justify-content:center;gap:12px;
                padding:10px 20px;
                font-size:13px;font-weight:600;color:#fff;
                animation:trialSlide .3s ease;
                box-sizing:border-box;
            }
            @keyframes trialSlide{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:translateY(0)}}
            .trial-bar .trial-text{display:flex;align-items:center;gap:7px}
            .trial-bar .trial-text svg{width:15px;height:15px}
            .trial-bar .trial-divider{width:1px;height:16px;background:rgba(255,255,255,.25);margin:0 2px}
            .trial-bar .trial-btn{
                padding:5px 14px;border-radius:7px;
                font-size:12px;font-weight:700;text-decoration:none;
                transition:all .15s;white-space:nowrap;
            }

            /* Trial normal (verde) */
            .trial-bar.trial-active{
                background:linear-gradient(135deg,#059669,#10b981);
                box-shadow:0 2px 12px rgba(16,185,129,.25);
            }
            .trial-bar.trial-active .trial-btn{
                background:rgba(255,255,255,.2);color:#fff;
                border:1px solid rgba(255,255,255,.3);
            }
            .trial-bar.trial-active .trial-btn:hover{
                background:rgba(255,255,255,.3);
            }

            /* Trial poucos dias (amarelo) */
            .trial-bar.trial-warn{
                background:linear-gradient(135deg,#d97706,#f59e0b);
                box-shadow:0 2px 12px rgba(245,158,11,.25);
            }
            .trial-bar.trial-warn .trial-btn{
                background:rgba(255,255,255,.2);color:#fff;
                border:1px solid rgba(255,255,255,.3);
            }
            .trial-bar.trial-warn .trial-btn:hover{
                background:rgba(255,255,255,.3);
            }

            /* Trial expirado / premium expirando (vermelho) */
            .trial-bar.trial-danger{
                background:linear-gradient(135deg,#dc2626,#ef4444);
                box-shadow:0 2px 12px rgba(239,68,68,.25);
            }
            .trial-bar.trial-danger .trial-btn{
                background:rgba(255,255,255,.2);color:#fff;
                border:1px solid rgba(255,255,255,.3);
            }
            .trial-bar.trial-danger .trial-btn:hover{
                background:rgba(255,255,255,.3);
            }
        `;
        document.head.appendChild(style);
    }

    const banner = document.createElement('div');
    banner.id = 'banner-plano-teste';
    banner.className = 'trial-bar';

    if (status.expirado) {
        banner.classList.add('trial-danger');
        banner.innerHTML = `
            <span class="trial-text">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Seu período gratuito expirou
            </span>
            <span class="trial-divider"></span>
            <a href="planos.html" class="trial-btn">Assinar Premium</a>
        `;
    } else {
        const dias = status.diasRestantes;
        const variant = dias <= 3 ? 'trial-danger' : dias <= 7 ? 'trial-warn' : 'trial-active';
        banner.classList.add(variant);

        const icon = dias <= 3
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

        banner.innerHTML = `
            <span class="trial-text">
                ${icon}
                Teste gratuito — <span style="font-weight:800">${dias} dia${dias !== 1 ? 's' : ''}</span> restante${dias !== 1 ? 's' : ''}
            </span>
            <span class="trial-divider"></span>
            <a href="planos.html" class="trial-btn">Ver planos</a>
        `;
    }

    // Prender no body pra não ser cortado por overflow
    document.body.prepend(banner);
    document.body.style.paddingTop = '40px';

    if (window.lucide) window.lucide.createIcons();
}

// --- FUNÇÃO GLOBAL DE IMPORTAÇÃO (PREMIUM) ---
window.abrirImportacao = async function() {
    const status = await verificarStatusPlano();
    if (!status.premium) {
        mostrarModal('Recurso Premium', 'O módulo de importação em massa de dados via CSV é exclusivo para assinantes Premium. Faça o upgrade agora!', 'alerta');
        setTimeout(() => { window.location.href = "planos.html"; }, 2000);
        return;
    }
    window.location.href = "importar.html";
};

export async function protegerAcao(formId, tipoOperacao = 'none') {
    const status = await verificarStatusPlano();
    const form = document.getElementById(formId);
    if (!form) return false;

    let bloqueio = false;
    let mensagemBloqueio = '';
    let resmsg = '';

    // 1. Bloqueio por Teste Expirado (se não for premium)
    if (status.expirado) {
        bloqueio = true;
        mensagemBloqueio = `<i data-lucide="lock" style="width: 18px; position:relative; top:3px;"></i> <b>Ação Bloqueada:</b> Seu período gratuito finalizou. <a href="planos.html" style="color: #ef4444; text-decoration: underline;">Faça o upgrade agora</a> para continuar utilizando.`;
    }
    // 2. Bloqueio por limite de entidades do plano
    //    Os números vêm de plano_limites (editável no painel admin) via
    //    RPC meu_uso_plano. Antes estavam cravados aqui como 10 e 50, o
    //    que fazia a tela dizer "de 10" enquanto o banco já barrava em
    //    outro valor. Quem barra de verdade é a trigger no Postgres —
    //    isto aqui é só o aviso antecipado.
    else if (!status.premium && tipoOperacao !== 'none') {
        // forcar: o gate precisa da contagem de agora. Sem isso, quem
        // acabou de cadastrar veria o número anterior ao próprio
        // cadastro e o aviso de limite chegaria tarde.
        const uso = await carregarUsoPlano(true);

        if (uso) {
            const mapa = {
                cliente:      { dados: uso.clientes,      rotulo: 'clientes',            icone: 'users' },
                movimentacao: { dados: uso.movimentacoes, rotulo: 'registros financeiros', icone: 'bar-chart' },
                produto:      { dados: uso.produtos,      rotulo: 'produtos',            icone: 'package' },
            };
            const item = mapa[tipoOperacao];

            if (item && item.dados && item.dados.max != null) {
                const usado = Number(item.dados.usado || 0);
                const max = Number(item.dados.max);

                if (usado >= max) {
                    bloqueio = true;
                    mensagemBloqueio = `<i data-lucide="${item.icone}" style="width: 18px; position:relative; top:3px;"></i> <b>Limite Atingido:</b> O plano gratuito permite até ${max} ${item.rotulo}. <a href="planos.html" style="color: #ef4444; text-decoration: underline;">Seja Premium</a> para uso ilimitado!`;
                } else {
                    resmsg = `<b>Uso do Plano Gratuito:</b> ${usado} de ${max} ${item.rotulo}.`;
                }
            }
        }
    }

    if (bloqueio) {
        // Desabilita as interações do form
        const inputs = form.querySelectorAll('input, button, textarea, select');
        inputs.forEach(i => i.disabled = true);

        // Exibir erro visual dentro do form se já não existe
        if (!form.querySelector('.aviso-bloqueio-limite')) {
            // Remove contador antigo (se houver)
            const antigo = form.querySelector('.aviso-contador-limite');
            if (antigo) antigo.remove();

            const aviso = document.createElement('div');
            aviso.className = 'aviso-bloqueio-limite';
            aviso.innerHTML = mensagemBloqueio;
            aviso.style.color = '#ef4444';
            aviso.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            aviso.style.border = '1px solid currentColor';
            aviso.style.padding = '12px';
            aviso.style.borderRadius = '8px';
            aviso.style.marginBottom = '20px';
            aviso.style.fontSize = '0.95rem';

            form.prepend(aviso);
            if (window.lucide) window.lucide.createIcons();
        }
        return true;
    }

    // Se NÃO foi bloqueado mas tem limite correndo (resumo)
    if (resmsg && !form.querySelector('.aviso-contador-limite')) {
        const info = document.createElement('div');
        info.className = 'aviso-contador-limite';
        info.innerHTML = `<i data-lucide="info" style="width: 16px; position:relative; top:2px;"></i> ${resmsg}`;
        info.style.color = '#38bdf8'; // Primária
        info.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
        info.style.border = '1px solid currentColor';
        info.style.padding = '8px 12px';
        info.style.borderRadius = '8px';
        info.style.marginBottom = '20px';
        info.style.fontSize = '0.85rem';

        form.prepend(info);
        if (window.lucide) window.lucide.createIcons();
    }

    return false;
}

// ============================================================
// USO DO PLANO (limites vindos do banco)
// ============================================================

let _usoPlanoCache = null;

export async function carregarUsoPlano(forcar = false) {
    if (!forcar) {
        if (_usoPlanoCache) return _usoPlanoCache;
        const emCache = lerCache('finmei_uso_plano');
        if (emCache) { _usoPlanoCache = emCache; return emCache; }
    }
    try {
        const { data, error } = await supabase.rpc('meu_uso_plano');
        if (error) throw error;
        _usoPlanoCache = data;
        gravarCache('finmei_uso_plano', data);
        return data;
    } catch (e) {
        console.error('Erro ao carregar uso do plano:', e);
        return null;
    }
}

// ============================================================
// ASSINATURA RECORRENTE (cartão)
//
// O Mercado Pago só faz cobrança automática no cartão de crédito —
// PIX e boleto não podem ser recorrentes. Por isso o pagamento
// avulso (assinarPlanoPremium) continua existindo em paralelo.
// ============================================================

export async function statusAssinatura() {
    try {
        const { data, error } = await supabase.functions.invoke('mp-subscription', { method: 'GET' });
        if (error) throw error;
        return data;
    } catch (e) {
        console.error('Erro ao consultar assinatura:', e);
        return null;
    }
}

export async function assinarRecorrente() {
    try {
        const { data, error } = await supabase.functions.invoke('mp-subscription', {
            body: { action: 'create', baseUrl: baseDoSite() }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!data?.init_point) throw new Error('Não foi possível gerar o link da assinatura.');
        invalidarCachePlano();
        return { success: true, init_point: data.init_point };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

export async function cancelarAssinatura() {
    try {
        const { data, error } = await supabase.functions.invoke('mp-subscription', {
            body: { action: 'cancel' }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        invalidarCachePlano();
        return { success: true, acessoAte: data.acesso_ate, mensagem: data.mensagem };
    } catch (e) {
        return { success: false, message: e.message };
    }
}
