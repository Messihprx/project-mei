import { supabase } from './auth.js';
import { esc, delegate, montarCsv, buscarTodasAsLinhas, dataVendaISO, formatarDataVenda } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirOpcaoConta, garantirContaPadrao } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';
import { criarEditorItens, resumoDosItens } from './itens-venda.js';
import { criarDataTable } from './datatable.js';

// Vendas da última renderização. Antes a descrição era injetada
// dentro de onclick="...('${venda.descricao}')", então uma venda
// como "Pao d'alho" quebrava o botão de editar.
let vendasRenderizadas = [];

// --- 1.5 CARREGAR CONTAS NO SELECT ---
async function popularSelectContasVendas() {
    const selects = document.querySelectorAll('#contaVenda, #editContaVenda');
    if (selects.length === 0) return;

    try {
        // Venda exige conta; garante o "Caixa do Negócio" se não houver nenhuma ativa
        await garantirContaPadrao();

        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('id, nome')
            .eq('user_id', user.id)
            .eq('ativo', true)
            .order('nome');

        if (error) throw error;

        const options = (contas || []).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');

        selects.forEach(sel => {
            sel.innerHTML = '<option value="" disabled selected>Selecione a conta</option>' + options;
            montarSelectBusca(sel, { placeholder: 'Buscar conta...' });
        });
    } catch (err) {
        console.error("Erro ao carregar contas:", err.message);
    }
}

async function popularSelectContasFiltro(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        // Lista também contas inativadas: o histórico de vendas da conta
        // inativada continua consultável pelo filtro (RF113/RF115).
        const { data: contas } = await supabase
            .from('contas').select('id, nome, ativo')
            .eq('user_id', user.id).order('nome');
        select.innerHTML = '<option value="">Todas as contas</option>' +
            (contas || []).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');
    } catch (err) {
        console.error("Erro ao carregar filtro de contas:", err.message);
    }
}

// --- 2. LISTA DE ITENS NO CARD (resumo p/ exibição e busca textual) ---
function resumoCardItens(venda) {
    const itens = venda.venda_itens || [];
    if (itens.length === 0) return '';
    if (itens.length === 1) {
        const it = itens[0];
        const qtd = Number(it.quantidade) || 1;
        return qtd > 1 ? `${qtd}x ${it.descricao}` : it.descricao;
    }
    return `${itens.length} itens · ${resumoDosItens(itens)}`;
}

// --- 3. FUNÇÃO MESTRE PARA LISTAR VENDAS (COM FILTRO REAL) ---
let tabelaVendas = null;

