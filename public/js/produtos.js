import { supabase } from './auth.js';
import { esc, delegate, buscarTodasAsLinhas } from './dom-utils.js';
import { protegerAcao, invalidarCachePlano } from './planos.js';
import { criarDataTable } from './datatable.js';

// Produtos da última renderização: os botões guardam só o id.
let produtosRenderizados = [];

let fotoFile = null;
let editFotoFile = null;
let editFotoUrlAtual = null;

// --- COMPRESSÃO DE IMAGEM ---
function comprimirImagem(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;

                if (w > maxWidth) {
                    h = (h * maxWidth) / w;
                    w = maxWidth;
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const ext = file.type === 'image/png' ? 'png' : 'jpg';
                        const compressed = new File([blob], `produto.${ext}`, { type: blob.type });
                        resolve(compressed);
                    } else {
                        reject(new Error('Falha ao comprimir imagem'));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('Erro ao carregar imagem'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
        reader.readAsDataURL(file);
    });
}

// --- UPLOAD PARA SUPABASE STORAGE ---
async function uploadFoto(userId, file) {
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
        .from('produtos')
        .upload(path, file, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from('produtos').getPublicUrl(path);
    return urlData.publicUrl;
}

// --- REMOVER FOTO DO STORAGE ---
async function removerFotoStorage(fotoUrl) {
    if (!fotoUrl) return;
    try {
        const url = new URL(fotoUrl);
        const pathParts = url.pathname.split('/produtos/');
        if (pathParts[1]) {
            await supabase.storage.from('produtos').remove([pathParts[1]]);
        }
    } catch (_) {}
}

// --- DROP ZONES ---
function setupDropZone(dropId, inputId, onFile) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--cor-primaria)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--borda-cor)'; });
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = 'var(--borda-cor)';
        if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
        if (input.files.length) onFile(input.files[0]);
    });
}

// --- MODAL NOVO ---
window.abrirModalProduto = function () {
    document.getElementById('modalProduto').style.display = 'flex';
    document.getElementById('formNovoProduto').reset();
    fotoFile = null;
    document.getElementById('fotoPreview').style.display = 'none';
    document.getElementById('dropZoneProduto').style.display = 'flex';
    lucide.createIcons();
};

window.fecharModalProduto = function () {
    document.getElementById('modalProduto').style.display = 'none';
};

window.removerFoto = function () {
    fotoFile = null;
    document.getElementById('fotoPreview').style.display = 'none';
    document.getElementById('dropZoneProduto').style.display = 'flex';
    document.getElementById('fotoProduto').value = '';
};

// --- MODAL EDITAR ---
window.fecharModalEditarProduto = function () {
    document.getElementById('modalEditarProduto').style.display = 'none';
};

window.removerFotoEdicao = function () {
    editFotoFile = null;
    editFotoUrlAtual = null;
    document.getElementById('editFotoPreview').style.display = 'none';
    document.getElementById('dropZoneEditarProduto').style.display = 'flex';
    document.getElementById('editFotoProduto').value = '';
};

// --- CARREGAR PRODUTOS ---
let tabelaProdutos = null;

function montarTabelaProdutos(container) {
    tabelaProdutos = criarDataTable({
        container,
        idLinha: (produto) => produto.id,
        porPagina: 10,
        placeholderBusca: 'Buscar por nome ou descrição...',
        textoVazio: 'Nenhum produto cadastrado ainda.',
        filtros: [
            {
                id: 'preco',
                rotulo: 'Preço',
                opcoes: [
                    { valor: '', texto: 'Todos' },
                    { valor: 'ate50', texto: 'Até R$ 50' },
                    { valor: '50a200', texto: 'R$ 50 a 200' },
                    { valor: 'acima200', texto: 'Acima de R$ 200' },
                ],
                testar: (produto, valor) => {
                    const preco = Number(produto.valor || 0);
                    if (valor === 'ate50') return preco <= 50;
                    if (valor === '50a200') return preco > 50 && preco <= 200;
                    if (valor === 'acima200') return preco > 200;
                    return true;
                },
            },
        ],
        colunas: [
            {
                id: 'nome',
                titulo: 'Produto',
                valor: (produto) => produto.nome || '',
                buscaTexto: (produto) => `${produto.nome || ''} ${produto.descricao || ''}`,
                render: (produto) => {
                    const descricao = produto.descricao
                        ? produto.descricao.substring(0, 60) + (produto.descricao.length > 60 ? '...' : '')
                        : 'Sem descrição';
                    return `<div class="dt-celula-principal">
                        ${produto.foto_url
                            ? `<img src="${esc(produto.foto_url)}" class="dt-thumb" alt="${esc(produto.nome)}">`
                            : `<span class="dt-thumb-placeholder"><i data-lucide="package"></i></span>`
                        }
                        <span class="dt-celula-texto">
                            <span class="dt-nome">${esc(produto.nome)}</span>
                            <span class="dt-sub">${esc(descricao)}</span>
                        </span>
                    </div>`;
                },
            },
            {
                id: 'valor',
                titulo: 'Valor',
                alinhamento: 'right',
                valor: (produto) => Number(produto.valor || 0),
                ordenarPor: (produto) => Number(produto.valor || 0),
                buscaTexto: (produto) => `R$ ${Number(produto.valor || 0).toFixed(2).replace('.', ',')}`,
                render: (produto) => `<span class="dt-valor">R$ ${Number(produto.valor || 0).toFixed(2).replace('.', ',')}</span>`,
            },
            {
                id: 'acoes',
                titulo: '',
                ordenavel: false,
                busca: false,
                alinhamento: 'right',
                render: (produto) => `<div class="dt-acoes">
                    <button data-acao="editar" data-id="${esc(produto.id)}" class="btn-acao btn-edit" title="Editar">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button data-acao="excluir" data-id="${esc(produto.id)}" class="btn-acao btn-delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>`,
            },
        ],
    });
}

