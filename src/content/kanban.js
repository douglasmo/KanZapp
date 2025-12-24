const DEFAULT_COLUMNS = [
  { id: 'todo', title: '📥 Entrada / A Fazer' },
  { id: 'doing', title: '⏳ Em Andamento' },
  { id: 'done', title: '✅ Concluído' }
];

function toggleKanbanBoard(conversations) {
  let board = document.getElementById('kanban-board-overlay');
  if (board) {
    const isHidden = board.style.display === 'none';
    board.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      updateBoard(conversations);
    }
  } else {
    createKanbanBoard(conversations);
  }
}

function createKanbanBoard(conversations) {
  const overlay = document.createElement('div');
  overlay.id = 'kanban-board-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div id="kanban-container">
      <div class="kanban-header">
        <div style="display: flex; align-items: center; gap: 15px; flex: 1; flex-wrap: wrap;">
          <h2 style="margin:0; white-space: nowrap;">WhatsApp Kanban</h2>
          <div class="search-container" style="flex: 1; min-width: 200px; max-width: 300px; position: relative;">
            <input type="text" id="kanban-search" placeholder="Pesquisar..." style="width: 100%; padding: 8px 12px; border-radius: 20px; border: none; outline: none; background: rgba(255,255,255,0.2); color: white; font-size: 14px;">
          </div>
          <div class="tag-filter-container" style="min-width: 150px;">
            <select id="kanban-tag-filter" style="width: 100%; padding: 8px; border-radius: 20px; border: none; background: rgba(255,255,255,0.2); color: white; outline: none; font-size: 14px; cursor: pointer;">
              <option value="" style="color: black;">Filtrar por Tag: Todas</option>
            </select>
          </div>
          <button id="manage-tags-btn" style="background: #ffffff33; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;">🏷️ Tags</button>
          <button id="manage-messages-btn" style="background: #ffffff33; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;">💬 Mensagens</button>
          <button id="view-followups-btn" style="background: #ffffff33; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;">🔔 Agendamentos</button>
          <button id="add-column-btn" style="background: #ffffff33; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;">➕ Nova Coluna</button>
          <button id="refresh-kanban" style="background: #ffffff33; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;">🔄 Atualizar</button>
        </div>
        <button id="close-kanban" style="margin-left: 15px;">✕</button>
      </div>
      <div id="kanban-columns"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const searchInput = document.getElementById('kanban-search');
  searchInput.addEventListener('input', (e) => {
    updateBoard([], e.target.value);
  });

  document.getElementById('add-column-btn').onclick = async () => {
    const name = prompt('Digite o nome da coluna:');
    if (name) {
      const columns = await getColumns();
      const newId = 'col_' + Date.now();
      columns.push({ id: newId, title: name });
      await saveColumns(columns);
      renderColumns(columns);
      updateBoard([], searchInput.value);
    }
  };

  document.getElementById('manage-tags-btn').onclick = () => showTagManager();

  document.getElementById('manage-messages-btn').onclick = () => showMessageManager();

  document.getElementById('view-followups-btn').onclick = () => showAllFollowups();

  document.getElementById('close-kanban').onclick = () => {
    overlay.style.display = 'none';
    if (activeTagSelector) {
      activeTagSelector.remove();
      activeTagSelector = null;
    }
  };

  document.getElementById('refresh-kanban').onclick = () => {
    const updatedConversations = scrapeConversations();
    updateBoard(updatedConversations, searchInput.value);
  };

  initializeBoard(conversations);
}

async function initializeBoard(conversations) {
  const columns = await getColumns();
  renderColumns(columns);
  updateBoard(conversations);
}

