async function getColumns() {
  const storage = await chrome.storage.local.get('kanbanColumns');
  return storage.kanbanColumns || DEFAULT_COLUMNS;
}

async function saveColumns(columns) {
  await chrome.storage.local.set({ kanbanColumns: columns });
}

async function getTags() {
  const storage = await chrome.storage.local.get('kanbanTags');
  return storage.kanbanTags || [];
}

async function saveTags(tags) {
  await chrome.storage.local.set({ kanbanTags: tags });
}

async function getContactTags() {
  const storage = await chrome.storage.local.get('contactTags');
  return storage.contactTags || {};
}

async function saveContactTags(contactTags) {
  await chrome.storage.local.set({ contactTags });
}

async function getMessages() {
  const storage = await chrome.storage.local.get('kanbanMessages');
  return storage.kanbanMessages || [];
}

async function saveMessages(messages) {
  await chrome.storage.local.set({ kanbanMessages: messages });
}

