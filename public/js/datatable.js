// ============================================================
// DataTable leve, sem dependências
//
// As listagens de vendas, gastos, clientes e produtos eram
// cartões empilhados. Aqui elas viram uma tabela com:
//   - busca instantânea (ignora acentos, espaços e pontuação);
//   - filtros por coluna definidos pela própria tela;
//   - ordenação ao clicar no cabeçalho;
//   - paginação no navegador.
//
// O componente recebe os dados já carregados e devolve os mesmos
// objetos nas linhas, então os botões de editar/excluir continuam
// funcionando com o delegate + data-id de cada página.
// ============================================================

import { esc } from './dom-utils.js';

const SVG_BUSCA =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>';

const SVG_SETA = {
    none:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m7 9 5-5 5 5"></path><path d="m7 15 5 5 5-5"></path></svg>',
    asc:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m7 14 5-5 5 5"></path></svg>',
    desc:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m7 10 5 5 5-5"></path></svg>',
};

// Busca tolerante: "João" casa com "joao", "1.234,56" com "1234,56"
// e telefones com ou sem máscara.
function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function comparar(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', {
        numeric: true,
        sensitivity: 'base',
    });
}

function classeAlinhamento(coluna) {
    if (coluna.alinhamento === 'right') return 'dt-al-right';
    if (coluna.alinhamento === 'center') return 'dt-al-center';
    return '';
}

/**
 * Cria uma tabela interativa dentro de `container`.
 *
 * @param {Object} opcoes
 * @param {HTMLElement} opcoes.container       elemento que recebe a tabela
 * @param {Array} opcoes.colunas               definição das colunas
 * @param {Array} [opcoes.filtros]             filtros por coluna
 * @param {Function} [opcoes.idLinha]          id estável de cada linha
 * @param {number} [opcoes.porPagina]          linhas por página (10 por padrão)
 * @param {string} [opcoes.placeholderBusca]   texto do campo de busca
 * @param {string} [opcoes.textoVazio]         mensagem quando não há linhas
 * @param {{coluna:string,direcao:'asc'|'desc'}} [opcoes.ordenacaoInicial]
 *
 * Coluna:
 *   { id, titulo, valor, render?, ordenarPor?, buscaTexto?,
 *     ordenavel?, busca?, alinhamento?, classe? }
 *   - valor: texto/número usado na busca e na ordenação;
 *   - render: HTML da célula (a tela é responsável por escapar);
 *   - ordenarPor: valor alternativo para ordenar (ex.: data ISO);
 *   - busca: false para colunas sem busca (ex.: ações).
 *
 * Filtro:
 *   { id, rotulo, opcoes:[{valor,texto}], testar:(linha, valor)=>boolean }
 */