function renderColumns(columns) {
  const container = document.getElementById('kanban-columns');
  if (!container) return;
  container.innerHTML = '';
  
  columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'kanban-column';
    colEl.dataset.status = col.id;
    colEl.innerHTML = `
      <div class="column-header">
        <h3>${col.title}</h3>
        <div class="column-actions">
          <button class="edit-col" title="Editar">✏️</button>
          <button class="delete-col" title="Excluir">🗑️</button>
        </div>
      </div>
      <div class="card-list"></div>
    `;

    colEl.querySelector('.edit-col').onclick = async () => {
      const newTitle = prompt('Novo título para a coluna:', col.title);
      if (newTitle && newTitle !== col.title) {
        const cols = await getColumns();
        const target = cols.find(c => c.id === col.id);
        if (target) {
          target.title = newTitle;
          await saveColumns(cols);
          renderColumns(cols);
          updateBoard();
        }
      }
    };

    colEl.querySelector('.delete-col').onclick = async () => {
      if (confirm(`Excluir coluna "${col.title}"? Os cards serão movidos para a primeira coluna.`)) {
        let cols = await getColumns();
        if (cols.length <= 1) return;
        cols = cols.filter(c => c.id !== col.id);
        await saveColumns(cols);
        const storage = await chrome.storage.local.get(['kanbanData']);
        const kanbanData = storage.kanbanData || {};
        const firstColId = cols[0].id;
        for (const chatId in kanbanData) {
          if (kanbanData[chatId] === col.id) kanbanData[chatId] = firstColId;
        }
        await chrome.storage.local.set({ kanbanData });
        renderColumns(cols);
        updateBoard();
      }
    };
    container.appendChild(colEl);
  });
  setupDragAndDrop();
}

