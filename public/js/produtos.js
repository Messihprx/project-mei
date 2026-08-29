import { supabase } from './auth.js';

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
async function carregarProdutos(filtro = '') {
    const container = document.getElementById('listaProdutos');
    if (!container) return;

    try {
        let query = supabase.from('produtos').select('*').order('created_at', { ascending: false });
        if (filtro) query = query.ilike('nome', `%${filtro}%`);

        const { data: produtos, error } = await query;
        if (error) throw error;

        if (!produtos || produtos.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--texto-secundario); margin-top:2rem;">
                ${filtro ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}
            </p>`;
            return;
        }

        container.innerHTML = produtos.map(p => `
            <div class="produto-card">
                <div class="produto-info">
                    ${p.foto_url
                        ? `<img src="${p.foto_url}" class="produto-thumb" alt="${p.nome}">`
                        : `<div class="produto-thumb-placeholder">
                             <i data-lucide="package" style="width: 20px; color: white;"></i>
                           </div>`
                    }
                    <div class="produto-texto">
                        <h4>${p.nome}</h4>
                        <p>${p.descricao ? p.descricao.substring(0, 50) + (p.descricao.length > 50 ? '...' : '') : 'Sem descrição'}</p>
                    </div>
                </div>
                <div class="produto-preco-acoes">
                    <span class="produto-preco">R$ ${parseFloat(p.valor).toFixed(2)}</span>
                    <div class="produto-acoes">
                        <button onclick="editarProduto('${p.id}')" class="btn-acao btn-edit" title="Editar">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button onclick="deletarProduto('${p.id}', '${p.foto_url || ''}')" class="btn-acao btn-delete" title="Excluir">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');


        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error("Erro ao carregar produtos:", err.message);
    }
}

// --- EDITAR ---
window.editarProduto = async function (id) {
    try {
        const { data, error } = await supabase.from('produtos').select('*').eq('id', id).single();
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
        await removerFotoStorage(fotoUrl);
        carregarProdutos(document.getElementById('buscarProduto')?.value || '');
    } catch (err) {
        mostrarModal('Erro ao excluir', traduzirErro(err.message));
    }
};

// --- SUBMIT NOVO ---
const formNovo = document.getElementById('formNovoProduto');
if (formNovo) {
    formNovo.addEventListener('submit', async (e) => {
        e.preventDefault();
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

// --- BUSCA ---
const inputBusca = document.getElementById('buscarProduto');
if (inputBusca) {
    inputBusca.addEventListener('input', (e) => {
        clearTimeout(window.buscaProdutoTimer);
        window.buscaProdutoTimer = setTimeout(() => {
            carregarProdutos(e.target.value);
        }, 300);
    });
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

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
