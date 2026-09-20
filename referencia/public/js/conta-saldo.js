import { supabase } from './auth.js';

export async function atualizarSaldoConta(contaId, valor) {
    if (!contaId || !valor) return;
    const { data: conta } = await supabase.from('contas').select('saldo_atual').eq('id', contaId).single();
    if (!conta) return;
    await supabase.from('contas').update({
        saldo_atual: parseFloat(conta.saldo_atual || 0) + valor,
        updated_at: new Date().toISOString()
    }).eq('id', contaId);
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
