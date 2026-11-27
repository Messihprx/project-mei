import { supabase } from './auth.js';

// ============================================================
// Página "MEI" — obrigações, prazos e calculadoras
// ============================================================

const MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const LIMITE_ANUAL = 81000;
const LIMITE_MENSAL = 6750;
const VALOR_DAS = 81.05;
const STORAGE_FUNCIONARIO = 'finmei_mei_funcionario';
const STORAGE_DOCUMENTOS = 'finmei_mei_documentos';

const fmtBRL = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
});

const fmtData = (data) => data.toLocaleDateString('pt-BR');

const esc = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const hojeZerado = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const diasEntre = (inicio, fim) => Math.round((fim - inicio) / 86400000);

function setStatus(elemento, texto, tipo) {
    if (!elemento) return;
    elemento.textContent = texto;
    elemento.className = 'mei-status' + (tipo ? ' ' + tipo : '');
}

// ------------------------------------------------------------
// Prazos (não dependem do banco)
// ------------------------------------------------------------
function proximoVencimentoDAS() {
    const hoje = hojeZerado();
    let vencimento = new Date(hoje.getFullYear(), hoje.getMonth(), 20);
    if (hoje > vencimento) {
        vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 20);
    }
    return vencimento;
}

function prazoDASN() {
    const hoje = hojeZerado();
    let ano = hoje.getFullYear();
    let prazo = new Date(ano, 4, 31);
    if (hoje > prazo) {
        ano += 1;
        prazo = new Date(ano, 4, 31);
    }
    return { prazo, anoReferencia: ano - 1 };
}

function renderizarPrazos() {
    const hoje = hojeZerado();

    // DAS
    const vencimento = proximoVencimentoDAS();
    const diasDAS = diasEntre(hoje, vencimento);
    const elVencimento = document.getElementById('meiDasVencimento');
    const elDasStatus = document.getElementById('meiDasStatus');
    if (elVencimento) elVencimento.textContent = `Vencimento em ${fmtData(vencimento)}`;
    if (diasDAS === 0) {
        setStatus(elDasStatus, 'Vence hoje — pague para evitar multa', 'warn');
    } else if (diasDAS <= 3) {
        setStatus(elDasStatus, `Vence em ${diasDAS} dia${diasDAS > 1 ? 's' : ''}`, 'warn');
    } else {
        setStatus(elDasStatus, `Vence em ${diasDAS} dias`, 'info');
    }

    // DASN
    const { prazo, anoReferencia } = prazoDASN();
    const diasDASN = diasEntre(hoje, prazo);
    const elDasnData = document.getElementById('meiDasnData');
    const elDasnRef = document.getElementById('meiDasnReferencia');
    const elDasnStatus = document.getElementById('meiDasnStatus');
    if (elDasnData) elDasnData.textContent = fmtData(prazo);
    if (elDasnRef) elDasnRef.textContent = `Declaração do faturamento de ${anoReferencia}`;
    if (diasDASN === 0) {
        setStatus(elDasnStatus, 'Último dia para entregar', 'danger');
    } else if (diasDASN <= 30) {
        setStatus(elDasnStatus, `Faltam ${diasDASN} dias`, 'warn');
    } else {
        setStatus(elDasnStatus, `Faltam ${diasDASN} dias`, 'info');
    }
}

// ------------------------------------------------------------
// Limite de faturamento
// ------------------------------------------------------------
function limiteDoAno(dataAbertura) {
    if (!dataAbertura) return { limite: LIMITE_ANUAL, proporcional: false };
    const abertura = new Date(`${dataAbertura}T00:00:00`);
    if (Number.isNaN(abertura.getTime())) return { limite: LIMITE_ANUAL, proporcional: false };
    if (abertura.getFullYear() !== new Date().getFullYear()) {
        return { limite: LIMITE_ANUAL, proporcional: false };
    }
    const meses = 12 - abertura.getMonth();
    return {
        limite: Math.max(1, meses) * LIMITE_MENSAL,
        meses,
        proporcional: true
    };
}

