import { supabase } from './auth.js';
import { esc, delegate } from './dom-utils.js';
import { atualizarSaldoConta } from './conta-saldo.js';

const labelsTipo = {
    banco_pj: 'Banco PJ',
    banco_pf: 'Banco PF',
    poupanca: 'Poupança',
    caixa: 'Caixa',
    carteira_digital: 'Carteira Digital',
    outro: 'Outro'
};

const labelsFinalidade = {
    negocio: 'Negócio',
    pessoal: 'Pessoal',
    misto: 'Misto'
};

const iconsTipo = {
    banco_pj: 'building-2',
    banco_pf: 'landmark',
    poupanca: 'piggy-bank',
    caixa: 'wallet',
    carteira_digital: 'smartphone',
    outro: 'circle-dot'
};

// --- CARREGAR CONTAS ---
async function carregarContas() {
    const container = document.getElementById("listaContas");
    if (!container) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('*')
            .eq('user_id', user.id)
            .eq('ativo', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!contas || contas.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:3rem 1rem; color:var(--texto-secundario);">
                    <i data-lucide="wallet" style="width:48px; height:48px; margin-bottom:1rem; opacity:0.4;"></i>
                    <p style="font-size:0.95rem;">Nenhuma conta cadastrada.</p>
                    <p style="font-size:0.8rem; margin-top:0.5rem;">Clique em "Nova Conta" para começar.</p>
                </div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        container.innerHTML = contas.map(conta => {
            const saldo = parseFloat(conta.saldo_atual);
            const saldoClass = saldo >= 0 ? 'sucesso' : 'erro';
            const saldoFormatado = saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

            return `
                <div class="conta-card" data-id="${conta.id}">
                    <div class="conta-header">
                        <div class="conta-icone">
                            <i data-lucide="${iconsTipo[conta.tipo] || 'wallet'}"></i>
                        </div>
                        <div class="conta-info">
                            <h4>${esc(conta.nome)}</h4>
                            <span class="conta-meta">${esc(conta.instituicao || '')} ${conta.instituicao ? '•' : ''} ${labelsTipo[conta.tipo] || conta.tipo}</span>
                            <span class="conta-finalidade badge-${conta.finalidade}">${labelsFinalidade[conta.finalidade] || conta.finalidade}</span>
                        </div>
                        <div class="conta-saldo-area">
                            <span class="conta-saldo-label">Saldo Atual</span>
                            <span class="conta-saldo valor-${saldoClass}">R$ ${saldoFormatado}</span>
                        </div>
                    </div>
                    <div class="conta-acoes">
                        <button data-acao="movimentacoes" data-id="${conta.id}" data-nome="${esc(conta.nome)}" class="btn-acao" title="Ver Movimentações" style="color: var(--cor-sucesso);">
                            <i data-lucide="list"></i> Movimentações
                        </button>
                        <button data-acao="editar" data-id="${conta.id}" class="btn-acao" title="Editar">
                            <i data-lucide="edit-3"></i> Editar
                        </button>
                        <button data-acao="inativar" data-id="${conta.id}" data-nome="${esc(conta.nome)}" class="btn-acao" title="Inativar">
                            <i data-lucide="eye-off"></i> Inativar
                        </button>
                        <button data-acao="excluir" data-id="${conta.id}" data-nome="${esc(conta.nome)}" class="btn-acao btn-delete" title="Excluir permanentemente">
                            <i data-lucide="trash-2"></i> Excluir
                        </button>
                    </div>
                </div>`;
        }).join('');

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Erro ao carregar contas:", err.message);
        container.innerHTML = `<p style="color:red; text-align:center;">Erro ao carregar contas.</p>`;
    }
}

// --- CALCULAR SALDO CONSOLIDADO (RF106) ---
async function calcularSaldoConsolidado() {
    const el = document.getElementById("saldoConsolidado");
    if (!el) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('saldo_atual, finalidade')
            .eq('user_id', user.id)
            .eq('ativo', true);

        if (error) throw error;

        const total = (contas || [])
            .filter(c => c.finalidade === 'negocio' || c.finalidade === 'misto')
            .reduce((sum, c) => sum + parseFloat(c.saldo_atual || 0), 0);

        el.textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    } catch (err) {
        console.error("Erro ao calcular consolidado:", err);
    }
}

