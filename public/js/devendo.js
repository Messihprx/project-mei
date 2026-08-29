import { supabase } from './auth.js';
import { esc, delegate } from './dom-utils.js';

// Devedores da última renderização: o botão de cobrança recebia
// telefone, nome e valor por dentro de um onclick inline — o nome
// com apóstrofo quebrava o botão e o valor chegava como texto.
let devedoresRenderizados = [];

async function carregarDevedores() {
    const container = document.getElementById("listaDevedores");
    const totalElemento = document.getElementById("totalPendentes");
    const numPendentesElem = document.getElementById("qtdPendentes");
    const filtroMesInput = document.getElementById("filtroMesDevendo");

    if (!container) return;

    try {
        let query = supabase
            .from('vendas')
            .select(`
                *,
                clientes ( nome, telefone )
            `)
            .eq('status', 'pendente')
            .order('data_venda', { ascending: false });

        // Aplica o filtro de mês dinâmico (IGUAL AO DASHBOARD)
        if (filtroMesInput && filtroMesInput.value) {
            const [ano, mes] = filtroMesInput.value.split('-');
            const dataInicio = `${ano}-${mes}-01T00:00:00Z`;
            
            // Calcula o último dia real do mês (28, 30 ou 31)
            const ultimoDiaDinamico = new Date(ano, mes, 0).getDate();
            const dataFim = `${ano}-${mes}-${ultimoDiaDinamico}T23:59:59Z`;
            
            query = query.gte('data_venda', dataInicio).lte('data_venda', dataFim);
        }

        const { data: vendas, error } = await query;
        if (error) throw error;

        // Atualiza contadores
        if (numPendentesElem) numPendentesElem.textContent = vendas ? vendas.length : 0;

        let somaPendentes = 0;

        if (!vendas || vendas.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhuma pendência encontrada para este período.</p>`;
            if (totalElemento) totalElemento.textContent = "R$ 0,00";
            return;
        }

        devedoresRenderizados = vendas;

        container.innerHTML = vendas.map(venda => {
            somaPendentes += venda.valor;
            return `
                <div class="card-item-flex card-venda-premium pendente">
                    <div class="info-principal">
                        <div class="venda-icone">
                            <i data-lucide="clock"></i>
                        </div>
                        <div class="venda-detalhes">
                            <h4>${esc(venda.clientes?.nome || 'Cliente avulso')}</h4>
                            <p>${esc(venda.descricao || 'Sem descrição')}</p>
                            <span class="venda-data">${new Date(venda.data_venda || venda.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>
                    <div class="venda-financeiro">
                        <span class="venda-valor">R$ ${venda.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                        <div class="acoes" style="margin-top: 8px;">
                            <button data-acao="cobrar" data-id="${esc(venda.id)}" class="btn-acao" title="Cobrar via WhatsApp" style="color: #25D366;">
                                <i data-lucide="message-circle"></i>
                            </button>
                            <button data-acao="pago" data-id="${esc(venda.id)}" class="btn-acao btn-pago" title="Marcar como Recebido">
                                <i data-lucide="check"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (totalElemento) {
            totalElemento.textContent = `R$ ${somaPendentes.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        }

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar devedores:", err.message);
    }
}

// --- INICIALIZAÇÃO E EVENTOS ---

document.addEventListener("DOMContentLoaded", () => {
    delegate(document.getElementById('listaDevedores'), 'button[data-acao]', 'click', (e, botao) => {
        const venda = devedoresRenderizados.find(v => v.id === botao.dataset.id);
        if (!venda) return;
        if (botao.dataset.acao === 'cobrar') {
            window.enviarCobranca(venda.clientes?.telefone, venda.clientes?.nome, Number(venda.valor));
        } else if (botao.dataset.acao === 'pago') {
            window.marcarComoPago(venda.id);
        }
    });

    const filtroMesDevendo = document.getElementById("filtroMesDevendo");

    if (filtroMesDevendo) {
        // Define o mês atual como padrão se estiver vazio
        if (!filtroMesDevendo.value) {
            const agora = new Date();
            filtroMesDevendo.value = agora.toISOString().substring(0, 7);
        }

        // ADICIONA O OUVINTE DE MUDANÇA (Isso faz o filtro funcionar ao trocar o mês)
        filtroMesDevendo.addEventListener("change", () => {
            console.log("Recarregando devedores para o mês:", filtroMesDevendo.value);
            carregarDevedores();
        });
    }

    // Carrega a lista inicial
    carregarDevedores();
});

// Funções globais para os botões (Mantive as suas)
window.marcarComoPago = async (id) => {
    if (!confirm("Confirmar recebimento deste valor?")) return;
    try {
        const { error } = await supabase.from('vendas').update({ status: 'pago' }).eq('id', id);
        if (error) throw error;
        mostrarModal('Status atualizado!', 'A venda foi marcada como recebida.', 'sucesso');
        carregarDevedores();
    } catch (err) {
        mostrarModal('Erro ao atualizar', traduzirErro(err.message));
    }
};

window.enviarCobranca = (telefone, nome, valor) => {
    if (!telefone) return mostrarModal('Sem telefone', 'Cliente sem telefone cadastrado.', 'alerta');
    valor = Number(valor) || 0;
    const numero = telefone.replace(/\D/g, "");
    const msg = encodeURIComponent(`Olá ${nome}, tudo bem? Passando para lembrar do valor de R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})} pendente. Como prefere pagar?`);
    window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
};