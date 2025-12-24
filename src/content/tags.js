let activeTagSelector = null;

async function showTagManager() {
  const tags = await getTags();
  const modal = document.createElement('div');
  modal.id = 'tag-manager-modal';
  modal.innerHTML = `
    <div class="modal-content" style="width: 400px;">
      <h3>Gerenciar Tags</h3>
      <div id="tags-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 15px;">
        ${tags.length === 0 ? '<p style="color: #666;">Nenhuma tag criada.</p>' : tags.map(tag => `
          <div class="tag-item" style="display: flex; flex-direction: column; padding: 10px; border: 1px solid #eee; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="tag-preview" style="background-color: ${tag.color}">${tag.name}</span>
              <button class="delete-tag" data-id="${tag.id}">🗑️</button>
            </div>
            ${tag.description ? `<div style="font-size: 11px; color: #667781; margin-top: 4px;">${tag.description}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
      <div class="new-tag-form" style="display: flex; flex-direction: column; gap: 8px;">
        <input type="text" id="new-tag-name" placeholder="Nome da tag (ex: VIP)">
        <input type="text" id="new-tag-desc" placeholder="Descrição (opcional)">
        <div style="display: flex; align-items: center; gap: 10px;">
          <label style="font-size: 14px;">Cor:</label>
          <input type="color" id="new-tag-color" value="#00a884" style="border: none; width: 30px; height: 30px; cursor: pointer;">
        </div>
        <button id="save-new-tag" style="background: #00a884; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">Salvar Tag</button>
      </div>
      <button id="close-tag-modal" style="width: 100%; margin-top: 10px; background: #ccc; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">Fechar</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('save-new-tag').onclick = async () => {
    const name = document.getElementById('new-tag-name').value;
    const description = document.getElementById('new-tag-desc').value;
    const color = document.getElementById('new-tag-color').value;
    if (name) {
      const currentTags = await getTags();
      currentTags.push({ id: 'tag_' + Date.now(), name, description, color });
      await saveTags(currentTags);
      modal.remove();
      showTagManager();
      updateBoard();
    }
  };

  modal.querySelectorAll('.delete-tag').forEach(btn => {
    btn.onclick = async () => {
      const tagId = btn.dataset.id;
      let currentTags = await getTags();
      currentTags = currentTags.filter(t => t.id !== tagId);
      await saveTags(currentTags);
      const contactTags = await getContactTags();
      for (let chatId in contactTags) {
        contactTags[chatId] = contactTags[chatId].filter(id => id !== tagId);
      }
      await saveContactTags(contactTags);
      modal.remove();
      showTagManager();
      updateBoard();
    };
  });

  document.getElementById('close-tag-modal').onclick = () => modal.remove();
}

async function showTagSelector(chatId, cardEl) {
  if (activeTagSelector) {
    activeTagSelector.remove();
    activeTagSelector = null;
  }

  const allTags = await getTags();
  const contactTags = await getContactTags();
  const currentTags = contactTags[chatId] || [];

  const selector = document.createElement('div');
  selector.className = 'tag-selector-popup';
  activeTagSelector = selector;

  selector.innerHTML = `
    <h4 style="color: #111b21; margin-bottom: 10px; font-size: 14px; font-weight: bold;">Selecionar Tags</h4>
    <div class="tags-options" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding-right: 5px;">
      ${allTags.length === 0 ? '<p style="color: #666; font-size: 12px;">Crie tags no botão "Tags" primeiro.</p>' : allTags.map(tag => `
        <label class="tag-option" style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #111b21; padding: 4px; border-radius: 4px;">
          <input type="checkbox" data-id="${tag.id}" ${currentTags.includes(tag.id) ? 'checked' : ''}>
          <span class="tag-pill" style="background-color: ${tag.color}; padding: 2px 8px; border-radius: 12px; color: white; font-size: 11px; font-weight: bold; flex: 1; text-align: center;">${tag.name}</span>
        </label>
      `).join('')}
    </div>
    <div style="margin-top: 15px; display: flex; gap: 8px; border-top: 1px solid #eee; padding-top: 10px;">
      <button id="save-contact-tags" style="background: #00a884; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; flex: 1;">Salvar</button>
      <button id="cancel-contact-tags" style="background: #f0f2f5; color: #54656f; border: 1px solid #d1d7db; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; flex: 1;">Cancelar</button>
    </div>
  `;

  const rect = cardEl.getBoundingClientRect();
  selector.style.position = 'fixed';
  let top = rect.top;
  let left = rect.right + 10;
  if (left + 220 > window.innerWidth) left = rect.left - 230;
  if (top + 250 > window.innerHeight) top = window.innerHeight - 260;

  selector.style.top = `${Math.max(10, top)}px`;
  selector.style.left = `${Math.max(10, left)}px`;
  selector.style.zIndex = '10001';
  document.body.appendChild(selector);

  document.getElementById('save-contact-tags').onclick = async () => {
    const selected = Array.from(selector.querySelectorAll('input:checked')).map(i => i.dataset.id);
    const allContactTags = await getContactTags();
    allContactTags[chatId] = selected;
    await saveContactTags(allContactTags);
    selector.remove();
    activeTagSelector = null;
    updateBoard();
  };

  document.getElementById('cancel-contact-tags').onclick = () => {
    selector.remove();
    activeTagSelector = null;
  };

  setTimeout(() => {
    const closeListener = (e) => {
      if (activeTagSelector && !selector.contains(e.target) && !cardEl.contains(e.target)) {
        selector.remove();
        activeTagSelector = null;
        document.removeEventListener('mousedown', closeListener);
      }
    };
    document.addEventListener('mousedown', closeListener);
  }, 10);
}