// --- SALVAR NOVA CONTA (RF100) ---
const formNovaConta = document.getElementById("formNovaConta");
if (formNovaConta) {
    formNovaConta.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = formNovaConta.querySelector('button[type="submit"]');

        const nome = document.getElementById("nomeConta").value.trim();
        const instituicao = document.getElementById("instituicaoConta").value.trim();
        const tipo = document.getElementById("tipoConta").value;
        const finalidade = document.getElementById("finalidadeConta").value;
        const saldoInicial = parseFloat(document.getElementById("saldoInicial").value) || 0;

        if (!nome) {
            mostrarModal('Nome obrigatório', 'Informe um nome para a conta.');
            return;
        }

        try {
            btn.disabled = true;
            btn.innerText = "Salvando...";

            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase.from('contas').insert([{
                user_id: user.id,
                nome: nome,
                instituicao: instituicao || null,
                tipo: tipo,
                finalidade: finalidade,
                saldo_inicial: saldoInicial,
                saldo_atual: saldoInicial
            }]);

            if (error) throw error;

            mostrarModal('Conta criada!', 'Sua conta foi cadastrada com sucesso.', 'sucesso');
            formNovaConta.reset();
            fecharModalNovaConta();
            carregarContas();
            calcularSaldoConsolidado();

        } catch (err) {
            mostrarModal('Erro ao salvar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Cadastrar Conta";
        }
    });
}

// --- MODAL NOVA CONTA ---
window.abrirModalNovaConta = function () {
    document.getElementById("modalNovaConta").style.display = "flex";
    document.getElementById("nomeConta").focus();
    if (window.lucide) lucide.createIcons();
};

window.fecharModalNovaConta = function () {
    document.getElementById("modalNovaConta").style.display = "none";
};

// --- EDITAR CONTA (RF112) ---
async function abrirEditarConta(id) {
    try {
        const { data, error } = await supabase.from('contas').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById("editContaId").value = data.id;
        document.getElementById("editNomeConta").value = data.nome;
        document.getElementById("editInstituicaoConta").value = data.instituicao || '';
        document.getElementById("editTipoConta").value = data.tipo;
        document.getElementById("editFinalidadeConta").value = data.finalidade;
        document.getElementById("editSaldoInicial").value = data.saldo_inicial;

        document.getElementById("modalEditarConta").style.display = "flex";
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        mostrarModal('Erro ao carregar dados', traduzirErro(err.message));
    }
}

window.fecharModalEditarConta = function () {
    document.getElementById("modalEditarConta").style.display = "none";
};

const formEditarConta = document.getElementById("formEditarConta");
if (formEditarConta) {
    formEditarConta.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = formEditarConta.querySelector('button[type="submit"]');
        const id = document.getElementById("editContaId").value;

        const nome = document.getElementById("editNomeConta").value.trim();
        const instituicao = document.getElementById("editInstituicaoConta").value.trim();
        const tipo = document.getElementById("editTipoConta").value;
        const finalidade = document.getElementById("editFinalidadeConta").value;
        const saldoInicial = parseFloat(document.getElementById("editSaldoInicial").value) || 0;

        if (!nome) {
            mostrarModal('Nome obrigatório', 'Informe um nome para a conta.');
            return;
        }

        try {
            btn.disabled = true;
            btn.innerText = "Salvando...";

            const { data: atual } = await supabase.from('contas').select('saldo_inicial, saldo_atual').eq('id', id).single();
            const diff = saldoInicial - (atual?.saldo_inicial || 0);
            const novoSaldo = (atual?.saldo_atual || 0) + diff;

            const { error } = await supabase.from('contas').update({
                nome: nome,
                instituicao: instituicao || null,
                tipo: tipo,
                finalidade: finalidade,
                saldo_inicial: saldoInicial,
                saldo_atual: novoSaldo,
                updated_at: new Date().toISOString()
            }).eq('id', id);

            if (error) throw error;

            fecharModalEditarConta();
            carregarContas();
            calcularSaldoConsolidado();
        } catch (err) {
            mostrarModal('Erro ao atualizar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Salvar Alterações";
        }
    });
}

