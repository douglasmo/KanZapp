let activeFollowupModal = null;

async function showFollowupScheduler(contactId, contactName, cardEl) {
  if (activeFollowupModal) {
    activeFollowupModal.remove();
  }

  // Get existing follow-up if any
  const storage = await chrome.storage.local.get('followups');
  const followups = storage.followups || {};
  const existing = followups[contactId];

  const modal = document.createElement('div');
  modal.id = 'followup-modal';
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <div class="modal-content" style="width: 300px;">
      <h3 style="margin-bottom: 15px;">Agendar Follow-up 🔔</h3>
      <p style="font-size: 14px; color: #111b21; margin-bottom: 15px;">Defina um lembrete para falar com <strong>${contactName}</strong></p>
      
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <label style="font-size: 12px; color: #667781;">Título do Lembrete:</label>
        <input type="text" id="followup-title" placeholder="Ex: Retornar orçamento" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
        <label style="font-size: 12px; color: #667781;">Data e Hora:</label>
        <input type="datetime-local" id="followup-datetime" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>

      <div style="display: flex; gap: 10px;">
        <button id="save-followup" style="flex: 1; background: #00a884; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">Agendar</button>
        <button id="cancel-followup" style="flex: 1; background: #eee; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Cancelar</button>
      </div>
      
      ${existing ? `
        <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
        <button id="delete-followup" style="width: 100%; background: #ff5c5c; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Remover Agendamento Atual</button>
      ` : ''}
    </div>
  `;
  document.body.appendChild(modal);
  activeFollowupModal = modal;

  // Set values if existing
  const dtInput = document.getElementById('followup-datetime');
  const titleInput = document.getElementById('followup-title');

  if (existing) {
    titleInput.value = existing.title || "";
    const date = new Date(existing.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    dtInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  } else {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    dtInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  document.getElementById('save-followup').onclick = async () => {
    const val = dtInput.value;
    const title = titleInput.value.trim() || "Sem título";
    if (!val) return;

    const timestamp = new Date(val).getTime();
    if (timestamp < Date.now()) {
      alert("Por favor, selecione uma data e hora no futuro.");
      return;
    }

    // Save to storage
    const storage = await chrome.storage.local.get('followups');
    const followups = storage.followups || {};
    followups[contactId] = {
      contactId,
      contactName,
      title,
      timestamp
    };
    await chrome.storage.local.set({ followups });

    // Schedule alarm
    // chrome.alarms.create takes minutes or absolute time. 
    // In Manifest V3, absolute time can be used.
    chrome.runtime.sendMessage({
      action: 'schedule_alarm',
      name: `followup_${contactId}`,
      when: timestamp
    });

    modal.remove();
    activeFollowupModal = null;
    updateBoard(); // Update to show the active bell
  };

  document.getElementById('cancel-followup').onclick = () => {
    modal.remove();
    activeFollowupModal = null;
  };

  if (document.getElementById('delete-followup')) {
    document.getElementById('delete-followup').onclick = async () => {
      const storage = await chrome.storage.local.get('followups');
      const followups = storage.followups || {};
      delete followups[contactId];
      await chrome.storage.local.set({ followups });

      // Cancel alarm
      chrome.runtime.sendMessage({
        action: 'cancel_alarm',
        name: `followup_${contactId}`
      });

      modal.remove();
      activeFollowupModal = null;
      updateBoard();
    };
  }
}

async function showAllFollowups() {
  const storage = await chrome.storage.local.get(['followups', 'allConversations']);
  const followups = storage.followups || {};
  const allConversations = storage.allConversations || {};
  
  const followupList = Object.values(followups).sort((a, b) => a.timestamp - b.timestamp);

  const modal = document.createElement('div');
  modal.id = 'all-followups-modal';
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <div class="modal-content" style="width: 450px; max-height: 80vh; overflow-y: auto;">
      <h3 style="margin-bottom: 20px;">Todos os Agendamentos 🔔</h3>
      <div id="followups-list">
        ${followupList.length === 0 ? '<p style="color: #666; text-align: center;">Nenhum agendamento pendente.</p>' : followupList.map(f => {
          const chat = allConversations[f.contactId] || {};
          const dateStr = new Date(f.timestamp).toLocaleString('pt-BR');
          return `
            <div class="followup-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f8f9fa; border-radius: 10px; margin-bottom: 10px; border: 1px solid #eee;">
              <div style="width: 45px; height: 45px; border-radius: 50%; overflow: hidden; background: #ccc; flex-shrink: 0;">
                <img src="${chat.avatar || ''}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
              <div style="flex: 1;">
                <div style="font-weight: bold; color: #111b21;">${f.contactName}</div>
                <div style="font-size: 12px; color: #54656f; margin-bottom: 2px;">📌 ${f.title || "Lembrete"}</div>
                <div style="font-size: 13px; color: #ff9800; font-weight: 500;">📅 ${dateStr}</div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="goto-chat" data-name="${f.contactName}" style="background: #00a884; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">Chat</button>
                <button class="remove-f" data-id="${f.contactId}" style="background: #ff5c5c; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">🗑️</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <button id="close-all-followups" style="width: 100%; margin-top: 20px; background: #ccc; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-weight: bold;">Fechar</button>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('.goto-chat').forEach(btn => {
    btn.onclick = () => {
      const name = btn.dataset.name;
      modal.remove();
      if (typeof sendQuickMessage === 'function') {
        sendQuickMessage(name, "");
      }
    };
  });

  modal.querySelectorAll('.remove-f').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const storage = await chrome.storage.local.get('followups');
      const fup = storage.followups || {};
      delete fup[id];
      await chrome.storage.local.set({ followups: fup });
      chrome.runtime.sendMessage({ action: 'cancel_alarm', name: `followup_${id}` });
      modal.remove();
      showAllFollowups();
      if (typeof updateBoard === 'function') updateBoard();
    };
  });

  document.getElementById('close-all-followups').onclick = () => modal.remove();
}

// Export to window
window.showAllFollowups = showAllFollowups;

// Handle incoming follow-up alarms from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Kanban] Mensagem recebida no content script:", message.action);
  if (message.action === "show_followup_toast") {
    createFollowupToast(message.contactId, message.contactName, message.title);
  }
});

function createFollowupToast(contactId, contactName, title) {
  console.log("[Kanban] Criando Toast para:", contactName);
  const toastId = `toast_${contactId}_${Date.now()}`;
  if (document.getElementById(toastId)) return;

  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = 'followup-toast';
  toast.innerHTML = `
    <div class="toast-icon">⏰</div>
    <div class="toast-body">
      <div class="toast-title">${title || "Follow-up pendente"}</div>
      <div class="toast-message">Falar com: <strong>${contactName}</strong></div>
    </div>
    <div class="toast-actions">
      <button class="toast-close" title="Fechar">✕</button>
      <button class="toast-open-chat" data-name="${contactName}">Abrir Conversa</button>
    </div>
  `;

  document.body.appendChild(toast);

  toast.querySelector('.toast-close').onclick = () => {
    toast.remove();
  };

  toast.querySelector('.toast-open-chat').onclick = () => {
    toast.remove();
    if (typeof sendQuickMessage === 'function') {
      // Just open the chat without sending text
      sendQuickMessage(contactName, ""); 
    }
  };
}