async function updateBoard(newConversations = [], searchTerm = null) {
  const storage = await chrome.storage.local.get(['kanbanData', 'allConversations', 'kanbanColumns', 'kanbanTags', 'contactTags', 'followups']);
  let kanbanData = storage.kanbanData || {};
  let allConversations = storage.allConversations || {};
  let columns = storage.kanbanColumns || DEFAULT_COLUMNS;
  let allTags = storage.kanbanTags || [];
  let contactTags = storage.contactTags || {};
  let followups = storage.followups || {};

  // Update tag filter dropdown
  const tagFilter = document.getElementById('kanban-tag-filter');
  if (tagFilter) {
    const currentVal = tagFilter.value;
    tagFilter.innerHTML = '<option value="" style="color: black;">Filtrar por Tag: Todas</option>';
    allTags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag.id;
      opt.textContent = tag.name;
      opt.style.color = 'black';
      tagFilter.appendChild(opt);
    });
    tagFilter.value = currentVal;
    tagFilter.onchange = () => updateBoard();
  }

  const selectedTagId = tagFilter ? tagFilter.value : '';

  if (searchTerm === null) {
    const searchInput = document.getElementById('kanban-search');
    searchTerm = searchInput ? searchInput.value : '';
  }

  newConversations.forEach(chat => {
    // Merge unreadCount if available
    if (allConversations[chat.id]) {
      allConversations[chat.id] = { ...allConversations[chat.id], ...chat };
    } else {
      allConversations[chat.id] = chat;
    }
  });

  if (newConversations.length > 0) {
    await chrome.storage.local.set({ allConversations });
  }

  document.querySelectorAll('.card-list').forEach(list => list.innerHTML = '');

  const normalizedSearch = searchTerm.toLowerCase().trim();
  const firstColId = columns[0].id;

  Object.values(allConversations).forEach(chat => {
    if (normalizedSearch && !chat.name.toLowerCase().includes(normalizedSearch)) return;

    const currentContactTags = contactTags[chat.id] || [];
    
    // Filter by tag if selected
    if (selectedTagId && !currentContactTags.includes(selectedTagId)) return;

    const chatTags = allTags.filter(t => currentContactTags.includes(t.id));
    const hasFollowup = !!followups[chat.id];

    let status = kanbanData[chat.id] || firstColId;
    if (!columns.find(c => c.id === status)) status = firstColId;

    const column = document.querySelector(`.kanban-column[data-status="${status}"] .card-list`);
    if (!column) return;

    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.draggable = true;
    card.dataset.id = chat.id;
    card.innerHTML = `
      <div class="card-tags" style="display: flex; gap: 4px; margin-bottom: 5px; flex-wrap: wrap; min-height: 8px;">
        ${chatTags.map(t => `<span class="tag-pill" style="padding: 1px 6px; border-radius: 10px; font-size: 9px; color: white; background-color: ${t.color}; font-weight: bold; white-space: nowrap; cursor: help;" title="${t.description || t.name}">${t.name}</span>`).join('')}
      </div>
      <div class="card-content" style="position: relative;">
        <div class="card-avatar-container" style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #ccc; display: flex; align-items: center; justify-content: center; position: relative;">
          ${chat.avatar ? `<img src="${chat.avatar}" class="card-avatar" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML='<span style=\'font-size: 10px;\'>?</span>'">` : '<span style="font-size: 10px;">?</span>'}
          ${chat.unreadCount > 0 ? `<div class="unread-badge" style="position: absolute; top: -5px; right: -5px; background: #ff5c5c; color: white; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; display: flex; align-items: center; justify-content: center; border: 2px solid white; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">${chat.unreadCount}</div>` : ''}
        </div>
        <div class="card-details">
          <div class="card-name" style="${chat.unreadCount > 0 ? 'font-weight: 900;' : ''}">${chat.name}</div>
          <div class="card-lastmsg" style="${chat.unreadCount > 0 ? 'color: #111b21; font-weight: 500;' : ''}">${chat.lastMsg ? (chat.lastMsg.substring(0, 30) + (chat.lastMsg.length > 30 ? '...' : '')) : 'Sem mensagens'}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <button class="add-tag-to-card" title="Tags" style="background: none; border: none; cursor: pointer; padding: 2px; font-size: 12px; opacity: 0.5; align-self: flex-start;">🏷️</button>
          <button class="send-message-to-card" title="Mensagens" style="background: none; border: none; cursor: pointer; padding: 2px; font-size: 12px; opacity: 0.5; align-self: flex-start;">💬</button>
          <button class="schedule-followup" title="Agendar Lembrete" style="background: ${hasFollowup ? '#ff9800' : 'none'}; border: ${hasFollowup ? '2px solid white' : 'none'}; color: ${hasFollowup ? 'white' : 'inherit'}; box-shadow: ${hasFollowup ? '0 0 5px rgba(255,152,0,0.5)' : 'none'}; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; padding: 0; font-size: 12px; opacity: ${hasFollowup ? '1' : '0.5'}; align-self: flex-start; display: flex; align-items: center; justify-content: center;">🔔</button>
        </div>
      </div>
    `;
    
    card.querySelector('.add-tag-to-card').onclick = (e) => {
      e.stopPropagation();
      showTagSelector(chat.id, card);
    };

    card.querySelector('.send-message-to-card').onclick = (e) => {
      e.stopPropagation();
      showMessageSelector(chat.id, card);
    };

    card.querySelector('.schedule-followup').onclick = (e) => {
      e.stopPropagation();
      showFollowupScheduler(chat.id, chat.name, card);
    };

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', chat.id);
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    column.appendChild(card);
  });
}

function setupDragAndDrop() {
  const columns = document.querySelectorAll('.kanban-column');
  columns.forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingCard = document.querySelector('.dragging');
      if (draggingCard) column.querySelector('.card-list').appendChild(draggingCard);
    });
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      const chatId = e.dataTransfer.getData('text/plain');
      const newStatus = column.dataset.status;
      const storage = await chrome.storage.local.get('kanbanData');
      const kanbanData = storage.kanbanData || {};
      kanbanData[chatId] = newStatus;
      await chrome.storage.local.set({ kanbanData });
    });
  });
}

// Export to window
window.updateBoard = updateBoard;
window.toggleKanbanBoard = toggleKanbanBoard;