// --- INATIVAR CONTA (RF113) ---
async function inativarConta(id, nome) {
    try {
        const [resVendas, resDespesas] = await Promise.all([
            supabase.from('vendas').select('id', { count: 'exact', head: true }).eq('conta_id', id),
            supabase.from('despesas').select('id', { count: 'exact', head: true }).eq('conta_id', id)
        ]);
        const totalVinculadas = (resVendas.count || 0) + (resDespesas.count || 0);

        let mensagem = `Tem certeza que deseja inativar a conta "${nome}"?`;
        if (totalVinculadas > 0) {
            mensagem += `\n\nExistem ${totalVinculadas} movimentação(ões) vinculada(s). O histórico será mantido.`;
        } else {
            mensagem += `\n\nEla não aparecerá mais nas listagens.`;
        }

        const confirmed = await confirmModal("Inativar conta", mensagem);
        if (!confirmed) return;

        const { error } = await supabase.from('contas').update({
            ativo: false,
            updated_at: new Date().toISOString()
        }).eq('id', id);

        if (error) throw error;

        mostrarModal('Conta inativada', 'A conta foi inativada com sucesso.', 'sucesso');
        carregarContas();
        calcularSaldoConsolidado();
    } catch (err) {
        mostrarModal('Erro ao inativar', traduzirErro(err.message));
    }
}

// --- EXCLUIR CONTA (RF114) ---
async function excluirConta(id, nome) {
    try {
        const [resVendas, resDespesas] = await Promise.all([
            supabase.from('vendas').select('id', { count: 'exact', head: true }).eq('conta_id', id),
            supabase.from('despesas').select('id', { count: 'exact', head: true }).eq('conta_id', id)
        ]);
        const totalVinculadas = (resVendas.count || 0) + (resDespesas.count || 0);

        let mensagem;
        if (totalVinculadas > 0) {
            mensagem = `A conta "${nome}" possui ${totalVinculadas} movimentação(ões) vinculada(s). Ao excluir, o vínculo será removido (os registros serão mantidos, mas sem conta vinculada). Deseja continuar?`;
        } else {
            mensagem = `Tem certeza que deseja excluir permanentemente a conta "${nome}"? Esta ação não pode ser desfeita.`;
        }

        const confirmed = await confirmModal("Excluir conta", mensagem);
        if (!confirmed) return;

        const { error } = await supabase.from('contas').delete().eq('id', id);
        if (error) throw error;

        mostrarModal('Conta excluída', 'A conta foi excluída permanentemente.', 'sucesso');
        carregarContas();
        calcularSaldoConsolidado();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
}

// --- TRANSFERÊNCIA ENTRE CONTAS (RF109/RF110) ---
window.abrirModalTransferencia = async function () {
    const selects = document.querySelectorAll('#contaOrigem, #contaDestino');
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas } = await supabase
            .from('contas').select('id, nome, saldo_atual')
            .eq('user_id', user.id).eq('ativo', true).order('nome');

        const options = '<option value="">Selecione...</option>' +
            (contas || []).map(c => `<option value="${c.id}">${esc(c.nome)} (R$ ${parseFloat(c.saldo_atual).toFixed(2)})</option>`).join('');
        selects.forEach(s => { s.innerHTML = options; });
    } catch (err) {
        console.error("Erro ao carregar contas:", err);
    }
    document.getElementById("modalTransferencia").style.display = "flex";
    if (window.lucide) lucide.createIcons();
};

window.fecharModalTransferencia = function () {
    document.getElementById("modalTransferencia").style.display = "none";
};

const formTransferencia = document.getElementById("formTransferencia");
if (formTransferencia) {
    formTransferencia.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = formTransferencia.querySelector('button[type="submit"]');
        const origemId = document.getElementById("contaOrigem").value;
        const destinoId = document.getElementById("contaDestino").value;
        const valor = parseFloat(document.getElementById("valorTransferencia").value);

        if (!origemId || !destinoId) {
            mostrarModal('Selecione as contas', 'Escolha a conta de origem e destino.');
            return;
        }
        if (origemId === destinoId) {
            mostrarModal('Contas iguais', 'A conta de origem e destino não podem ser a mesma.');
            return;
        }
        if (!valor || valor <= 0) {
            mostrarModal('Valor inválido', 'Informe um valor maior que zero.');
            return;
        }

        try {
            btn.disabled = true;
            btn.innerText = "Transferindo...";

            const { data: origem } = await supabase.from('contas').select('saldo_atual, nome').eq('id', origemId).single();
            if (parseFloat(origem.saldo_atual) < valor) {
                mostrarModal('Saldo insuficiente', `Saldo disponível: R$ ${parseFloat(origem.saldo_atual).toFixed(2)}`);
                return;
            }

            const { data: destino } = await supabase.from('contas').select('nome').eq('id', destinoId).single();

            await Promise.all([
                atualizarSaldoConta(origemId, -valor),
                atualizarSaldoConta(destinoId, valor)
            ]);

            mostrarModal('Transferência realizada!',
                `R$ ${valor.toFixed(2)} transferido de "${origem.nome}" para "${destino.nome}".`, 'sucesso');
            fecharModalTransferencia();
            carregarContas();
            calcularSaldoConsolidado();
        } catch (err) {
            mostrarModal('Erro na transferência', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = "Confirmar Transferência";
        }
    });
}