function montarTabelaVendas(container) {
    tabelaVendas = criarDataTable({
        container,
        idLinha: (venda) => venda.id,
        porPagina: 10,
        placeholderBusca: 'Buscar por cliente, descrição ou item...',
        textoVazio: 'Nenhuma venda encontrada para este período.',
        ordenacaoInicial: { coluna: 'data', direcao: 'desc' },
        filtros: [
            {
                id: 'status',
                rotulo: 'Status',
                opcoes: [
                    { valor: '', texto: 'Todos' },
                    { valor: 'pago', texto: 'Pago' },
                    { valor: 'pendente', texto: 'Pendente' },
                ],
                testar: (venda, valor) => venda.status === valor,
            },
        ],
        colunas: [
            {
                id: 'data',
                titulo: 'Data',
                valor: (venda) => formatarDataVenda(venda.data_venda || venda.created_at),
                ordenarPor: (venda) => dataVendaISO(venda.data_venda || venda.created_at),
                classe: 'dt-col-data',
            },
            {
                id: 'cliente',
                titulo: 'Cliente',
                valor: (venda) => venda.clientes?.nome || 'Cliente avulso',
                render: (venda) => {
                    const nome = venda.clientes?.nome || 'Cliente avulso';
                    return `<div class="dt-celula-principal">
                        <span class="dt-avatar">${esc(nome.charAt(0).toUpperCase())}</span>
                        <span class="dt-nome">${esc(nome)}</span>
                    </div>`;
                },
            },
            {
                id: 'descricao',
                titulo: 'Serviço / Itens',
                valor: (venda) => `${venda.descricao || 'Serviço Geral'} ${resumoCardItens(venda)}`,
                render: (venda) => {
                    const resumo = resumoCardItens(venda);
                    const descricao = venda.descricao || 'Serviço Geral';
                    return `<div class="dt-celula-texto">
                        <span class="dt-nome">${esc(descricao)}</span>
                        ${resumo && resumo !== descricao ? `<span class="dt-sub">${esc(resumo)}</span>` : ''}
                    </div>`;
                },
            },
            {
                id: 'conta',
                titulo: 'Conta',
                valor: (venda) => venda.contas?.nome || '',
                render: (venda) => `<span class="dt-sub" style="margin-top:0;">${esc(venda.contas?.nome || '—')}</span>`,
            },
            {
                id: 'valor',
                titulo: 'Valor',
                alinhamento: 'right',
                valor: (venda) => Number(venda.valor || 0),
                ordenarPor: (venda) => Number(venda.valor || 0),
                buscaTexto: (venda) => `R$ ${Number(venda.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                render: (venda) => `<span class="dt-valor pos">R$ ${Number(venda.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>`,
            },
            {
                id: 'status',
                titulo: 'Status',
                alinhamento: 'center',
                valor: (venda) => venda.status || '',
                render: (venda) => `<span class="badge-status ${esc(venda.status || '')}">${esc((venda.status || '').toUpperCase())}</span>`,
            },
            {
                id: 'acoes',
                titulo: '',
                ordenavel: false,
                busca: false,
                alinhamento: 'right',
                render: (venda) => {
                    const pendente = venda.status === 'pendente';
                    return `<div class="dt-acoes-menu">
                        <button type="button" class="btn-acao btn-acao-dots" data-menu-toggle="${esc(venda.id)}" title="Ações" aria-haspopup="true" aria-expanded="false">
                            <i data-lucide="more-vertical"></i>
                        </button>
                        <div class="dt-dropdown-acoes" data-menu-id="${esc(venda.id)}" hidden>
                            <button type="button" class="dt-dropdown-item" data-acao="ver" data-id="${esc(venda.id)}">
                                <i data-lucide="eye"></i> <span>Ver venda</span>
                            </button>
                            ${pendente ? `
                                <button type="button" class="dt-dropdown-item is-success" data-acao="pago" data-id="${esc(venda.id)}">
                                    <i data-lucide="check-circle-2"></i> <span>Marcar como pago</span>
                                </button>
                                <button type="button" class="dt-dropdown-item is-whatsapp" data-acao="cobrar" data-id="${esc(venda.id)}">
                                    <i data-lucide="message-circle"></i> <span>Cobrar pelo WhatsApp</span>
                                </button>
                            ` : ''}
                            <button type="button" class="dt-dropdown-item" data-acao="comprovante" data-id="${esc(venda.id)}">
                                <i data-lucide="receipt"></i> <span>Gerar comprovante</span>
                            </button>
                            <button type="button" class="dt-dropdown-item" data-acao="editar" data-id="${esc(venda.id)}">
                                <i data-lucide="edit-3"></i> <span>Editar</span>
                            </button>
                            <div class="dt-dropdown-divider"></div>
                            <button type="button" class="dt-dropdown-item is-danger" data-acao="excluir" data-id="${esc(venda.id)}">
                                <i data-lucide="trash-2"></i> <span>Excluir</span>
                            </button>
                        </div>
                    </div>`;
                },
            },
        ],
    });
}

async function carregarVendas() {
    const container = document.getElementById("listaVendas");
    const filtroMesInput = document.getElementById("filtroMesVendas");
    const filtroContaInput = document.getElementById("filtroContaVendas");

    if (!container) return;

    if (!tabelaVendas) {
        container.innerHTML = '<p class="dt-carregando">Carregando vendas...</p>';
    }

    try {
        const vendas = await buscarTodasAsLinhas((inicio, fim) => {
            let query = supabase
                .from('vendas')
                .select('id, descricao, valor, status, data_venda, created_at, cliente_id, clientes(nome, telefone), conta_id, contas(nome), venda_itens(descricao, quantidade, valor_unit, produto_id)')
                .order('data_venda', { ascending: false })
                .order('id', { ascending: true });

            if (filtroMesInput && filtroMesInput.value) {
                const [ano, mes] = filtroMesInput.value.split('-');
                const primeiroDia = `${ano}-${mes}-01T00:00:00Z`;
                const ultimoDia = new Date(ano, mes, 0).toISOString().replace(/T.*$/, 'T23:59:59Z');
                query = query.gte('data_venda', primeiroDia).lte('data_venda', ultimoDia);
            }

            if (filtroContaInput && filtroContaInput.value) {
                query = query.eq('conta_id', filtroContaInput.value);
            }

            return query.range(inicio, fim);
        });

        vendasRenderizadas = vendas;

        if (!tabelaVendas) montarTabelaVendas(container);
        tabelaVendas.atualizar(vendas);

        atualizarCardsVendas(vendas);

    } catch (err) {
        console.error("Erro ao carregar vendas:", err.message);
        if (!tabelaVendas) {
            container.innerHTML = `<p style="color:red">Erro ao carregar dados.</p>`;
        } else {
            mostrarModal('Erro ao carregar', 'Não foi possível carregar as vendas. Tente novamente.', 'alerta');
        }
    }
}

// --- CARDS INFORMATIVOS VENDAS ---
function atualizarCardsVendas(vendas) {
    const vendasPagas = vendas.filter((v) => (v.status || '').toLowerCase() !== 'pendente');
    const total = vendasPagas.reduce((s, v) => s + Number(v.valor || 0), 0);
    const qtdPagas = vendasPagas.length;
    const ticketMedio = qtdPagas > 0 ? total / qtdPagas : 0;
    const pendentes = vendas
        .filter((v) => (v.status || '').toLowerCase() === 'pendente')
        .reduce((s, v) => s + Number(v.valor || 0), 0);
    const qtdPendentes = vendas.filter((v) => (v.status || '').toLowerCase() === 'pendente').length;
    const totalBruto = total + pendentes;

    const elTotal = document.getElementById("cardTotalVendas");
    const elQtd = document.getElementById("cardQtdVendas");
    const elTicket = document.getElementById("cardTicketVendas");
    const elPend = document.getElementById("cardPendentesVendas");
    const elSubTotal = document.getElementById("cardSubVendas");
    const elSubQtd = document.getElementById("cardSubQtdVendas");
    const elSubTicket = document.getElementById("cardSubTicketVendas");
    const elSubPend = document.getElementById("cardSubPendentesVendas");

    if (elTotal) elTotal.textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elQtd) elQtd.textContent = qtdPagas.toLocaleString('pt-BR');
    if (elTicket) elTicket.textContent = `R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elPend) elPend.textContent = `R$ ${pendentes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elSubTotal) elSubTotal.textContent = qtdPagas > 0 ? `média de R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por venda paga` : 'Sem vendas pagas no período';
    if (elSubQtd) elSubQtd.textContent = qtdPagas === 1 ? '1 venda paga registrada' : `${qtdPagas} vendas pagas registradas`;
    if (elSubTicket) elSubTicket.textContent = pendentes > 0 ? `R$ ${pendentes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a receber` : 'Tudo recebido';
    if (elSubPend) elSubPend.textContent = totalBruto > 0 ? `${Math.round((pendentes / totalBruto) * 100)}% do total ainda está pendente` : 'Sem vendas no período';
}

// --- 4. CONSTRUTOR DE ITENS DO MODAL DE EDIÇÃO ---
const editorItensEdicao = criarEditorItens({
    listaEl: document.getElementById("editListaItens"),
    totalEl: document.getElementById("editTotalItens"),
    inputBusca: document.getElementById("editItemProdutoInput"),
    btnAddProduto: document.getElementById("btnEditAddProduto"),
    btnAddAvulso: document.getElementById("btnEditAddAvulso")
});

let produtosParaEdicao = null;
async function carregarProdutosParaEdicao() {
    if (produtosParaEdicao) return produtosParaEdicao;
    try {
        const { data } = await supabase.from('produtos').select('id, nome, valor').order('nome');
        produtosParaEdicao = data || [];
        editorItensEdicao.setProdutos(produtosParaEdicao);
    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
        produtosParaEdicao = [];
    }
    return produtosParaEdicao;
}

// --- 5. FUNÇÕES DE EDIÇÃO E EXCLUSÃO (WINDOW) ---
window.abrirModalEditarVenda = async (venda) => {
    document.getElementById("editVendaId").value = venda.id;
    document.getElementById("editServicoVenda").value = venda.descricao || '';
    document.getElementById("editStatusVenda").value = venda.status;
    // HTML antigo em cache pode não ter o campo; nesse caso a data
    // da venda fica como está (data_venda ausente no update).
    const campoData = document.getElementById("editDataVenda");
    if (campoData) campoData.value = dataVendaISO(venda.data_venda || venda.created_at || '');

    // Itens da venda (busca da lista já traz; fallback: query pontual)
    await carregarProdutosParaEdicao();
    let itens = venda.venda_itens;
    if (!itens || itens.length === 0) {
        const { data } = await supabase.from('venda_itens')
            .select('produto_id, descricao, quantidade, valor_unit')
            .eq('venda_id', venda.id);
        itens = data || [];
    }
    editorItensEdicao.setItens(itens);

    // Se a conta vinculada está inativada, injeta a opção no select
    // antes de setar o value — senão o salvar desvinculava a venda.
    const selConta = document.getElementById("editContaVenda");
    await garantirOpcaoConta(selConta, venda.conta_id);
    if (selConta?._selectBusca) {
        const opcoes = [...selConta.querySelectorAll('option')]
            .map(o => ({ valor: o.value, texto: o.textContent.trim() }))
            .filter(o => o.valor);
        selConta._selectBusca.setOpcoes(opcoes);
        selConta._selectBusca.setValor(venda.conta_id || '');
    } else if (selConta) {
        selConta.value = venda.conta_id || '';
    }
    document.getElementById("modalEditarVenda").style.display = "flex";
    if (window.lucide) lucide.createIcons();
};

window.fecharModalEditarVenda = () => {
    document.getElementById("modalEditarVenda").style.display = "none";
};

function fecharMenusAcoes() {
    document.querySelectorAll('.dt-dropdown-acoes:not([hidden])').forEach(menu => {
        menu.hidden = true;
    });
    document.querySelectorAll('.btn-acao-dots[aria-expanded="true"]').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
    });
}

window.fecharModalVerVenda = () => {
    const modal = document.getElementById("modalVerVenda");
    if (modal) modal.style.display = "none";
};

window.abrirModalVerVenda = async (venda) => {
    const modal = document.getElementById("modalVerVenda");
    if (!modal) return;

    const valorNum = Number(venda.valor || 0);
    const status = String(venda.status || 'pago').toLowerCase();
    const isPendente = status === 'pendente';

    document.getElementById("verVendaValor").textContent = `R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const badgeEl = document.getElementById("verVendaStatusBadge");
    badgeEl.textContent = status.toUpperCase();
    badgeEl.className = `badge-status ${status}`;

    document.getElementById("verVendaCliente").textContent = venda.clientes?.nome || 'Cliente avulso';
    document.getElementById("verVendaTelefone").textContent = venda.clientes?.telefone || '';
    document.getElementById("verVendaData").textContent = formatarDataVenda(venda.data_venda || venda.created_at);
    document.getElementById("verVendaConta").textContent = venda.contas?.nome || '—';
    document.getElementById("verVendaDescricao").textContent = venda.descricao || 'Serviço Geral';

    let itens = venda.venda_itens || [];
    if (itens.length === 0) {
        try {
            const { data } = await supabase
                .from('venda_itens')
                .select('descricao, quantidade, valor_unit')
                .eq('venda_id', venda.id);
            itens = data || [];
        } catch { itens = []; }
    }

    const listaItensEl = document.getElementById("verVendaListaItens");
    if (itens.length > 0) {
        listaItensEl.innerHTML = itens.map(it => {
            const qtd = Number(it.quantidade) || 1;
            const unit = Number(it.valor_unit || 0);
            const sub = qtd * unit;
            return `
                <div class="ver-venda-item-row">
                    <div class="ver-venda-item-info">
                        <span class="ver-venda-item-nome">${esc(it.descricao || 'Item')}</span>
                        <span class="ver-venda-item-qtd">${qtd}x R$ ${unit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <strong class="ver-venda-item-sub">R$ ${sub.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </div>
            `;
        }).join('');
    } else {
        listaItensEl.innerHTML = `
            <div class="ver-venda-item-row">
                <div class="ver-venda-item-info">
                    <span class="ver-venda-item-nome">${esc(venda.descricao || 'Serviço Geral')}</span>
                    <span class="ver-venda-item-qtd">1x</span>
                </div>
                <strong class="ver-venda-item-sub">R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
        `;
    }

    const acoesEl = document.getElementById("verVendaAcoes");
    acoesEl.innerHTML = `
        ${isPendente ? `
            <button type="button" class="btn-ver-venda-wpp" id="btnVerVendaCobrar">
                <i data-lucide="message-circle"></i> Cobrar WhatsApp
            </button>
            <button type="button" class="btn-ver-venda-pago" id="btnVerVendaPago">
                <i data-lucide="check-circle-2"></i> Marcar como pago
            </button>
        ` : `
            <button type="button" class="btn-secondary" id="btnVerVendaComprovante">
                <i data-lucide="receipt"></i> Comprovante
            </button>
        `}
        <button type="button" class="btn-primary" onclick="fecharModalVerVenda()" style="width:auto; padding:0.6rem 1.2rem;">
            Fechar
        </button>
    `;

    document.getElementById("btnVerVendaComprovante")?.addEventListener("click", () => {
        window.gerarComprovante(venda);
    });
    document.getElementById("btnVerVendaCobrar")?.addEventListener("click", () => {
        window.enviarCobranca(venda.clientes?.telefone, venda.clientes?.nome || 'Cliente', valorNum);
    });
    document.getElementById("btnVerVendaPago")?.addEventListener("click", async () => {
        await window.marcarComoPago(venda.id);
        window.fecharModalVerVenda();
    });

    modal.style.display = "flex";
    if (window.lucide) lucide.createIcons();
};

window.marcarComoPago = async (id) => {
    const confirmed = await confirmModal("Confirmar recebimento", "Confirmar que esta venda foi paga?");
    if (!confirmed) return;
    try {
        const { data: venda } = await supabase
            .from('vendas')
            .select('conta_id, valor, status')
            .eq('id', id)
            .single();

        const { error } = await supabase.from('vendas').update({ status: 'pago' }).eq('id', id);
        if (error) throw error;

        if (venda?.conta_id) {
            const delta = calcDeltaVenda(venda.valor, 'pago', 'editar', venda.valor, venda.status);
            if (delta !== 0) await atualizarSaldoConta(venda.conta_id, delta);
        }
        invalidarCachePlano();
        mostrarModal('Status atualizado!', 'A venda foi marcada como recebida.', 'sucesso');
        carregarVendas();
    } catch (err) {
        mostrarModal('Erro ao atualizar', traduzirErro(err.message));
    }
};

window.enviarCobranca = (telefone, nome, valor) => {
    if (!telefone) return mostrarModal('Sem telefone', 'Cliente sem telefone cadastrado.', 'alerta');
    const valorNum = Number(valor) || 0;
    const numero = String(telefone).replace(/\D/g, "");
    const msg = encodeURIComponent(`Olá ${nome || 'cliente'}, tudo bem? Passando para lembrar do valor de R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} pendente. Como prefere pagar?`);
    window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
};

window.deletarVenda = async (id) => {
    const confirmed = await confirmModal("Excluir venda", "Tem certeza que deseja excluir esta venda? Essa ação não pode ser desfeita.");
    if (!confirmed) return;
    try {
        const { data: venda } = await supabase.from('vendas').select('conta_id, valor, status').eq('id', id).single();
        const { error } = await supabase.from('vendas').delete().eq('id', id);
        if (error) throw error;
        if (venda?.conta_id) {
            const delta = calcDeltaVenda(venda.valor, venda.status, 'excluir');
            if (delta !== 0) await atualizarSaldoConta(venda.conta_id, delta);
        }
        invalidarCachePlano();
        carregarVendas();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

window.gerarComprovante = async (venda) => {
    const status = String(venda.status || 'pago').toLowerCase();
    if (status === 'pendente') {
        mostrarModal('Venda pendente', 'Esta venda ainda não foi paga. Não há comprovante de pagamento para gerar. Marque-a como recebida primeiro.', 'alerta');
        return;
    }

    const itens = venda.venda_itens || [];
    const itensHtml = itens.length
        ? itens.map(it => `<tr>
            <td>${esc(it.descricao || '-')}</td>
            <td style="text-align:center;">${Number(it.quantidade) || 1}</td>
            <td style="text-align:right;">R$ ${Number(it.valor_unit || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td style="text-align:right;">R$ ${(Number(it.quantidade || 1) * Number(it.valor_unit || 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
        </tr>`).join('')
        : `<tr><td colspan="4">${esc(venda.descricao || 'Serviço geral')}</td></tr>`;

    // Busca dados do perfil do usuário logado (se houver)
    let perfil = {};
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: perfilData } = await supabase
                .from('perfis')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle();
            if (perfilData) perfil = perfilData;
        }
    } catch (_) { /* perfil opcional */ }

    // Formatação de dados para exibição
    const formatarCPF = (cpf) => {
        if (!cpf) return '';
        const d = cpf.replace(/\D/g, '');
        return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}` : cpf;
    };
    const formatarCNPJ = (cnpj) => {
        if (!cnpj) return '';
        const d = cnpj.replace(/\D/g, '');
        return d.length === 14 ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}` : cnpj;
    };
    const formatarCEP = (cep) => {
        if (!cep) return '';
        const d = cep.replace(/\D/g, '');
        return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5,8)}` : cep;
    };

    const nomeEmissor = perfil.nome_completo || '';
    const nomeFantasia = perfil.nome_fantasia || perfil.razao_social || '';
    const cnpjFormatado = formatarCNPJ(perfil.cnpj);
    const cpfFormatado = formatarCPF(perfil.cpf);
    const endereco = [perfil.logradouro, perfil.numero, perfil.complemento, perfil.bairro, perfil.cidade, perfil.estado]
        .filter(Boolean).join(', ');
    const telefoneEmissor = perfil.celular || perfil.telefone || '';
    const chavePix = perfil.chave_pix || '';

    const html = `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"><title>Comprovante de Pagamento</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;padding:32px 16px;color:#0f172a;}
  .box{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);overflow:hidden;}
  .header{background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:28px 32px;text-align:center;}
  .header .logo{font-size:1.6rem;font-weight:800;letter-spacing:-.5px;}
  .header .sub{opacity:.85;font-size:.85rem;margin-top:4px;}
  .body{padding:28px 32px;}
  .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #e2e8f0;}
  .row:last-child{border-bottom:none;}
  .label{color:#64748b;font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;}
  .value{font-weight:600;font-size:.95rem;}
  .badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:.75rem;font-weight:700;}
  .pago{background:#dcfce7;color:#16a34a;}
  .pendente{background:#fee2e2;color:#dc2626;}
  table{width:100%;border-collapse:collapse;margin:16px 0;}
  th{background:#f8fafc;padding:10px 8px;text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:2px solid #e2e8f0;}
  td{padding:10px 8px;font-size:.85rem;border-bottom:1px solid #f1f5f9;}
  tr:last-child td{border-bottom:none;}
  .tot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:2px solid #e2e8f0;}
  .tot span:first-child{font-size:.9rem;color:#64748b;font-weight:600;}
  .tot span:last-child{font-size:1.4rem;font-weight:800;color:#3b82f6;}
  .footer{background:#f8fafc;padding:16px 32px;text-align:center;font-size:.7rem;color:#94a3b8;}
  .footer strong{color:#64748b;}
  .emitente{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-top:20px;}
  .emitente h5{font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:10px;}
  .emitente .row{padding:6px 0;}
  @media print{body{background:#fff;padding:0;}.box{box-shadow:none;border-radius:0;}}
</style></head><body>
<div class="box">
  <div class="header">
    <div class="logo">finMEI</div>
    <div class="sub">Comprovante de Pagamento</div>
  </div>
  <div class="body">
    ${nomeFantasia || cnpjFormatado || cpfFormatado || nomeEmissor ? `
    <div class="emitente">
      <h5>Emitente</h5>
      ${nomeFantasia ? `<div class="row"><span class="label">Nome fantasia</span><span class="value">${esc(nomeFantasia)}</span></div>` : ''}
      ${nomeEmissor ? `<div class="row"><span class="label">Responsável</span><span class="value">${esc(nomeEmissor)}</span></div>` : ''}
      ${cnpjFormatado ? `<div class="row"><span class="label">CNPJ</span><span class="value">${esc(cnpjFormatado)}</span></div>` : ''}
      ${cpfFormatado ? `<div class="row"><span class="label">CPF</span><span class="value">${esc(cpfFormatado)}</span></div>` : ''}
      ${endereco ? `<div class="row"><span class="label">Endereço</span><span class="value">${esc(endereco)}</span></div>` : ''}
      ${telefoneEmissor ? `<div class="row"><span class="label">Telefone</span><span class="value">${esc(telefoneEmissor)}</span></div>` : ''}
      ${chavePix ? `<div class="row"><span class="label">Chave Pix</span><span class="value">${esc(chavePix)}</span></div>` : ''}
    </div>
    ` : ''}
    <div class="row"><span class="label">Cliente</span><span class="value">${esc(venda.clientes?.nome || 'Cliente avulso')}</span></div>
    <div class="row"><span class="label">Data da venda</span><span class="value">${esc(formatarDataVenda(venda.data_venda || venda.created_at))}</span></div>
    <div class="row"><span class="label">Status</span><span class="badge ${esc(venda.status)}">${esc((venda.status || '').toUpperCase())}</span></div>
    <table>
      <thead><tr><th>Descrição</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Unit.</th><th style="text-align:right;">Subtotal</th></tr></thead>
      <tbody>${itensHtml}</tbody>
    </table>
    <div class="tot"><span>Total</span><span>R$ ${parseFloat(venda.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
  </div>
  <div class="footer">Gerado pelo <strong>FinMEI</strong> em ${new Date().toLocaleDateString('pt-BR')} · Documento sem valor fiscal</div>
</div>
<script>window.onload=()=>{window.print();};</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else { mostrarModal('Bloqueado', 'Permita pop-ups para gerar o comprovante.', 'alerta'); }
};

// --- 6. SUBMIT DA EDIÇÃO ---
import { protegerAcao, verificarStatusPlano, invalidarCachePlano } from './planos.js';

const formEditarVenda = document.getElementById("formEditarVenda");
if (formEditarVenda) {
    protegerAcao("formEditarVenda", "movimentacao");
    formEditarVenda.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        if (await protegerAcao("formEditarVenda", "movimentacao")) return;

        const id = document.getElementById("editVendaId").value;
        const btn = formEditarVenda.querySelector('button[type="submit"]') || formEditarVenda.querySelector('button');

        const dataEscolhida = document.getElementById("editDataVenda")?.value;
        const contaId = document.getElementById("editContaVenda").value;
        const itens = editorItensEdicao.getItens();

        if (!contaId) {
            mostrarModal('Conta obrigatória', 'Selecione a conta financeira desta venda.', 'alerta');
            return;
        }
        if (itens.length === 0 || !editorItensEdicao.validar()) {
            mostrarModal('Itens incompletos', 'A venda precisa de ao menos um item válido (descrição e quantidade).', 'alerta');
            return;
        }

        const titulo = document.getElementById("editServicoVenda").value.trim();
        const novoValor = editorItensEdicao.total();
        const descricao = titulo || resumoDosItens(itens);
        const produtoUnico = itens.length === 1 && itens[0].produto_id ? itens[0].produto_id : null;

        const dadosAtualizados = {
            descricao,
            valor: novoValor,
            produto_id: produtoUnico,
            status: document.getElementById("editStatusVenda").value,
            conta_id: contaId,
            data_venda: dataEscolhida ? `${dataEscolhida}T12:00:00Z` : undefined
        };

        try {
            btn.disabled = true;
            btn.innerText = "Atualizando...";

            const { data: vendaAntiga } = await supabase.from('vendas').select('conta_id, valor, status').eq('id', id).single();

            const { error } = await supabase
                .from('vendas')
                .update(dadosAtualizados)
                .eq('id', id);

            if (error) throw error;

            // Substitui os itens (delete + insert; RLS do usuário)
            const { error: erroDel } = await supabase.from('venda_itens').delete().eq('venda_id', id);
            if (erroDel) throw erroDel;

            const { data: { user } } = await supabase.auth.getUser();
            const { error: erroItens } = await supabase.from('venda_itens').insert(
                itens.map(it => ({
                    user_id: user.id,
                    venda_id: id,
                    produto_id: it.produto_id || null,
                    descricao: it.descricao.trim(),
                    quantidade: Number(it.quantidade) || 1,
                    valor_unit: Number(it.valor_unit) || 0
                }))
            );
            if (erroItens) throw erroItens;

            if (vendaAntiga) {
                const delta = calcDeltaVenda(dadosAtualizados.valor, dadosAtualizados.status, 'editar', vendaAntiga.valor, vendaAntiga.status);
                if (delta !== 0) {
                    const contaAlvo = dadosAtualizados.conta_id || vendaAntiga.conta_id;
                    if (contaAlvo) await atualizarSaldoConta(contaAlvo, delta);
                }
            }
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            fecharModalEditarVenda();
            carregarVendas();
        } catch (err) {
            mostrarModal('Erro ao atualizar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Salvar Alterações";
        }
    });
}


// --- 7. INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", () => {
    const listaVendasEl = document.getElementById('listaVendas');

    // Abre/fecha menu de 3 pontinhos posicionado sem clipping do container da tabela
    delegate(listaVendasEl, 'button[data-menu-toggle]', 'click', (e, botao) => {
        e.stopPropagation();
        const id = botao.dataset.menuToggle;
        const menu = listaVendasEl.querySelector(`.dt-dropdown-acoes[data-menu-id="${CSS.escape(id)}"]`);
        if (!menu) return;

        const estavaAberto = !menu.hidden;
        fecharMenusAcoes();
        if (estavaAberto) return;

        menu.hidden = false;
        botao.setAttribute('aria-expanded', 'true');

        const rect = botao.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= menuRect.height + 10
            ? rect.bottom + 6
            : Math.max(8, rect.top - menuRect.height - 6);
        const left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    });

    // Delegação das ações dentro do menu de 3 pontinhos
    delegate(listaVendasEl, 'button[data-acao]', 'click', (e, botao) => {
        e.stopPropagation();
        fecharMenusAcoes();
        const venda = vendasRenderizadas.find(v => v.id === botao.dataset.id);
        if (!venda) return;
        const acao = botao.dataset.acao;
        if (acao === 'ver') {
            window.abrirModalVerVenda(venda);
        } else if (acao === 'pago') {
            window.marcarComoPago(venda.id);
        } else if (acao === 'cobrar') {
            window.enviarCobranca(venda.clientes?.telefone, venda.clientes?.nome || 'Cliente', Number(venda.valor));
        } else if (acao === 'comprovante') {
            window.gerarComprovante(venda);
        } else if (acao === 'editar') {
            window.abrirModalEditarVenda(venda);
        } else if (acao === 'excluir') {
            window.deletarVenda(venda.id);
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dt-acoes-menu')) fecharMenusAcoes();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            fecharMenusAcoes();
            window.fecharModalVerVenda();
        }
    });
    window.addEventListener('scroll', fecharMenusAcoes, true);

    const modalVerVenda = document.getElementById('modalVerVenda');
    if (modalVerVenda) {
        modalVerVenda.addEventListener('click', (e) => {
            if (e.target === modalVerVenda) window.fecharModalVerVenda();
        });
    }

    const filtroMesVendas = document.getElementById("filtroMesVendas");

    if (filtroMesVendas) {
        if (!filtroMesVendas.value) {
            const agora = new Date();
            filtroMesVendas.value = agora.toISOString().substring(0, 7);
        }
        filtroMesVendas.addEventListener("change", () => carregarVendas());
    }

    carregarVendas();
    popularSelectContasVendas();

    // Filtro por conta
    const filtroContaVendas = document.getElementById("filtroContaVendas");
    if (filtroContaVendas) {
        popularSelectContasFiltro('filtroContaVendas');
        filtroContaVendas.addEventListener("change", () => carregarVendas());
    }

    // --- 8. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarVendas");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                mostrarModal('Recurso Premium', 'A exportação de relatórios detalhados é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos"; }, 2000);
                return;
            }

            const mesSel = document.getElementById("filtroMesVendas").value;
            const [ano, mes] = mesSel.split('-');
            const ultimoDia = new Date(ano, mes, 0).getDate();
            const dataInicio = `${ano}-${mes}-01T00:00:00`;
            const dataFim = `${ano}-${mes}-${ultimoDia}T23:59:59`;

            btnExport.disabled = true;
            btnExport.innerText = "Exportando...";

            try {
                const { data: vendas, error } = await supabase
                    .from('vendas')
                    .select('*, clientes(nome), venda_itens(descricao, quantidade, valor_unit)')
                    .gte('data_venda', dataInicio)
                    .lte('data_venda', dataFim)
                    .order('data_venda', { ascending: false });

                if (error) throw error;

                if (!vendas || vendas.length === 0) {
                    mostrarModal('Nenhuma venda', 'Nenhuma venda encontrada para exportar neste mês.', 'alerta');
                    return;
                }

                // Gerar CSV. Duas correções aqui:
                //  - a coluna era v.servico, que não existe na tabela
                //    (o campo é descricao) e saía "undefined" no arquivo;
                //  - montarCsv neutraliza células que o Excel leria como
                //    fórmula (= + - @).
                const csv = montarCsv(
                    ["Data", "Cliente", "Servico", "Itens", "Valor", "Status"],
                    vendas.map(v => [
                        formatarDataVenda(v.data_venda || v.created_at),
                        v.clientes ? v.clientes.nome : 'N/A',
                        v.descricao || '',
                        (v.venda_itens || [])
                            .map(it => `${Number(it.quantidade) || 1}x ${it.descricao} (${Number(it.valor_unit || 0).toFixed(2).replace('.', ',')})`)
                            .join('; '),
                        Number(v.valor || 0).toFixed(2).replace('.', ','),
                        v.status || ''
                    ])
                );

                const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Vendas_${mesSel}.csv`;
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
