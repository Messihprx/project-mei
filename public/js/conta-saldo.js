import { supabase } from './auth.js';

// Toda movimentação precisa de um "lugar" onde o dinheiro entre/saia.
// Usuários novos (ou sem nenhuma conta ativa) ganham automaticamente
// uma conta "Caixa do Negócio" — evita venda órfã e destrava a
// transferência entre contas. Cacheia a promise para não criar duplicada.
let promessaContaPadrao = null;

export function garantirContaPadrao() {
    if (!promessaContaPadrao) {
        promessaContaPadrao = criarContaPadraoSePreciso().catch((err) => {
            console.error('Erro ao garantir conta padrão:', err.message);
            // Libera nova tentativa na próxima chamada
            promessaContaPadrao = null;
            return null;
        });
    }
    return promessaContaPadrao;
}

async function criarContaPadraoSePreciso() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: existentes, error } = await supabase
        .from('contas')
        .select('id')
        .eq('user_id', user.id)
        .eq('ativo', true)
        .order('nome')
        .limit(1);
    if (error) throw error;
    if (existentes?.length) return existentes[0].id;

    const { data: criada, error: erroInsert } = await supabase
        .from('contas')
        .insert([{
            user_id: user.id,
            nome: 'Caixa do Negócio',
            tipo: 'caixa',
            finalidade: 'negocio',
            saldo_inicial: 0,
            saldo_atual: 0
        }])
        .select('id')
        .single();
    if (erroInsert) throw erroInsert;
    return criada.id;
}

export async function atualizarSaldoConta(contaId, valor) {
    if (!contaId || !valor) return;
    const { data: conta } = await supabase.from('contas').select('saldo_atual').eq('id', contaId).single();
    if (!conta) return;
    await supabase.from('contas').update({
        saldo_atual: parseFloat(conta.saldo_atual || 0) + valor,
        updated_at: new Date().toISOString()
    }).eq('id', contaId);
}

// Os selects de conta dos formulários listam apenas contas ATIVAS.
// Quando um registro editado está vinculado a uma conta INATIVADA, a
// opção não existe no select, o value virava "" e o salvar gravava
// conta_id null — desvinculando o registro em silêncio e movendo o
// saldo para lugar nenhum. Esta função garante a opção (RF113).
export async function garantirOpcaoConta(select, contaId) {
    if (!select || !contaId) return;
    if (select.querySelector(`option[value="${contaId}"]`)) return;
    try {
        const { data: conta } = await supabase
            .from('contas').select('id, nome, ativo').eq('id', contaId).single();
        if (!conta) return;
        const opt = document.createElement('option');
        opt.value = conta.id;
        opt.textContent = `${conta.nome}${conta.ativo ? '' : ' (inativa)'}`;
        select.appendChild(opt);
    } catch (err) {
        console.error('Erro ao carregar conta vinculada:', err.message);
    }
}

export function calcDeltaVenda(valor, status, acao, valorAntigo, statusAntigo) {
    const v = parseFloat(valor) || 0;
    const va = parseFloat(valorAntigo) || 0;
    const pago = s => s === 'pago' || s === 'recebido';
    if (acao === 'criar') return pago(status) ? v : 0;
    if (acao === 'excluir') return pago(status) ? -v : 0;
    if (acao === 'editar') {
        const eraPago = pago(statusAntigo);
        const agoraPago = pago(status);
        if (!eraPago && agoraPago) return v;
        if (eraPago && !agoraPago) return -va;
        if (eraPago && agoraPago) return v - va;
        return 0;
    }
    return 0;
}