export function criarDataTable(opcoes = {}) {
    const container = opcoes.container;
    if (!container) throw new Error('criarDataTable: container é obrigatório.');

    const colunas = opcoes.colunas || [];
    const filtros = opcoes.filtros || [];
    const idLinha = opcoes.idLinha || (() => '');
    const porPaginaInicial = Number(opcoes.porPagina) || 10;

    // O seletor de linhas por página precisa mostrar o valor atual,
    // mesmo que a tela peça um tamanho fora da lista padrão.
    const opcoesPorPagina = [...new Set([10, 25, 50, 100, porPaginaInicial])]
        .sort((a, b) => a - b);

    const state = {
        dados: [],
        filtrados: [],
        busca: '',
        filtros: {},
        ordenacao: opcoes.ordenacaoInicial ? { ...opcoes.ordenacaoInicial } : null,
        pagina: 1,
        porPagina: porPaginaInicial,
    };

    filtros.forEach((filtro) => {
        state.filtros[filtro.id] = filtro.opcoes?.[0]?.valor ?? '';
    });

    container.innerHTML = `
        <div class="dt">
            <div class="dt-toolbar">
                <div class="dt-busca">
                    ${SVG_BUSCA}
                    <input type="search" class="dt-busca-input"
                        placeholder="${esc(opcoes.placeholderBusca || 'Buscar...')}"
                        aria-label="${esc(opcoes.placeholderBusca || 'Buscar')}"
                        autocomplete="off">
                </div>
                <div class="dt-filtros">
                    ${filtros.map((filtro) => `
                        <label class="dt-filtro">
                            <span>${esc(filtro.rotulo || filtro.id)}</span>
                            <select class="dt-filtro-select" data-filtro="${esc(filtro.id)}">
                                ${(filtro.opcoes || []).map((opcao) => `
                                    <option value="${esc(opcao.valor)}">${esc(opcao.texto)}</option>
                                `).join('')}
                            </select>
                        </label>
                    `).join('')}
                    <label class="dt-filtro dt-filtro-pagina">
                        <span>Linhas</span>
                        <select class="dt-por-pagina" aria-label="Linhas por página">
                            ${opcoesPorPagina.map((n) => `
                                <option value="${n}" ${n === porPaginaInicial ? 'selected' : ''}>${n}</option>
                            `).join('')}
                        </select>
                    </label>
                </div>
            </div>
            <div class="dt-tabela-wrap">
                <table class="dt-tabela">
                    <thead><tr></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="dt-rodape">
                <span class="dt-info"></span>
                <div class="dt-paginacao"></div>
            </div>
        </div>
    `;

    const el = {
        busca: container.querySelector('.dt-busca-input'),
        porPagina: container.querySelector('.dt-por-pagina'),
        theadRow: container.querySelector('.dt-tabela thead tr'),
        tbody: container.querySelector('.dt-tabela tbody'),
        info: container.querySelector('.dt-info'),
        paginacao: container.querySelector('.dt-paginacao'),
        tabelaWrap: container.querySelector('.dt-tabela-wrap'),
    };

    function montarCabecalho() {
        el.theadRow.innerHTML = colunas.map((coluna) => {
            const ordenavel = coluna.ordenavel !== false;
            const ativa = state.ordenacao?.coluna === coluna.id;
            const direcao = ativa ? state.ordenacao.direcao : null;
            const classes = [
                ordenavel ? 'dt-ordenavel' : '',
                coluna.classe || '',
                classeAlinhamento(coluna),
            ].filter(Boolean).join(' ');
            const ariaSort = ativa ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none';

            return `<th scope="col" class="${classes}"
                    ${ordenavel ? `data-coluna="${esc(coluna.id)}" aria-sort="${ariaSort}" tabindex="0" role="button"` : ''}>
                <span class="dt-th-conteudo">
                    ${esc(coluna.titulo || '')}
                    ${ordenavel ? `<span class="dt-seta ${ativa ? 'ativa' : ''}">${SVG_SETA[direcao || 'none']}</span>` : ''}
                </span>
            </th>`;
        }).join('');
    }

    function calcularFiltrados() {
        const termo = normalizar(state.busca);

        let linhas = state.dados.filter((linha) => {
            for (const filtro of filtros) {
                const valor = state.filtros[filtro.id];
                if (valor && !filtro.testar(linha, valor)) return false;
            }

            if (!termo) return true;

            return colunas.some((coluna) => {
                if (coluna.busca === false) return false;
                const texto = coluna.buscaTexto
                    ? coluna.buscaTexto(linha)
                    : (coluna.valor ? coluna.valor(linha) : '');
                return normalizar(texto).includes(termo);
            });
        });

        if (state.ordenacao) {
            const coluna = colunas.find((c) => c.id === state.ordenacao.coluna);
            if (coluna) {
                const fator = state.ordenacao.direcao === 'asc' ? 1 : -1;
                const valorDe = coluna.ordenarPor || coluna.valor || (() => '');
                linhas = linhas.slice().sort((a, b) => fator * comparar(valorDe(a), valorDe(b)));
            }
        }

        state.filtrados = linhas;
    }

    function renderPaginacao(totalPaginas) {
        const botoes = [];

        botoes.push(`<button type="button" class="dt-pagina-btn" data-pagina="1"
            ${state.pagina === 1 ? 'disabled' : ''} aria-label="Primeira página">«</button>`);
        botoes.push(`<button type="button" class="dt-pagina-btn" data-pagina="${state.pagina - 1}"
            ${state.pagina === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>`);

        const janela = 5;
        let inicioJanela = Math.max(1, state.pagina - Math.floor(janela / 2));
        let fimJanela = Math.min(totalPaginas, inicioJanela + janela - 1);
        inicioJanela = Math.max(1, fimJanela - janela + 1);

        for (let p = inicioJanela; p <= fimJanela; p++) {
            botoes.push(`<button type="button"
                class="dt-pagina-btn ${p === state.pagina ? 'ativo' : ''}"
                data-pagina="${p}" aria-label="Página ${p}"
                ${p === state.pagina ? 'aria-current="page"' : ''}>${p}</button>`);
        }

        botoes.push(`<button type="button" class="dt-pagina-btn" data-pagina="${state.pagina + 1}"
            ${state.pagina === totalPaginas ? 'disabled' : ''} aria-label="Próxima página">›</button>`);
        botoes.push(`<button type="button" class="dt-pagina-btn" data-pagina="${totalPaginas}"
            ${state.pagina === totalPaginas ? 'disabled' : ''} aria-label="Última página">»</button>`);

        el.paginacao.innerHTML = botoes.join('');
    }

    function render() {
        calcularFiltrados();

        const total = state.filtrados.length;
        const totalPaginas = Math.max(1, Math.ceil(total / state.porPagina));
        state.pagina = Math.min(Math.max(1, state.pagina), totalPaginas);

        const inicio = (state.pagina - 1) * state.porPagina;
        const fim = Math.min(inicio + state.porPagina, total);
        const visiveis = state.filtrados.slice(inicio, fim);

        if (visiveis.length === 0) {
            el.tbody.innerHTML = `<tr><td colspan="${colunas.length}" class="dt-vazio">
                ${esc(opcoes.textoVazio || 'Nenhum registro encontrado.')}
            </td></tr>`;
        } else {
            el.tbody.innerHTML = visiveis.map((linha) => {
                const id = idLinha(linha);
                const celulas = colunas.map((coluna) => {
                    const conteudo = coluna.render
                        ? coluna.render(linha)
                        : esc(coluna.valor ? coluna.valor(linha) : '');
                    const classes = [coluna.classe || '', classeAlinhamento(coluna)]
                        .filter(Boolean).join(' ');
                    return `<td class="${classes}">${conteudo}</td>`;
                }).join('');

                return `<tr ${id ? `data-linha="${esc(id)}"` : ''}>${celulas}</tr>`;
            }).join('');
        }

        el.info.textContent = total === 0
            ? 'Nenhum registro'
            : `Mostrando ${inicio + 1}–${fim} de ${total} ${total === 1 ? 'registro' : 'registros'}`;

        renderPaginacao(totalPaginas);

        if (window.lucide) window.lucide.createIcons();
    }

    // --- Eventos ---
    let timerBusca;
    el.busca.addEventListener('input', (e) => {
        const valor = e.target.value;
        clearTimeout(timerBusca);
        timerBusca = setTimeout(() => {
            state.busca = valor;
            state.pagina = 1;
            render();
        }, 200);
    });

    container.querySelectorAll('[data-filtro]').forEach((select) => {
        select.addEventListener('change', () => {
            state.filtros[select.dataset.filtro] = select.value;
            state.pagina = 1;
            render();
        });
    });

    el.porPagina.addEventListener('change', () => {
        state.porPagina = Number(el.porPagina.value) || 10;
        state.pagina = 1;
        render();
    });

    function alternarOrdenacao(coluna) {
        if (state.ordenacao?.coluna === coluna) {
            state.ordenacao.direcao = state.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
        } else {
            state.ordenacao = { coluna, direcao: 'asc' };
        }

        state.pagina = 1;
        montarCabecalho();
        render();
    }

    el.theadRow.addEventListener('click', (e) => {
        const th = e.target.closest('[data-coluna]');
        if (th) alternarOrdenacao(th.dataset.coluna);
    });

    el.theadRow.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const th = e.target.closest('[data-coluna]');
        if (!th) return;
        e.preventDefault();
        alternarOrdenacao(th.dataset.coluna);
    });

    el.paginacao.addEventListener('click', (e) => {
        const botao = e.target.closest('[data-pagina]');
        if (!botao || botao.disabled) return;

        const pagina = Number(botao.dataset.pagina);
        if (!pagina || pagina === state.pagina) return;

        state.pagina = pagina;
        render();
        el.tabelaWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    montarCabecalho();
    render();

    return {
        /** Troca os dados mantendo busca, filtros e ordenação. */
        atualizar(novosDados) {
            state.dados = Array.isArray(novosDados) ? novosDados : [];
            render();
        },
        /** Força uma nova renderização (após mudanças externas). */
        filtrar() {
            render();
        },
        get dadosFiltrados() {
            return state.filtrados;
        },
        get total() {
            return state.filtrados.length;
        },
        elemento: container,
    };
}