async function carregarProdutos() {
    const container = document.getElementById('listaProdutos');
    if (!container) return;

    if (!tabelaProdutos) {
        container.innerHTML = '<p class="dt-carregando">Carregando produtos...</p>';
    }

    try {
        const produtos = await buscarTodasAsLinhas((inicio, fim) =>
            supabase.from('produtos')
                .select('id, nome, descricao, valor, foto_url')
                .order('created_at', { ascending: false })
                .order('id', { ascending: true })
                .range(inicio, fim)
        );

        produtosRenderizados = produtos;

        if (!tabelaProdutos) montarTabelaProdutos(container);
        tabelaProdutos.atualizar(produtos);

        atualizarCardsProdutos(produtos);

    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
        if (!tabelaProdutos) {
            container.innerHTML = '<p style="color:red">Erro ao carregar dados.</p>';
        } else {
            mostrarModal('Erro ao carregar', 'Não foi possível carregar os produtos. Tente novamente.', 'alerta');
        }
    }
}

// --- CARDS INFORMATIVOS PRODUTOS ---
function atualizarCardsProdutos(produtos) {
    const total = produtos.length;
    const valores = produtos.map(p => Number(p.valor || 0));
    const media = total > 0 ? valores.reduce((s, v) => s + v, 0) / total : 0;
    const maisCaro = total > 0 ? Math.max(...valores) : 0;
    const maisBarato = total > 0 ? Math.min(...valores) : 0;

    const elTotal = document.getElementById("cardTotalProdutos");
    const elMedia = document.getElementById("cardMediaProdutos");
    const elMaior = document.getElementById("cardMaiorProduto");
    const elMenor = document.getElementById("cardMenorProduto");
    const elSubTotal = document.getElementById("cardSubProdutos");
    const elSubMedia = document.getElementById("cardSubMediaProdutos");
    const elSubMaior = document.getElementById("cardSubMaiorProduto");
    const elSubMenor = document.getElementById("cardSubMenorProduto");

    if (elTotal) elTotal.textContent = total.toLocaleString('pt-BR');
    if (elMedia) elMedia.textContent = `R$ ${media.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elMaior) elMaior.textContent = `R$ ${maisCaro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elMenor) elMenor.textContent = `R$ ${maisBarato.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (elSubTotal) elSubTotal.textContent = total === 1 ? '1 produto cadastrado' : `${total} produtos no catálogo`;
    if (elSubMedia) elSubMedia.textContent = total > 0 ? `média de R$ ${media.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Sem produtos cadastrados';
    if (elSubMaior) elSubMaior.textContent = total > 0 ? 'produto mais caro' : 'Sem produtos cadastrados';
    if (elSubMenor) elSubMenor.textContent = total > 0 ? 'produto mais barato' : 'Sem produtos cadastrados';
}

// --- EDITAR ---
window.editarProduto = async function (id) {
    try {
        const { data, error } = await supabase.from('produtos').select('id, nome, descricao, valor, foto_url').eq('id', id).single();
        if (error) throw error;

        document.getElementById('editProdutoId').value = data.id;
        document.getElementById('editNomeProduto').value = data.nome;
        document.getElementById('editDescProduto').value = data.descricao || '';
        document.getElementById('editValorProduto').value = data.valor;

        editFotoFile = null;
        editFotoUrlAtual = data.foto_url;

        if (data.foto_url) {
            document.getElementById('editImgPreview').src = data.foto_url;
            document.getElementById('editFotoPreview').style.display = 'block';
            document.getElementById('dropZoneEditarProduto').style.display = 'none';
        } else {
            document.getElementById('editFotoPreview').style.display = 'none';
            document.getElementById('dropZoneEditarProduto').style.display = 'flex';
        }

        document.getElementById('modalEditarProduto').style.display = 'flex';
        lucide.createIcons();
    } catch (err) {
        mostrarModal('Erro ao buscar produto', traduzirErro(err.message));
    }
};

// --- DELETAR ---
window.deletarProduto = async function (id, fotoUrl) {
    const confirmed = await confirmModal('Excluir produto', 'Tem certeza que deseja excluir este produto? Essa ação não pode ser desfeita.');
    if (!confirmed) return;

    try {
        const { error } = await supabase.from('produtos').delete().eq('id', id);
        if (error) throw error;
        // A contagem mudou: o aviso de limite não pode continuar
        // mostrando o número anterior a esta operação.
        invalidarCachePlano();
        await removerFotoStorage(fotoUrl);
        carregarProdutos();
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

// --- SUBMIT NOVO ---
const formNovo = document.getElementById('formNovoProduto');
if (formNovo) {
    // Produtos também têm limite de plano (max_produtos), aplicado por
    // trigger no banco. Sem esta chamada o usuário só descobria ao
    // salvar, com erro cru — enquanto em Clientes e Vendas ele é
    // avisado antes de digitar.
    protegerAcao('formNovoProduto', 'produto');

    formNovo.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await protegerAcao('formNovoProduto', 'produto')) return;

        const btn = formNovo.querySelector('button[type="submit"]');

        try {
            btn.disabled = true;
            btn.innerText = 'Salvando...';

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado.');

            let fotoUrl = null;
            if (fotoFile) {
                const comprimida = await comprimirImagem(fotoFile);
                fotoUrl = await uploadFoto(user.id, comprimida);
            }

            const dados = {
                nome: document.getElementById('nomeProduto').value.trim(),
                descricao: document.getElementById('descProduto').value.trim(),
                valor: parseFloat(document.getElementById('valorProduto').value),
                foto_url: fotoUrl,
                user_id: user.id
            };

            const { error } = await supabase.from('produtos').insert([dados]);
            if (error) throw error;
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            fecharModalProduto();
            carregarProdutos();
        } catch (err) {
            mostrarModal('Erro ao salvar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = 'Salvar Produto';
        }
    });
}

// --- SUBMIT EDITAR ---
const formEditar = document.getElementById('formEditarProduto');
if (formEditar) {
    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = formEditar.querySelector('button[type="submit"]');
        const id = document.getElementById('editProdutoId').value;

        try {
            btn.disabled = true;
            btn.innerText = 'Salvando...';

            let fotoUrl = editFotoUrlAtual;

            if (editFotoFile) {
                await removerFotoStorage(editFotoUrlAtual);
                const { data: { user } } = await supabase.auth.getUser();
                const comprimida = await comprimirImagem(editFotoFile);
                fotoUrl = await uploadFoto(user.id, comprimida);
            } else if (editFotoUrlAtual === null && !editFotoFile) {
                fotoUrl = null;
            }

            const dados = {
                nome: document.getElementById('editNomeProduto').value.trim(),
                descricao: document.getElementById('editDescProduto').value.trim(),
                valor: parseFloat(document.getElementById('editValorProduto').value),
                foto_url: fotoUrl
            };

            const { error } = await supabase.from('produtos').update(dados).eq('id', id);
            if (error) throw error;
            // A contagem mudou: o aviso de limite não pode continuar
            // mostrando o número anterior a esta operação.
            invalidarCachePlano();

            fecharModalEditarProduto();
            carregarProdutos();
        } catch (err) {
            mostrarModal('Erro ao salvar', traduzirErro(err.message));
        } finally {
            btn.disabled = false;
            btn.innerText = 'Salvar Alterações';
        }
    });
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login';
        return;
    }

    // Delegação: um listener na grade inteira, no lugar dos onclick
    // inline que interpolavam foto_url e nome direto no HTML.
    delegate(document.getElementById('listaProdutos'), 'button[data-acao]', 'click', (e, botao) => {
        const produto = produtosRenderizados.find(x => x.id === botao.dataset.id);
        if (!produto) return;
        if (botao.dataset.acao === 'editar') {
            window.editarProduto(produto.id);
        } else if (botao.dataset.acao === 'excluir') {
            window.deletarProduto(produto.id, produto.foto_url || '');
        }
    });

    carregarProdutos();

    setupDropZone('dropZoneProduto', 'fotoProduto', async (file) => {
        if (!file.type.startsWith('image/')) {
            mostrarModal('Formato inválido', 'Selecione uma imagem.');
            return;
        }
        fotoFile = file;
        const comprimida = await comprimirImagem(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('imgPreview').src = e.target.result;
            document.getElementById('fotoPreview').style.display = 'block';
            document.getElementById('dropZoneProduto').style.display = 'none';
        };
        reader.readAsDataURL(comprimida);
    });

    setupDropZone('dropZoneEditarProduto', 'editFotoProduto', async (file) => {
        if (!file.type.startsWith('image/')) {
            mostrarModal('Formato inválido', 'Selecione uma imagem.');
            return;
        }
        editFotoFile = file;
        const comprimida = await comprimirImagem(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('editImgPreview').src = e.target.result;
            document.getElementById('editFotoPreview').style.display = 'block';
            document.getElementById('dropZoneEditarProduto').style.display = 'none';
        };
        reader.readAsDataURL(comprimida);
    });
});
