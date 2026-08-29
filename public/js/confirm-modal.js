// Modal de confirmação estilizado
function confirmModal(titulo, mensagem) {
  return new Promise((resolve) => {
    let overlay = document.getElementById('confirmModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirmModalOverlay';
      overlay.className = 'modal-confirmar-overlay';
      overlay.innerHTML = `
        <div class="modal-confirmar">
          <div class="modal-confirmar-icone">⚠</div>
          <div class="modal-confirmar-titulo" id="confirmModalTitle"></div>
          <div class="modal-confirmar-mensagem" id="confirmModalMsg"></div>
          <div class="modal-confirmar-botoes">
            <button class="modal-confirmar-cancelar" id="confirmModalCancel">Cancelar</button>
            <button class="modal-confirmar-excluir" id="confirmModalOk">Excluir</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    document.getElementById('confirmModalTitle').textContent = titulo;
    document.getElementById('confirmModalMsg').textContent = mensagem;
    overlay.classList.add('active');

    const cancel = document.getElementById('confirmModalCancel');
    const ok = document.getElementById('confirmModalOk');

    const cleanup = () => {
      overlay.classList.remove('active');
      cancel.replaceWith(cancel.cloneNode(true));
      ok.replaceWith(ok.cloneNode(true));
    };

    document.getElementById('confirmModalCancel').addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    document.getElementById('confirmModalOk').addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });
  });
}
