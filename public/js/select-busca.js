// Select com busca (combobox) reutilizável — sem framework.
// Funciona em cima de um <input type="text"> ou de um <select> existente
// (o select é substituído visualmente; o valor fica no input e, se o
// elemento original for select, também espelhado num hidden).
//
// const combo = montarSelectBusca(document.getElementById('clienteVendaInput'), {
//     placeholder: 'Buscar cliente...',
//     opcaoVazia: { valor: '', texto: 'Sem cliente (avulso)' },
//     permiteLivre: false,
//     aoSelecionar: (valor, item) => {}
// });
// combo.setOpcoes([{ valor: '1', texto: 'Maria' }]);
// combo.getValor();  // '' | id | texto livre
// combo.setValor('1');

function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function montarMarkup(placeholder) {
    return `
        <div class="select-busca">
            <input type="text" class="select-busca-campo" placeholder="${placeholder}"
                   autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list">
            <div class="select-busca-lista" role="listbox" hidden></div>
        </div>
    `;
}

/**
 * @param {HTMLInputElement|HTMLSelectElement} alvo
 * @param {object} config
 * @param {string} [config.placeholder]
 * @param {{valor: string, texto: string}} [config.opcaoVazia] opção fixa no topo (ex.: "Sem cliente")
 * @param {boolean} [config.permiteLivre] aceita texto fora da lista (ex.: produto avulso)
 * @param {(valor: string, item: object|null) => void} [config.aoSelecionar]
 * @param {(texto: string) => void} [config.aoDigitar] só quando permiteLivre
 * @returns {{setOpcoes: Function, getValor: Function, setValor: Function, getTexto: Function, aoSelecionar: Function|null, el: HTMLDivElement}}
 */
