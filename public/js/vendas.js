import { supabase } from './auth.js';
import { esc, delegate, montarCsv, TAMANHO_PAGINA, botaoCarregarMais, dataVendaISO, formatarDataVenda } from './dom-utils.js';
import { atualizarSaldoConta, calcDeltaVenda, garantirOpcaoConta, garantirContaPadrao } from './conta-saldo.js';
import { montarSelectBusca } from './select-busca.js';
import { criarEditorItens, resumoDosItens } from './itens-venda.js';

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
let limiteVendas = TAMANHO_PAGINA;

async function carregarVendas(limite = limiteVendas) {
    limiteVendas = limite;
    const container = document.getElementById("listaVendas");
    const filtroMesInput = document.getElementById("filtroMesVendas"); 
    const filtroContaInput = document.getElementById("filtroContaVendas");
    
    if (!container) return;

    try {
        let query = supabase
            .from('vendas')
            .select('id, descricao, valor, status, data_venda, cliente_id, clientes(nome), conta_id, venda_itens(descricao, quantidade, valor_unit, produto_id)')
            .order('data_venda', { ascending: false })
            .limit(limite);

        if (filtroMesInput && filtroMesInput.value) {
            const [ano, mes] = filtroMesInput.value.split('-');
            const primeiroDia = `${ano}-${mes}-01T00:00:00Z`;
            const ultimoDia = new Date(ano, mes, 0).toISOString().replace(/T.*$/, 'T23:59:59Z');
            query = query.gte('data_venda', primeiroDia).lte('data_venda', ultimoDia);
        }

        if (filtroContaInput && filtroContaInput.value) {
            query = query.eq('conta_id', filtroContaInput.value);
        }

        const { data: vendas, error } = await query;
        if (error) throw error;

        if (vendas.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">Nenhuma venda encontrada para este período.</p>`;
            return;
        }

        vendasRenderizadas = vendas;

        container.innerHTML = vendas.map(venda => {
            const resumoItens = resumoCardItens(venda);
            return `
            <div class="card-venda-premium ${esc(venda.status)}">
                <div class="venda-frente">
                    <div class="venda-icone">
                        <i data-lucide="${venda.status === 'pago' ? 'check-circle' : 'clock'}"></i>
                    </div>
                    <div class="venda-detalhes">
                        <h4>${esc(venda.clientes?.nome || 'Cliente avulso')}</h4>
                        <p>${esc(venda.descricao || 'Serviço Geral')}</p>
                        ${resumoItens && resumoItens !== venda.descricao ? `<p class="venda-itens-resumo">${esc(resumoItens)}</p>` : ''}
                        <span class="venda-data">${formatarDataVenda(venda.data_venda || venda.created_at)}</span>
                    </div>
                </div>
                <div class="venda-financeiro">
                    <span class="venda-valor">R$ ${parseFloat(venda.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                    <span class="venda-badge">${esc((venda.status || "").toUpperCase())}</span>
                    
                    <div style="display:flex; gap:8px; justify-content: flex-end; margin-top:10px;">
                        <button data-acao="editar" data-id="${esc(venda.id)}" class="btn-acao" style="color: var(--cor-primaria);" title="Editar">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button data-acao="excluir" data-id="${esc(venda.id)}" class="btn-acao btn-delete" title="Excluir">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        }).join('');

        botaoCarregarMais(container, vendas.length, limite, carregarVendas);

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar vendas:", err.message);
        container.innerHTML = `<p style="color:red">Erro ao carregar dados.</p>`;
    }
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
    // Delegação no lugar dos onclick inline
    delegate(document.getElementById('listaVendas'), 'button[data-acao]', 'click', (e, botao) => {
        const venda = vendasRenderizadas.find(v => v.id === botao.dataset.id);
        if (!venda) return;
        if (botao.dataset.acao === 'editar') {
            window.abrirModalEditarVenda(venda);
        } else if (botao.dataset.acao === 'excluir') {
            window.deletarVenda(venda.id);
        }
    });

    const filtroMesVendas = document.getElementById("filtroMesVendas");

    if (filtroMesVendas) {
        if (!filtroMesVendas.value) {
            const agora = new Date();
            filtroMesVendas.value = agora.toISOString().substring(0, 7);
        }
        filtroMesVendas.addEventListener("change", () => carregarVendas(TAMANHO_PAGINA));
    }

    const inputBusca = document.getElementById("buscarVenda");
    if (inputBusca) {
        inputBusca.addEventListener("input", (e) => {
            const termo = e.target.value.toLowerCase().trim();
            const itens = document.querySelectorAll(".card-venda-premium");
            itens.forEach(item => {
                const texto = item.innerText.toLowerCase();
                item.style.display = texto.includes(termo) ? "flex" : "none";
            });
        });
    }

    carregarVendas();
    popularSelectContasVendas();

    // Filtro por conta
    const filtroContaVendas = document.getElementById("filtroContaVendas");
    if (filtroContaVendas) {
        popularSelectContasFiltro('filtroContaVendas');
        filtroContaVendas.addEventListener("change", () => carregarVendas(TAMANHO_PAGINA));
    }

    // --- 8. EXPORTAÇÃO PARA CSV (PREMIUM) ---
    const btnExport = document.getElementById("btnExportarVendas");
    if (btnExport) {
        btnExport.addEventListener("click", async () => {
            const status = await verificarStatusPlano();
            if (!status.premium) {
                mostrarModal('Recurso Premium', 'A exportação de relatórios detalhados é um recurso exclusivo para assinantes Premium.', 'alerta');
                setTimeout(() => { window.location.href = "planos.html"; }, 2000);
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