// --- VER MOVIMENTAÇÕES VINCULADAS À CONTA (RF111) ---
async function verMovimentacoesConta(contaId, contaNome) {
    try {
        const [resVendas, resDespesas] = await Promise.all([
            supabase.from('vendas').select('id, descricao, valor, status, data_venda, created_at')
                .eq('conta_id', contaId).order('created_at', { ascending: false }).limit(20),
            supabase.from('despesas').select('id, descricao, valor, data, categoria')
                .eq('conta_id', contaId).order('data', { ascending: false }).limit(20)
        ]);

        const vendas = resVendas.data || [];
        const despesas = resDespesas.data || [];

        if (vendas.length === 0 && despesas.length === 0) {
            mostrarModal('Movimentações', `Nenhuma movimentação vinculada à conta "${contaNome}".`);
            return;
        }

        let html = `<div style="max-height: 400px; overflow-y: auto;">`;

        if (vendas.length > 0) {
            html += `<h4 style="color: var(--cor-sucesso); margin: 0.5rem 0;">Vendas (${vendas.length})</h4>`;
            vendas.forEach(v => {
                html += `<div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom: 1px solid var(--borda-cor);">
                    <span style="font-size:0.82rem; color: var(--texto-secundario);">${esc(v.descricao)}<br><small>${new Date(v.created_at).toLocaleDateString('pt-BR')} — ${esc(v.status)}</small></span>
                    <span style="font-weight:600; color: var(--cor-sucesso);">R$ ${parseFloat(v.valor).toFixed(2)}</span>
                </div>`;
            });
        }

        if (despesas.length > 0) {
            html += `<h4 style="color: var(--cor-erro); margin: 1rem 0 0.5rem;">Despesas (${despesas.length})</h4>`;
            despesas.forEach(g => {
                html += `<div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom: 1px solid var(--borda-cor);">
                    <span style="font-size:0.82rem; color: var(--texto-secundario);">${esc(g.descricao)}<br><small>${new Date(g.data + 'T12:00:00').toLocaleDateString('pt-BR')} — ${esc(g.categoria)}</small></span>
                    <span style="font-weight:600; color: var(--cor-erro);">- R$ ${parseFloat(g.valor).toFixed(2)}</span>
                </div>`;
            });
        }

        html += `</div>`;
        mostrarModal(`Movimentações — ${contaNome}`, '');
        const modalMsg = document.getElementById('modalAlertaMensagem');
        if (modalMsg) {
            modalMsg.innerHTML = html;
            modalMsg.style.maxHeight = '400px';
            modalMsg.style.overflowY = 'auto';
        }
    } catch (err) {
        mostrarModal('Erro ao buscar movimentações', traduzirErro(err.message));
    }
}

// --- POPULAR SELECTS DE CONTA (para vendas e gastos) ---
window.popularSelectContas = async function (selectId, incluirTodas = false) {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: contas, error } = await supabase
            .from('contas')
            .select('id, nome, tipo')
            .eq('user_id', user.id)
            .eq('ativo', true)
            .order('nome');

        if (error) throw error;

        const defaultOption = incluirTodas
            ? '<option value="">Todas as contas</option>'
            : '<option value="">Selecione uma conta</option>';

        select.innerHTML = defaultOption +
            (contas || []).map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');

    } catch (err) {
        console.error("Erro ao carregar contas no select:", err.message);
    }
};

// --- DELEGAÇÃO DE EVENTOS ---
delegate(document.getElementById('listaContas'), 'button[data-acao]', 'click', (e, botao) => {
    const acao = botao.dataset.acao;
    const id = botao.dataset.id;
    const nome = botao.dataset.nome;

    if (acao === 'editar') {
        abrirEditarConta(id);
    } else if (acao === 'inativar') {
        inativarConta(id, nome);
    } else if (acao === 'excluir') {
        excluirConta(id, nome);
    } else if (acao === 'movimentacoes') {
        verMovimentacoesConta(id, nome);
    }
});

// --- INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", () => {
    carregarContas();
    calcularSaldoConsolidado();
});
