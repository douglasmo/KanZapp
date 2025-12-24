let activeNotesModal = null;

async function showNotesModal(contactId, contactName) {
  if (activeNotesModal) {
    activeNotesModal.remove();
  }

  // Get existing notes
  const storage = await chrome.storage.local.get('contactNotes');
  const contactNotes = storage.contactNotes || {};
  const notes = contactNotes[contactId] || "";

  const modal = document.createElement('div');
  modal.id = 'notes-modal';
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <div class="modal-content" style="width: 350px;">
      <h3 style="margin-bottom: 15px;">Anotações Internas 📝</h3>
      <p style="font-size: 13px; color: #667781; margin-bottom: 10px;">Notas sobre <strong>${contactName}</strong> (apenas você vê isto).</p>
      
      <textarea id="internal-note-text" style="width: 100%; height: 150px; padding: 10px; border: 1px solid #ccc; border-radius: 8px; resize: none; font-family: inherit; font-size: 14px; margin-bottom: 15px;" placeholder="Digite aqui suas observações sobre este cliente...">${notes}</textarea>

      <div style="display: flex; gap: 10px;">
        <button id="save-note" style="flex: 1; background: #00a884; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">Salvar Nota</button>
        <button id="close-note-modal" style="flex: 1; background: #eee; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  activeNotesModal = modal;

  document.getElementById('save-note').onclick = async () => {
    const newNote = document.getElementById('internal-note-text').value.trim();
    
    const storage = await chrome.storage.local.get('contactNotes');
    const contactNotes = storage.contactNotes || {};
    
    if (newNote) {
      contactNotes[contactId] = newNote;
    } else {
      delete contactNotes[contactId];
    }
    
    await chrome.storage.local.set({ contactNotes });
    
    modal.remove();
    activeNotesModal = null;
    if (typeof updateBoard === 'function') updateBoard();
  };

  document.getElementById('close-note-modal').onclick = () => {
    modal.remove();
    activeNotesModal = null;
  };
}

// Export to window
window.showNotesModal = showNotesModal;