export function montarSelectBusca(alvo, config = {}) {
    if (!alvo || alvo._selectBusca) return alvo?._selectBusca;

    const permiteLivre = !!config.permiteLivre;
    const placeholder = config.placeholder || 'Buscar...';

    let campo;
    let raiz;

    if (alvo.tagName === 'SELECT') {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = montarMarkup(placeholder);
        raiz = wrapper.firstElementChild;
        campo = raiz.querySelector('.select-busca-campo');

        // Espelha o select para name=/required nativos continuarem úteis
        alvo.classList.add('select-busca-oculto');
        alvo.setAttribute('aria-hidden', 'true');
        alvo.tabIndex = -1;
        if (alvo.id) {
            raiz.querySelector('.select-busca-campo').setAttribute('aria-controls', alvo.id);
        }
        alvo.insertAdjacentElement('afterend', raiz);
    } else {
        campo = alvo;
        campo.classList.add('select-busca-campo');
        campo.setAttribute('role', 'combobox');
        campo.setAttribute('aria-expanded', 'false');
        campo.setAttribute('aria-autocomplete', 'list');
        campo.autocomplete = 'off';
        if (config.placeholder) campo.placeholder = placeholder;

        raiz = document.createElement('div');
        raiz.className = 'select-busca';
        campo.insertAdjacentElement('afterend', raiz);
        raiz.appendChild(campo);
        const lista = document.createElement('div');
        lista.className = 'select-busca-lista';
        lista.setAttribute('role', 'listbox');
        lista.hidden = true;
        raiz.appendChild(lista);
    }

    const lista = raiz.querySelector('.select-busca-lista');
    let opcoes = [];
    let valorSelecionado = '';
    let textoSelecionado = '';
    let indiceAtivo = -1;
    let itensVisiveis = [];

    // Valor inicial vindo do select nativo (se aplicável)
    if (alvo.tagName === 'SELECT') {
        const optSelecionada = alvo.querySelector('option:checked, option[selected]');
        const primeira = optSelecionada || alvo.querySelector('option');
        if (primeira && primeira.value !== undefined && alvo.value !== '') {
            valorSelecionado = alvo.value;
            textoSelecionado = primeira.textContent.trim();
            campo.value = textoSelecionado;
        } else if (config.opcaoVazia) {
            campo.value = '';
        }
    }

    function espelharSelect(valor) {
        if (alvo.tagName === 'SELECT') {
            alvo.value = valor;
            // Se o valor não existe como option (livre), garante option temporário
            if (alvo.value !== valor && valor !== '') {
                let opt = alvo.querySelector(`option[data-livre="1"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.dataset.livre = '1';
                    alvo.appendChild(opt);
                }
                opt.value = valor;
                opt.textContent = campo.value;
                alvo.value = valor;
            }
        }
    }

    function fecharLista() {
        lista.hidden = true;
        campo.setAttribute('aria-expanded', 'false');
        indiceAtivo = -1;
    }

    function abrirLista() {
        renderLista(campo.value);
        lista.hidden = itensVisiveis.length === 0;
        campo.setAttribute('aria-expanded', lista.hidden ? 'false' : 'true');
    }

    function destacar(texto, busca) {
        if (!busca) return texto;
        const idx = normalizar(texto).indexOf(normalizar(busca));
        if (idx < 0) return texto;
        // Reconstrói preservando acentos originais do texto
        const antes = texto.slice(0, idx);
        const meio = texto.slice(idx, idx + busca.length);
        const depois = texto.slice(idx + busca.length);
        return `${antes}<mark class="select-busca-match">${meio}</mark>${depois}`;
    }

    function renderLista(filtro) {
        const termo = normalizar(filtro);
        const temFiltro = termo.length > 0;

        itensVisiveis = [];
        lista.innerHTML = '';

        if (config.opcaoVazia && (!temFiltro || normalizar(config.opcaoVazia.texto).includes(termo))) {
            itensVisiveis.push({ ...config.opcaoVazia, _fixa: true });
        }

        for (const op of opcoes) {
            if (!temFiltro || normalizar(op.texto).includes(termo)) {
                itensVisiveis.push(op);
            }
            if (itensVisiveis.length >= 50) break;
        }

        if (permiteLivre && temFiltro && !opcoes.some(o => normalizar(o.texto) === termo)) {
            itensVisiveis.push({ valor: '__livre__', texto: campo.value.trim(), _livre: true });
        }

        itensVisiveis.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'select-busca-item';
            div.setAttribute('role', 'option');
            div.dataset.indice = String(i);
            div.innerHTML = destacar(item._livre ? `Usar "${item.texto}"` : item.texto, temFiltro && !item._livre ? filtro.trim() : '');
            if (item._livre) div.classList.add('select-busca-item-livre');
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                escolher(i);
            });
            div.addEventListener('mouseenter', () => marcarAtivo(i));
            lista.appendChild(div);
        });
    }

    function marcarAtivo(i) {
        indiceAtivo = i;
        lista.querySelectorAll('.select-busca-item').forEach((el, idx) => {
            el.classList.toggle('ativo', idx === i);
        });
        const ativo = lista.children[i];
        if (ativo) ativo.scrollIntoView({ block: 'nearest' });
    }

    function escolher(i) {
        const item = itensVisiveis[i];
        if (!item) return;

        if (item._livre) {
            valorSelecionado = '';
            textoSelecionado = item.texto;
            campo.value = item.texto;
            espelharSelect('');
        } else if (item.valor === (config.opcaoVazia?.valor ?? '')) {
            valorSelecionado = '';
            textoSelecionado = '';
            campo.value = '';
            espelharSelect('');
        } else {
            valorSelecionado = item.valor;
            textoSelecionado = item.texto;
            campo.value = item.texto;
            espelharSelect(item.valor);
        }

        fecharLista();
        if (typeof config.aoSelecionar === 'function') {
            config.aoSelecionar(valorSelecionado, item._livre ? null : item);
        }
    }

    campo.addEventListener('focus', () => {
        campo.select();
        abrirLista();
    });

    campo.addEventListener('input', () => {
        abrirLista();
        if (permiteLivre && typeof config.aoDigitar === 'function') {
            config.aoDigitar(campo.value);
        }
        // Se digitou algo que não é mais a seleção atual, limpa o valor
        if (normalizar(campo.value) !== normalizar(textoSelecionado)) {
            valorSelecionado = '';
            textoSelecionado = '';
            if (alvo.tagName === 'SELECT') alvo.value = '';
        }
    });

    campo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (lista.hidden) abrirLista();
            marcarAtivo(Math.min(indiceAtivo + 1, itensVisiveis.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            marcarAtivo(Math.max(indiceAtivo - 1, 0));
        } else if (e.key === 'Enter') {
            if (!lista.hidden && indiceAtivo >= 0) {
                e.preventDefault();
                escolher(indiceAtivo);
            } else if (!permiteLivre && campo.value.trim()) {
                // Enter com texto sem item destacado: tenta match exato
                e.preventDefault();
                const exato = itensVisiveis.find(it => normalizar(it.texto) === normalizar(campo.value));
                if (exato) escolher(itensVisiveis.indexOf(exato));
            }
        } else if (e.key === 'Escape') {
            fecharLista();
        }
    });

    campo.addEventListener('blur', () => {
        setTimeout(() => {
            fecharLista();
            // Fora da lista: se livre, mantém texto; senão, restaura seleção válida
            if (!permiteLivre) {
                if (valorSelecionado) {
                    campo.value = textoSelecionado;
                } else if (config.opcaoVazia) {
                    campo.value = '';
                    textoSelecionado = '';
                } else if (alvo.tagName === 'SELECT') {
                    campo.value = textoSelecionado;
                }
            } else {
                textoSelecionado = campo.value.trim();
            }
        }, 150);
    });

    const api = {
        el: raiz,
        setOpcoes(novasOpcoes) {
            opcoes = (novasOpcoes || []).map(o => ({
                valor: String(o.valor ?? ''),
                texto: String(o.texto ?? o.nome ?? ''),
                meta: o.meta
            }));
            // Mantém seleção se o valor ainda existir
            if (valorSelecionado && !opcoes.some(o => o.valor === valorSelecionado)) {
                valorSelecionado = '';
                textoSelecionado = '';
                campo.value = '';
            } else if (valorSelecionado) {
                const atual = opcoes.find(o => o.valor === valorSelecionado);
                if (atual) {
                    textoSelecionado = atual.texto;
                    campo.value = atual.texto;
                }
            } else if (!campo.value && config.autoSelecionarUnica && opcoes.length === 1) {
                const unica = opcoes[0];
                valorSelecionado = unica.valor;
                textoSelecionado = unica.texto;
                campo.value = unica.texto;
                espelharSelect(unica.valor);
            }
        },
        getValor() {
            return valorSelecionado;
        },
        getTexto() {
            return permiteLivre ? campo.value.trim() : textoSelecionado;
        },
        setValor(novoValor) {
            const v = String(novoValor ?? '');
            if (v === '') {
                valorSelecionado = '';
                textoSelecionado = '';
                campo.value = '';
                espelharSelect('');
                return;
            }
            const op = opcoes.find(o => o.valor === v);
            if (op) {
                valorSelecionado = op.valor;
                textoSelecionado = op.texto;
                campo.value = op.texto;
                espelharSelect(op.valor);
            }
        },
        limpar() {
            api.setValor('');
        },
        focar() {
            campo.focus();
        },
        get aoSelecionar() {
            return config.aoSelecionar;
        },
        set aoSelecionar(fn) {
            config.aoSelecionar = fn;
        }
    };

    campo._selectBusca = api;
    alvo._selectBusca = api;
    raiz._selectBusca = api;
    return api;
}
