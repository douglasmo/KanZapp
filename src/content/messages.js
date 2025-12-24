let activeMessageSelector = null;

async function showMessageManager() {
  const messages = await getMessages();
  const modal = document.createElement('div');
  modal.id = 'message-manager-modal';
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Gerenciar Mensagens Prontas</h3>
      <div id="messages-list" style="max-height: 250px; overflow-y: auto; margin-bottom: 15px;">
        ${messages.length === 0 ? '<p style="color: #666;">Nenhuma mensagem criada.</p>' : messages.map(msg => `
          <div class="message-item" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 8px; border: 1px solid #eee;">
            <div style="flex: 1; margin-right: 10px;">
              <div style="font-weight: bold; color: #111b21;">${msg.title}</div>
              <div style="font-size: 12px; color: #667781; white-space: pre-wrap;">${msg.text}</div>
            </div>
            <button class="delete-message" data-id="${msg.id}" style="background: none; border: none; cursor: pointer; padding: 5px;">🗑️</button>
          </div>
        `).join('')}
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
      <div class="new-message-form" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
        <input type="text" id="new-msg-title" placeholder="Título da mensagem (ex: Saudação)">
        <textarea id="new-msg-text" placeholder="Texto da mensagem" style="height: 80px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical;"></textarea>
        <button id="save-new-message" style="background: #00a884; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">Salvar Mensagem</button>
      </div>
      <button id="close-message-modal" style="width: 100%; background: #ccc; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">Fechar</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('save-new-message').onclick = async () => {
    const title = document.getElementById('new-msg-title').value;
    const text = document.getElementById('new-msg-text').value;
    if (title && text) {
      const currentMessages = await getMessages();
      currentMessages.push({ id: 'msg_' + Date.now(), title, text });
      await saveMessages(currentMessages);
      modal.remove();
      showMessageManager();
      updateBoard();
    }
  };

  modal.querySelectorAll('.delete-message').forEach(btn => {
    btn.onclick = async () => {
      const msgId = btn.dataset.id;
      let currentMessages = await getMessages();
      currentMessages = currentMessages.filter(m => m.id !== msgId);
      await saveMessages(currentMessages);
      modal.remove();
      showMessageManager();
      updateBoard();
    };
  });

  document.getElementById('close-message-modal').onclick = () => modal.remove();
}

async function showMessageSelector(chatId, cardEl) {
  if (activeMessageSelector) {
    activeMessageSelector.remove();
    activeMessageSelector = null;
  }

  const messages = await getMessages();

  const selector = document.createElement('div');
  selector.className = 'message-selector-popup';
  activeMessageSelector = selector;

  selector.innerHTML = `
    <h4 style="color: #111b21; margin-bottom: 10px; font-size: 14px; font-weight: bold;">Enviar Mensagem</h4>
    <div class="messages-options" style="display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto;">
      ${messages.length === 0 ? '<p style="color: #666; font-size: 12px;">Crie mensagens no botão "Mensagens" primeiro.</p>' : messages.map(msg => `
        <div class="msg-option" data-id="${msg.id}" style="padding: 8px; background: #f0f2f5; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
          <div style="font-weight: bold; font-size: 13px; color: #111b21;">${msg.title}</div>
          <div style="font-size: 11px; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${msg.text}</div>
        </div>
      `).join('')}
    </div>
    <button id="cancel-message-selector" style="width: 100%; margin-top: 10px; background: #eee; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 12px;">Cancelar</button>
  `;

  const rect = cardEl.getBoundingClientRect();
  selector.style.position = 'fixed';
  let top = rect.top;
  let left = rect.right + 10;
  if (left + 220 > window.innerWidth) left = rect.left - 230;
  if (top + 280 > window.innerHeight) top = window.innerHeight - 290;

  selector.style.top = `${Math.max(10, top)}px`;
  selector.style.left = `${Math.max(10, left)}px`;
  selector.style.zIndex = '10001';
  document.body.appendChild(selector);

  selector.querySelectorAll('.msg-option').forEach(opt => {
    opt.onclick = async () => {
      const msgId = opt.dataset.id;
      const msg = messages.find(m => m.id === msgId);
      if (msg) {
        selector.remove();
        activeMessageSelector = null;
        await sendQuickMessage(chatId, msg.text);
      }
    };

    opt.onmouseenter = () => opt.style.background = '#e9edef';
    opt.onmouseleave = () => opt.style.background = '#f0f2f5';
  });

  document.getElementById('cancel-message-selector').onclick = () => {
    selector.remove();
    activeMessageSelector = null;
  };

  setTimeout(() => {
    const closeListener = (e) => {
      if (activeMessageSelector && !selector.contains(e.target) && !cardEl.contains(e.target)) {
        selector.remove();
        activeMessageSelector = null;
        document.removeEventListener('mousedown', closeListener);
      }
    };
    document.addEventListener('mousedown', closeListener);
  }, 10);
}