function renderizarLimite(totalAnual, dataAbertura) {
    const { limite, meses, proporcional } = limiteDoAno(dataAbertura);
    const percentual = limite > 0 ? (totalAnual / limite) * 100 : 0;

    const elUsado = document.getElementById('meiLimiteUsado');
    const elTotal = document.getElementById('meiLimiteTotal');
    const elFill = document.getElementById('meiProgressFill');
    const elProgress = document.getElementById('meiProgress');
    const elStatus = document.getElementById('meiLimiteStatus');
    const elDetalhe = document.getElementById('meiLimiteDetalhe');

    if (elUsado) elUsado.textContent = fmtBRL(totalAnual);
    if (elTotal) {
        elTotal.textContent = proporcional
            ? `de ${fmtBRL(limite)} (${meses} ${meses === 1 ? 'mês' : 'meses'} de atividade)`
            : `de ${fmtBRL(limite)} (${fmtBRL(LIMITE_MENSAL)}/mês)`;
    }

    if (elFill) {
        elFill.className = 'mei-progress-fill';
        if (percentual >= 100) elFill.classList.add('danger');
        else if (percentual >= 80) elFill.classList.add('warn');
        else elFill.classList.add('ok');
        elFill.style.width = `${Math.min(Math.max(percentual, 0), 100)}%`;
    }

    if (elProgress) elProgress.setAttribute('aria-valuenow', String(Math.round(Math.min(percentual, 100))));

    if (percentual > 120) {
        setStatus(elStatus, `Acima de 120% do teto — risco de desenquadramento`, 'danger');
    } else if (percentual > 100) {
        setStatus(elStatus, `Teto ultrapassado em ${(percentual - 100).toFixed(0)}% — DAS complementar`, 'danger');
    } else if (percentual >= 100) {
        setStatus(elStatus, `No limite do teto — atenção`, 'warn');
    } else if (percentual >= 80) {
        setStatus(elStatus, `Atenção: ${percentual.toFixed(0)}% do limite usado`, 'warn');
    } else {
        setStatus(elStatus, `Dentro do limite — ${percentual.toFixed(0)}% usado`, 'ok');
    }

    if (elDetalhe) {
        const restante = limite - totalAnual;
        const base = restante > 0
            ? `Faltam ${fmtBRL(restante)} para atingir o teto.`
            : `Excedente de ${fmtBRL(Math.abs(restante))} sobre o teto.`;
        elDetalhe.textContent = `${base} Considera todas as vendas do ano, exceto canceladas. Até 20% acima do limite: guia extra (DAS complementar). Acima de 20%: desenquadramento retroativo para ME.`;
    }
}

// ------------------------------------------------------------
// Dados do usuário (perfil + vendas pagas do ano)
// ------------------------------------------------------------
let perfilUsuario = null;
let totalAnual = 0;
let vendasAno = [];

async function carregarDados() {
    let user = null;
    try {
        const { data } = await supabase.auth.getUser();
        user = data?.user || null;
    } catch (e) {
        console.warn('MEI: não foi possível obter o usuário.', e);
    }
    if (!user) {
        renderizarLimite(0, null);
        return;
    }

    // Perfil (CNPJ, razão social, data de abertura...)
    try {
        const { data } = await supabase
            .from('perfis')
            .select('nome_fantasia, razao_social, cnpj, cnae, data_abertura, email')
            .eq('id', user.id)
            .maybeSingle();
        perfilUsuario = data || null;
    } catch (e) {
        console.warn('MEI: não foi possível carregar o perfil.', e);
    }

    // Vendas pagas do ano corrente
    const ano = new Date().getFullYear();
    const inicioAno = new Date(ano, 0, 1).toISOString();
    const fimAno = new Date(ano + 1, 0, 1).toISOString();

    try {
        const { data, error } = await supabase
            .from('vendas')
            .select('valor, data_venda, status')
            .eq('user_id', user.id)
            .gte('data_venda', inicioAno)
            .lt('data_venda', fimAno);

        if (error) throw error;
        vendasAno = data || [];
        totalAnual = vendasAno
            .filter((venda) => String(venda.status || '').toLowerCase() !== 'cancelado')
            .reduce((soma, venda) => soma + (Number(venda.valor) || 0), 0);
    } catch (e) {
        console.warn('MEI: não foi possível carregar as vendas.', e);
        vendasAno = [];
        totalAnual = 0;
    }

    renderizarLimite(totalAnual, perfilUsuario?.data_abertura);

    const calc = document.getElementById('calcFaturamento');
    if (calc && !calc.value && totalAnual > 0) calc.value = totalAnual.toFixed(2);

    preencherComVendasDoMes();
}

