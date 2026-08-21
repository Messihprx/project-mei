import { supabase } from './auth.js';

export async function verificarStatusPlano() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { expirado: false, premium: false };

    const userId = session.user.id;

    // Fetch perfil
    const { data: perfil, error } = await supabase
        .from('perfis')
        .select('plano, criado_em, expira_em')
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
    const diasRestantesTrial = 14 - diasPassados;

    // Está expirado se: 
    // 1. O Premium venceu (premiumVencido)
    // 2. OU não é premium e os 14 dias de teste acabaram
    const expirado = premiumVencido || (!isPremium && diasRestantesTrial <= 0);

    return {
        expirado,
        premiumVencido,
        diasRestantes: diasRestantesTrial < 0 ? 0 : diasRestantesTrial,
        premium: isPremium,
        validadePremium: expiracaoPremium,
        diasRestantesPremium: diasRestantesPremium
    };
}

export async function assinarPlanoPremium(emailDoUsuario) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, message: "Sessão inválida" };

    try {
        // Agora chamamos a nossa Edge Function em vez de atualizar o banco direto!
        const { data, error } = await supabase.functions.invoke('mp-checkout', {
            body: {
                items: [
                    {
                        title: 'Assinatura Premium FinMEI',
                        quantity: 1,
                        unit_price: 1.00
                    }
                ],
                payerEmail: session.user.email,
                userId: session.user.id
            }
        });

        if (error) throw error;

        // Se a função retornou o link do Mercado Pago com sucesso
        if (data && data.init_point) {
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

                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="background: var(--cor-primaria); width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white;">
                            <i data-lucide="gem"></i>
                        </div>
                        <div>
                            <h4 style="margin: 0; font-size: 1rem; color: var(--texto-principal);">Você é Premium!</h4>
                            <p style="margin: 0; font-size: 0.8rem; color: var(--texto-secundario);">Sua assinatura está ativa até: <b>${expDate}</b></p>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 0.7rem; color: var(--cor-primaria); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Status: Ativo</span>
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
                banner.style.width = '100%';
                banner.style.padding = '12px 20px';
                banner.style.textAlign = 'center';
                banner.style.fontWeight = '600';
                banner.style.display = 'flex';
                banner.style.justifyContent = 'center';
                banner.style.alignItems = 'center';
                banner.style.gap = '15px';
                banner.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                banner.style.flexWrap = 'wrap';
                banner.style.zIndex = '9999';
                banner.style.backgroundColor = '#f59e0b'; // Amarelo de atenção
                banner.style.color = '#fff';
                banner.style.animation = 'pulse-banner 2s infinite';
                
                if (!document.getElementById('style-pulse-banner')) {
                    const style = document.createElement('style');
                    style.id = 'style-pulse-banner';
                    style.innerHTML = `
                        @keyframes pulse-banner {
                            0% { opacity: 0.9; transform: scale(1); }
                            50% { opacity: 1; transform: scale(1.005); }
                            100% { opacity: 0.9; transform: scale(1); }
                        }
                    `;
                    document.head.appendChild(style);
                }

                banner.innerHTML = `
                    <span><i data-lucide="alert-circle" style="width: 18px; position:relative; top:3px;"></i> Sua assinatura Premium expira em ${status.diasRestantesPremium} dia(s).</span>
                    <a href="planos.html" class="btn-upgrade">Renovar Agora</a>
                `;
                mainContent.prepend(banner);

                const btn = banner.querySelector('.btn-upgrade');
                if (btn) {
                    btn.style.backgroundColor = '#fff';
                    btn.style.color = '#f59e0b';
                    btn.style.padding = '6px 16px';
                    btn.style.borderRadius = '6px';
                    btn.style.textDecoration = 'none';
                    btn.style.fontSize = '0.9rem';
                    btn.style.fontWeight = '700';
                    btn.style.transition = 'all 0.2s';
                }
            }
        }

        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    if (document.getElementById('banner-plano-teste')) return;

    const banner = document.createElement('div');
    banner.id = 'banner-plano-teste';
    banner.style.width = '100%';
    banner.style.padding = '12px 20px';
    banner.style.textAlign = 'center';
    banner.style.fontWeight = '600';
    banner.style.display = 'flex';
    banner.style.justifyContent = 'center';
    banner.style.alignItems = 'center';
    banner.style.gap = '15px';
    banner.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    banner.style.flexWrap = 'wrap';
    banner.style.zIndex = '9999';

    if (status.expirado) {
        banner.style.backgroundColor = '#ef4444'; // Cor Erro (Vermelho)
        banner.style.color = '#fff';
        banner.innerHTML = `
            <span><i data-lucide="alert-triangle" style="width: 18px; position:relative; top:3px;"></i> Seu período de teste expirou. Você não pode adicionar novos registros.</span>
            <a href="planos.html" class="btn-upgrade">Assinar Premium</a>
        `;
    } else {
        const poucosDias = status.diasRestantes <= 3;
        banner.style.backgroundColor = poucosDias ? '#ef4444' : '#f59e0b'; // Vermelho se estiver acabando
        banner.style.color = '#fff';
        
        // Adiciona uma pulsação se estiver acabando
        if (poucosDias) {
            banner.style.animation = 'pulse-banner 2s infinite';
            if (!document.getElementById('style-pulse-banner')) {
                const style = document.createElement('style');
                style.id = 'style-pulse-banner';
                style.innerHTML = `
                    @keyframes pulse-banner {
                        0% { opacity: 0.9; transform: scale(1); }
                        50% { opacity: 1; transform: scale(1.005); }
                        100% { opacity: 0.9; transform: scale(1); }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        banner.innerHTML = `
            <span><i data-lucide="${poucosDias ? 'alert-triangle' : 'clock'}" style="width: 18px; position:relative; top:3px;"></i> Você está no modo de teste. Restam ${status.diasRestantes} dias gratuitos.</span>
            <a href="planos.html" class="btn-upgrade">Ver Planos</a>
        `;
    }

    // Configura os botões internos do banner dinamicamente depois de append
    mainContent.prepend(banner);

    const btn = banner.querySelector('.btn-upgrade');
    if (btn) {
        btn.style.backgroundColor = '#fff';
        btn.style.color = banner.style.backgroundColor; // Usa a mesma cor de fundo para o texto do botão
        btn.style.padding = '6px 16px';
        btn.style.borderRadius = '6px';
        btn.style.textDecoration = 'none';
        btn.style.fontSize = '0.9rem';
        btn.style.fontWeight = '700';
        btn.style.transition = 'all 0.2s';
    }

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
    // 2. Bloqueio por Limite de Entidades do Plano Gratuito (msm dentro dos 14 dias)
    else if (!status.premium && tipoOperacao !== 'none') {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const uid = session.user.id;

            if (tipoOperacao === 'cliente') {
                const { count } = await supabase.from('clientes').select('*', { count: 'exact', head: true }).eq('user_id', uid);
                if (count >= 10) {
                    bloqueio = true;
                    mensagemBloqueio = `<i data-lucide="users" style="width: 18px; position:relative; top:3px;"></i> <b>Limite Atingido:</b> O plano gratuito permite até 10 clientes. <a href="planos.html" style="color: #ef4444; text-decoration: underline;">Seja Premium</a> para ter clientes ilimitados!`;
                } else {
                    resmsg = `<b>Uso do Plano Gratuito:</b> ${count} de 10 clientes cadastrados.`;
                }
            } else if (tipoOperacao === 'movimentacao') {
                const { count: countVendas } = await supabase.from('vendas').select('*', { count: 'exact', head: true }).eq('user_id', uid);
                const { count: countDespesas } = await supabase.from('despesas').select('*', { count: 'exact', head: true }).eq('user_id', uid);

                const totalMovimentacoes = (countVendas || 0) + (countDespesas || 0);
                if (totalMovimentacoes >= 50) {
                    bloqueio = true;
                    mensagemBloqueio = `<i data-lucide="bar-chart" style="width: 18px; position:relative; top:3px;"></i> <b>Limite Atingido:</b> O plano gratuito permite até 50 registros financeiros. <a href="planos.html" style="color: #ef4444; text-decoration: underline;">Seja Premium</a> para fluxo de caixa livre!`;
                } else {
                    resmsg = `<b>Uso do Plano Gratuito:</b> ${totalMovimentacoes} de 50 registros cadastrados.`;
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
