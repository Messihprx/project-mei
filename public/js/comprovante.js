import { supabase } from './auth.js';
import { esc, formatarDataVenda } from './dom-utils.js';

/**
 * Gera e abre em nova aba o comprovante de pagamento estilizado de uma venda paga.
 */
export async function gerarComprovante(venda) {
    const status = String(venda.status || 'pago').toLowerCase();
    if (status === 'pendente') {
        if (typeof mostrarModal === 'function') {
            mostrarModal('Venda pendente', 'Esta venda ainda não foi paga. Não há comprovante de pagamento para gerar. Marque-a como recebida primeiro.', 'alerta');
        }
        return;
    }

    const itens = venda.venda_itens || [];
    const valorNum = Number(venda.valor || 0);
    const subtotalItens = itens.reduce((soma, it) => {
        const qtd = Number(it.quantidade) || 1;
        const unit = Number(it.valor_unit || 0);
        return soma + (qtd * unit);
    }, 0);
    const descontoReais = subtotalItens > valorNum + 0.009
        ? Math.round((subtotalItens - valorNum) * 100) / 100
        : 0;
    const descontoPct = descontoReais > 0 && subtotalItens > 0
        ? Math.round((descontoReais / subtotalItens) * 1000) / 10
        : 0;

    const itensHtml = itens.length
        ? itens.map(it => {
            const qtd = Number(it.quantidade) || 1;
            const unit = Number(it.valor_unit || 0);
            const sub = qtd * unit;
            return `<tr>
                <td><strong>${esc(it.descricao || '-')}</strong></td>
                <td class="num center">${qtd}</td>
                <td class="num right">R$ ${unit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td class="num right"><strong>R$ ${sub.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
            </tr>`;
        }).join('')
        : `<tr>
            <td><strong>${esc(venda.descricao || 'Serviço geral')}</strong></td>
            <td class="num center">1</td>
            <td class="num right">R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="num right"><strong>R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
        </tr>`;

    let perfil = {};
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: perfilData } = await supabase
                .from('perfis')
                .select('*')
                .eq('id', user.id)
                .maybeSingle();
            if (perfilData) perfil = perfilData;
        }
    } catch (_) { /* perfil opcional */ }

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

    const nomeEmissor = perfil.nome_completo || '';
    const nomeFantasia = perfil.nome_fantasia || perfil.razao_social || '';
    const cnpjFormatado = formatarCNPJ(perfil.cnpj);
    const cpfFormatado = formatarCPF(perfil.cpf);
    const endereco = [perfil.logradouro, perfil.numero, perfil.complemento, perfil.bairro, perfil.cidade, perfil.estado]
        .filter(Boolean).join(', ');
    const telefoneEmissor = perfil.celular || perfil.telefone || '';
    const chavePix = perfil.chave_pix || '';
    const codigoRecibo = String(venda.id || '').slice(0, 8).toUpperCase() || '00000000';
    const dataVendaFmt = formatarDataVenda(venda.data_venda || venda.created_at);

    const html = `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprovante #${esc(codigoRecibo)} · FinMEI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#e2e8f0;padding:28px 16px 48px;color:#0f172a;-webkit-font-smoothing:antialiased;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .toolbar{max-width:640px;margin:0 auto 14px;display:flex;justify-content:flex-end;gap:10px;}
  .btn-tool{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:10px;font-size:.82rem;font-weight:600;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155;box-shadow:0 2px 6px rgba(15,23,42,.06);transition:all .15s;}
  .btn-tool:hover{background:#f8fafc;border-color:#94a3b8;}
  .btn-tool.primary{background:linear-gradient(135deg,#2563eb,#1d4ed8);border-color:#1d4ed8;color:#fff;box-shadow:0 6px 16px rgba(37,99,235,.25);}
  .btn-tool.primary:hover{filter:brightness(1.06);}
  .box{max-width:640px;margin:0 auto;background:#fff;border-radius:20px;box-shadow:0 20px 50px rgba(15,23,42,.12);overflow:hidden;border:1px solid #e2e8f0;}
  .header{background:linear-gradient(135deg,#0b1222 0%,#172554 55%,#1d4ed8 100%);color:#fff;padding:28px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand-mark{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#60a5fa);display:flex;align-items:center;justify-content:center;font-family:'Sora',sans-serif;font-weight:800;font-size:.82rem;letter-spacing:.03em;color:#fff;box-shadow:0 6px 16px rgba(59,130,246,.35);}
  .brand-text .logo{font-family:'Sora',sans-serif;font-size:1.3rem;font-weight:800;letter-spacing:-.02em;line-height:1.1;}
  .brand-text .sub{font-size:.76rem;color:#bfdbfe;margin-top:2px;}
  .header-meta{text-align:right;}
  .recibo-id{font-size:.72rem;font-weight:600;color:#93c5fd;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.05em;}
  .badge.pago{background:rgba(16,185,129,.2);color:#6ee7b7;border:1px solid rgba(110,231,183,.35);}
  .badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor;}
  .hero-strip{background:linear-gradient(135deg,#f8fafc 0%,#eff6ff 100%);padding:22px 32px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;}
  .hero-label{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:4px;}
  .hero-amount{font-family:'Sora',sans-serif;font-size:2rem;font-weight:800;color:#0f172a;letter-spacing:-.03em;line-height:1.1;}
  .hero-discount{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 10px;border-radius:999px;background:#ecfdf5;border:1px solid #a7f3d0;color:#059669;font-size:.74rem;font-weight:600;}
  .hero-date{text-align:right;}
  .hero-date strong{display:block;font-size:.92rem;color:#0f172a;margin-top:2px;}
  .body{padding:26px 32px 30px;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px;}
  .info-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;}
  .info-card .k{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px;}
  .info-card .v{font-size:.9rem;font-weight:600;color:#0f172a;word-break:break-word;}
  .info-card .v-sub{font-size:.76rem;color:#64748b;margin-top:2px;}
  .section-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:10px;}
  .table-wrap{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:18px;}
  table{width:100%;border-collapse:collapse;}
  th{background:#f8fafc;padding:10px 14px;text-align:left;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;border-bottom:1px solid #e2e8f0;}
  td{padding:11px 14px;font-size:.84rem;color:#1e293b;border-bottom:1px solid #f1f5f9;}
  tr:last-child td{border-bottom:none;}
  .num{font-variant-numeric:tabular-nums;}
  .center{text-align:center;}
  .right{text-align:right;}
  .summary-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px 18px;margin-bottom:20px;}
  .sum-row{display:flex;justify-content:space-between;align-items:center;font-size:.84rem;color:#475569;padding:4px 0;}
  .sum-row.discount{color:#059669;font-weight:600;}
  .sum-row.total{margin-top:8px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:1rem;font-weight:700;color:#0f172a;}
  .sum-row.total span:last-child{font-family:'Sora',sans-serif;font-size:1.35rem;font-weight:800;color:#1d4ed8;}
  .emitente{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;}
  .emitente-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;}
  .emitente-head h5{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1d4ed8;}
  .emitente-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;}
  .emit-item{font-size:.8rem;color:#334155;}
  .emit-item.full{grid-column:1 / -1;}
  .emit-item span{display:block;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:1px;}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;font-size:.72rem;color:#64748b;line-height:1.5;}
  .footer strong{color:#0f172a;}
  @media (max-width:520px){.info-grid,.emitente-grid{grid-template-columns:1fr;}.header,.hero-strip,.body,.footer{padding-left:20px;padding-right:20px;}.header-meta,.hero-date{text-align:left;}}
  @media print{.no-print{display:none !important;}body{background:#fff;padding:0;}.box{box-shadow:none;border:none;border-radius:0;max-width:100%;}}
</style></head><body>
<div class="toolbar no-print">
  <button class="btn-tool" onclick="window.close()">Fechar</button>
  <button class="btn-tool primary" onclick="window.print()">Imprimir / Salvar PDF</button>
</div>
<div class="box">
  <div class="header">
    <div class="brand">
      <div class="brand-mark">MEI</div>
      <div class="brand-text">
        <div class="logo">${esc(nomeFantasia || 'finMEI')}</div>
        <div class="sub">Comprovante de Pagamento</div>
      </div>
    </div>
    <div class="header-meta">
      <div class="recibo-id">Recibo #${esc(codigoRecibo)}</div>
      <span class="badge ${esc(status)}"><span class="badge-dot"></span> ${esc(status.toUpperCase())}</span>
    </div>
  </div>

  <div class="hero-strip">
    <div>
      <div class="hero-label">Valor pago</div>
      <div class="hero-amount">R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
      ${descontoReais > 0 ? `<div class="hero-discount">Desconto aplicado: - R$ ${descontoReais.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${descontoPct}%)</div>` : ''}
    </div>
    <div class="hero-date">
      <div class="hero-label">Data da venda</div>
      <strong>${esc(dataVendaFmt)}</strong>
    </div>
  </div>

  <div class="body">
    <div class="info-grid">
      <div class="info-card">
        <div class="k">Cliente</div>
        <div class="v">${esc(venda.clientes?.nome || 'Cliente avulso')}</div>
        ${venda.clientes?.telefone ? `<div class="v-sub">${esc(venda.clientes.telefone)}</div>` : ''}
      </div>
      <div class="info-card">
        <div class="k">Conta / Descrição</div>
        <div class="v">${esc(venda.contas?.nome || 'Conta padrão')}</div>
        ${venda.descricao ? `<div class="v-sub">${esc(venda.descricao)}</div>` : ''}
      </div>
    </div>

    <div class="section-title">Itens da venda</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Descrição</th><th class="center">Qtd</th><th class="right">Unit.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>${itensHtml}</tbody>
      </table>
    </div>

    <div class="summary-box">
      ${descontoReais > 0 ? `
        <div class="sum-row"><span>Subtotal dos itens</span><span class="num">R$ ${subtotalItens.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
        <div class="sum-row discount"><span>Desconto (${descontoPct}%)</span><span class="num">- R$ ${descontoReais.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
      ` : ''}
      <div class="sum-row total"><span>Total pago</span><span class="num">R$ ${valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
    </div>

    ${nomeFantasia || cnpjFormatado || cpfFormatado || nomeEmissor || endereco || telefoneEmissor || chavePix ? `
    <div class="emitente">
      <div class="emitente-head">
        <h5>Dados do Emitente</h5>
      </div>
      <div class="emitente-grid">
        ${nomeFantasia ? `<div class="emit-item"><span>Nome fantasia</span>${esc(nomeFantasia)}</div>` : ''}
        ${nomeEmissor ? `<div class="emit-item"><span>Responsável</span>${esc(nomeEmissor)}</div>` : ''}
        ${cnpjFormatado ? `<div class="emit-item"><span>CNPJ</span>${esc(cnpjFormatado)}</div>` : ''}
        ${cpfFormatado ? `<div class="emit-item"><span>CPF</span>${esc(cpfFormatado)}</div>` : ''}
        ${telefoneEmissor ? `<div class="emit-item"><span>Telefone</span>${esc(telefoneEmissor)}</div>` : ''}
        ${chavePix ? `<div class="emit-item"><span>Chave Pix</span>${esc(chavePix)}</div>` : ''}
        ${endereco ? `<div class="emit-item full"><span>Endereço</span>${esc(endereco)}</div>` : ''}
      </div>
    </div>
    ` : ''}
  </div>

  <div class="footer">
    Emitido via <strong>finMEI</strong> em ${new Date().toLocaleDateString('pt-BR')} · Documento sem valor fiscal
  </div>
</div>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
        w.document.write(html);
        w.document.close();
    } else if (typeof mostrarModal === 'function') {
        mostrarModal('Bloqueado', 'Permita pop-ups para gerar o comprovante.', 'alerta');
    }
}