// ------------------------------------------------------------
// Relatório mensal de receitas
// ------------------------------------------------------------
function mesAtualInput() {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

async function vendasDoMes(mesStr) {
    const [ano, mes] = String(mesStr).split('-').map(Number);
    if (!ano || !mes) return 0;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const inicio = new Date(ano, mes - 1, 1).toISOString();
    const fim = new Date(ano, mes, 1).toISOString();

    const { data, error } = await supabase
        .from('vendas')
        .select('valor, status')
        .eq('user_id', user.id)
        .gte('data_venda', inicio)
        .lt('data_venda', fim);

    if (error) throw error;
    return (data || [])
        .filter((venda) => String(venda.status || '').toLowerCase() !== 'cancelado')
        .reduce((soma, venda) => soma + (Number(venda.valor) || 0), 0);
}

function nomeMes(mesStr) {
    const [ano, mes] = String(mesStr).split('-').map(Number);
    return `${MESES[(mes || 1) - 1]} de ${ano}`;
}

function abrirRelatorio(mesStr, valor) {
    const empresa = perfilUsuario?.nome_fantasia
        || perfilUsuario?.razao_social
        || 'Microempreendedor Individual';
    const cnpj = perfilUsuario?.cnpj ? `CNPJ: ${esc(perfilUsuario.cnpj)}` : '';
    const referencia = nomeMes(mesStr);
    const valorFmt = fmtBRL(valor);
    const emissao = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Relatório mensal de receitas — ${esc(referencia)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 40px; background: #ffffff; }
  .folha { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; font-weight: normal; color: #4b5563; margin: 0 0 28px; }
  .empresa { border: 1px solid #d1d5db; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; }
  .empresa strong { font-size: 15px; }
  .empresa span { display: block; font-size: 12px; color: #4b5563; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 18px 0 24px; }
  th, td { border: 1px solid #d1d5db; padding: 10px 12px; font-size: 13px; text-align: left; }
  th { background: #f3f4f6; }
  td.valor { text-align: right; font-weight: bold; }
  tr.total td { background: #f9fafb; font-weight: bold; }
  .texto { font-size: 13px; line-height: 1.6; color: #374151; }
  .assinatura { margin-top: 56px; text-align: center; font-size: 13px; }
  .linha { border-top: 1px solid #111827; width: 320px; margin: 0 auto 8px; }
  .rodape { margin-top: 40px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 0; } .folha { max-width: none; } }
</style>
</head>
<body>
  <div class="folha">
    <h1>Relatório Mensal de Receitas Brutas</h1>
    <h2>MEI — ${esc(referencia)}</h2>

    <div class="empresa">
      <strong>${esc(empresa)}</strong>
      ${cnpj ? `<span>${cnpj}</span>` : ''}
      <span>Regime: Microempreendedor Individual (MEI)</span>
    </div>

    <table>
      <thead>
        <tr><th>Descrição</th><th>Valor</th></tr>
      </thead>
      <tbody>
        <tr><td>Receita bruta de vendas e serviços no mês</td><td class="valor">${valorFmt}</td></tr>
        <tr class="total"><td>Total da receita bruta</td><td class="valor">${valorFmt}</td></tr>
      </tbody>
    </table>

    <p class="texto">
      Declaro, para os devidos fins, que a receita bruta auferida no mês de <strong>${esc(referencia)}</strong>
      foi de <strong>${valorFmt}</strong>, conforme os registros de vendas do meu negócio.
    </p>

    <div class="assinatura">
      <div class="linha"></div>
      ${esc(empresa)}<br>
      ${cnpj ? `${cnpj}<br>` : ''}
      Emitido em ${esc(emissao)}
    </div>

    <div class="rodape">Documento gerado pelo FinMEI. Guarde este relatório por 5 anos.</div>
  </div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });<\/script>
</body>
</html>`;

    const janela = window.open('', '_blank');
    if (!janela) {
        return false;
    }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    return true;
}

function initRelatorio() {
    const form = document.getElementById('formRelatorio');
    const inputMes = document.getElementById('relatorioMes');
    const inputValor = document.getElementById('relatorioValor');
    const btnVendas = document.getElementById('btnUsarVendasMes');
    const feedback = document.getElementById('relatorioFeedback');

    if (inputMes) inputMes.value = mesAtualInput();

    if (btnVendas) {
        btnVendas.addEventListener('click', async () => {
            if (!inputMes?.value) return;
            btnVendas.disabled = true;
            try {
                const total = await vendasDoMes(inputMes.value);
                if (inputValor) inputValor.value = total.toFixed(2);
                if (feedback) feedback.textContent = `Vendas em ${nomeMes(inputMes.value)}: ${fmtBRL(total)}.`;
            } catch (e) {
                console.warn('MEI: erro ao somar vendas do mês.', e);
                if (feedback) feedback.textContent = 'Não foi possível carregar as vendas do mês.';
            } finally {
                btnVendas.disabled = false;
            }
        });
    }

    if (form) {
        form.addEventListener('submit', (evento) => {
            evento.preventDefault();
            const mes = inputMes?.value;
            const valor = Number(inputValor?.value);
            if (!mes || !Number.isFinite(valor) || valor < 0) {
                if (feedback) feedback.textContent = 'Informe o mês e um valor válido.';
                return;
            }
            const aberto = abrirRelatorio(mes, valor);
            if (feedback) {
                feedback.textContent = aberto
                    ? 'Relatório aberto em nova aba. Use "Salvar como PDF" na janela de impressão.'
                    : 'Permita pop-ups no navegador para gerar o relatório.';
            }
        });
    }
}

function preencherComVendasDoMes() {
    const inputValor = document.getElementById('relatorioValor');
    const inputMes = document.getElementById('relatorioMes');
    if (!inputValor || !inputMes?.value || inputValor.value) return;

    // Reaproveita as vendas do ano já carregadas.
    const mesAtual = mesAtualInput();
    if (inputMes.value !== mesAtual) return;

    const total = vendasAno.reduce((soma, venda) => {
        if (String(venda.status || '').toLowerCase() === 'cancelado') return soma;
        const data = new Date(venda.data_venda);
        if (Number.isNaN(data.getTime())) return soma;
        if (data.getMonth() !== new Date().getMonth()) return soma;
        return soma + (Number(venda.valor) || 0);
    }, 0);

    if (total > 0) inputValor.value = total.toFixed(2);
}

// ------------------------------------------------------------
// Calculadora de lucro tributável
// ------------------------------------------------------------
function initCalculadora() {
    const form = document.getElementById('formCalculadora');
    const inputFaturamento = document.getElementById('calcFaturamento');
    const selectAtividade = document.getElementById('calcAtividade');
    const resultado = document.getElementById('calcResultado');
    const elIsento = document.getElementById('calcIsento');
    const elTributavel = document.getElementById('calcTributavel');
    const elDetalhe = document.getElementById('calcDetalhe');

    if (inputFaturamento && !inputFaturamento.value && totalAnual > 0) {
        inputFaturamento.value = totalAnual.toFixed(2);
    }

    if (!form) return;

    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        const faturamento = Number(inputFaturamento?.value);
        const presuncao = Number(selectAtividade?.value);

        if (!Number.isFinite(faturamento) || faturamento < 0 || !Number.isFinite(presuncao)) {
            if (resultado) resultado.hidden = true;
            return;
        }

        const isento = faturamento * presuncao;
        const tributavel = faturamento - isento;

        if (elIsento) elIsento.textContent = fmtBRL(isento);
        if (elTributavel) elTributavel.textContent = fmtBRL(tributavel);
        if (elDetalhe) {
            elDetalhe.textContent = `Presunção de ${(presuncao * 100).toFixed(0)}% sobre ${fmtBRL(faturamento)}.`;
        }
        if (resultado) resultado.hidden = false;
    });
}

// ------------------------------------------------------------
// Checklists com persistência local
// ------------------------------------------------------------
function initChecklist(containerId, storageKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let salvo = {};
    try {
        salvo = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (e) {
        salvo = {};
    }

    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        const chave = checkbox.dataset.key;
        checkbox.checked = Boolean(salvo[chave]);
        checkbox.addEventListener('change', () => {
            salvo[chave] = checkbox.checked;
            try {
                localStorage.setItem(storageKey, JSON.stringify(salvo));
            } catch (e) { /* armazenamento indisponível */ }
        });
    });
}

function limparChecklists() {
    [STORAGE_FUNCIONARIO, STORAGE_DOCUMENTOS].forEach((chave) => {
        try { localStorage.removeItem(chave); } catch (e) { /* ignore */ }
    });
    document.querySelectorAll('.mei-checklist input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = false;
    });
}

// ------------------------------------------------------------
// Calendário fiscal
// ------------------------------------------------------------
function renderizarCalendario() {
    const container = document.getElementById('meiCalendario');
    if (!container) return;

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mesAtual = hoje.getMonth();

    const meses = MESES.map((nome, indice) => {
        const chips = ['<span class="mei-mes-chip chip-das">20 · DAS</span>'];
        if (indice === 4) {
            chips.push('<span class="mei-mes-chip chip-dasn">31 · DASN</span>');
        }
        return `
            <div class="mei-mes${indice === mesAtual ? ' atual' : ''}">
                <span class="mei-mes-nome">${nome}</span>
                <div class="mei-mes-chips">${chips.join('')}</div>
            </div>`;
    }).join('');

    container.innerHTML = `<div class="mei-calendario-ano">Calendário de ${ano}</div>${meses}`;
}

// ------------------------------------------------------------
// Modal de informação
// ------------------------------------------------------------
function initModal() {
    const overlay = document.getElementById('meiModalOverlay');
    const titulo = document.getElementById('meiModalTitulo');
    const texto = document.getElementById('meiModalTexto');
    const fechar = document.getElementById('meiModalFechar');
    const btnSobre = document.getElementById('btnSobreDocumentos');
    if (!overlay || !titulo || !texto || !fechar) return;

    const abrir = (t, m) => {
        titulo.textContent = t;
        texto.textContent = m;
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('active'));
    };

    const fecharModal = () => {
        overlay.classList.remove('active');
        setTimeout(() => { overlay.hidden = true; }, 150);
    };

    if (btnSobre) {
        btnSobre.addEventListener('click', () => {
            abrir(
                'Guarda de documentos por 5 anos',
                'A Receita Federal pode exigir a comprovação das suas receitas e dos recolhimentos por até 5 anos. Guarde notas fiscais emitidas e recebidas, relatórios mensais de receitas, comprovantes do DAS e o recibo da DASN-SIMEI. Sem esses documentos, uma cobrança ou fiscalização pode ficar difícil de contestar.'
            );
        });
    }

    fechar.addEventListener('click', fecharModal);
    overlay.addEventListener('click', (evento) => {
        if (evento.target === overlay) fecharModal();
    });
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape' && !overlay.hidden) fecharModal();
    });
}

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
function iniciarPaginaMei() {
    renderizarPrazos();
    renderizarCalendario();
    renderizarLimite(0, null);
    initRelatorio();
    initCalculadora();
    initChecklist('checklistFuncionario', STORAGE_FUNCIONARIO);
    initChecklist('checklistDocumentos', STORAGE_DOCUMENTOS);
    initModal();

    const btnLimpar = document.getElementById('btnLimparChecklists');
    if (btnLimpar) btnLimpar.addEventListener('click', limparChecklists);

    carregarDados();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarPaginaMei);
} else {
    iniciarPaginaMei();
}