async function sendQuickMessage(chatName, text) {
  console.log("%c[Kanban] 🚀 Iniciando processo de envio para: " + chatName, "color: #00a884; font-weight: bold; font-size: 12px;");
  
  const board = document.getElementById('kanban-board-overlay');
  if (board) board.style.display = 'none';

  const paneSide = document.getElementById('pane-side') || 
                   document.querySelector('.x1n2onr6._ak9y') || 
                   document.querySelector('#side');

  if (!paneSide) {
    console.error("[Kanban] ❌ ERRO: Painel lateral não encontrado!");
    alert("Erro crítico: Painel lateral do WhatsApp não encontrado.");
    return;
  }

  const rows = paneSide.querySelectorAll('div[role="row"]');
  let targetRow = null;
  
  for (const row of rows) {
    const titleSpan = row.querySelector('span[title][dir="auto"]') || 
                      row.querySelector('span[title]') ||
                      row.querySelector('[title]');
    
    if (titleSpan) {
      const rowTitle = titleSpan.title || titleSpan.getAttribute('title');
      if (rowTitle === chatName) {
        targetRow = row;
        break;
      }
    }
  }

  if (!targetRow) {
    console.error("[Kanban] ❌ ERRO: Contato não encontrado na lista lateral:", chatName);
    alert(`Contato "${chatName}" não encontrado. Tente rolar a lista lateral para que ele apareça.`);
    if (board) board.style.display = 'flex';
    return;
  }

  console.log("[Kanban] ✅ Contato localizado. Preparando clique...");
  targetRow.scrollIntoView({ block: 'center' });
  
  // Tenta clicar em diferentes partes do row para garantir
  const clickTargets = [
    targetRow.querySelector('div[role="gridcell"]'),
    targetRow.querySelector('._ak8l'), // Container comum de chats
    targetRow.querySelector('span[title]'),
    targetRow
  ].filter(el => el !== null);

  console.log("[Kanban] 🖱️ Disparando eventos de clique em", clickTargets.length, "alvos...");
  
  clickTargets.forEach(target => {
    ['mousedown', 'mouseup', 'click'].forEach(evtType => {
      target.dispatchEvent(new MouseEvent(evtType, {
        view: window, bubbles: true, cancelable: true, buttons: 1
      }));
    });
  });

  console.log("[Kanban] ⏳ Aguardando montagem do campo de texto...");
  
  let attempts = 0;
  const maxAttempts = 60; 
  const interval = setInterval(() => {
    attempts++;
    
    // Verificadores de estado
    const mainArea = document.getElementById('main');
    const footer = document.querySelector('footer');
    
    // Busca exaustiva pelo input
    const messageInput = 
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][aria-placeholder*="mensagem"]') ||
      document.querySelector('div[contenteditable="true"][aria-placeholder*="message"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]:not(#side *)');
    
    if (messageInput) {
      console.log("[Kanban] 🎯 SUCESSO! Campo de texto encontrado na tentativa", attempts);
      clearInterval(interval);
      
      setTimeout(() => {
        messageInput.focus();
        console.log("[Kanban] 📝 Inserindo texto...");
        document.execCommand('insertText', false, text);
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log("[Kanban] ✅ PROCESSO CONCLUÍDO!");
      }, 300);
      
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      
      console.group("%c[Kanban] ❌ TIMEOUT: Falha ao encontrar o input", "color: red; font-weight: bold;");
      console.log("Estado Final:");
      console.log("- Área #main presente:", !!mainArea);
      console.log("- Footer presente:", !!footer);
      console.log("- Foco atual:", document.activeElement);
      
      const allEditables = document.querySelectorAll('div[contenteditable="true"]');
      console.log("- Todos ContentEditables na tela:", allEditables.length);
      allEditables.forEach((el, i) => {
        console.log(`  [${i}] Placeholder: "${el.getAttribute('aria-placeholder')}" | Label: "${el.getAttribute('aria-label')}" | Parent:`, el.parentElement.tagName);
      });
      console.groupEnd();

      alert("Não foi possível detectar a abertura do chat. Verifique o console para detalhes.");
      if (board) board.style.display = 'flex';
    } else if (attempts % 10 === 0) {
      console.log(`[Kanban] ... ainda buscando (${attempts}/${maxAttempts}). #main:${!!mainArea} footer:${!!footer}`);
    }
  }, 300);
}

// Export to window for access from other modules
window.sendQuickMessage = sendQuickMessage;
window.showMessageManager = showMessageManager;
window.showMessageSelector = showMessageSelector;

