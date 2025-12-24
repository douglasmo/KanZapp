const SELECTORS = {
  chatRow: 'div[role="row"]',
  chatName: 'span[title][dir="auto"]',
  chatAvatar: 'img',
  chatLastMsg: 'span[dir="ltr"]',
  sideBar: '#side'
};

function scrapeConversations() {
  const sidePane = document.getElementById('pane-side') || 
                   document.querySelector('.x1n2onr6._ak9y') || 
                   document.querySelector('#side');

  if (!sidePane) return [];

  const rows = sidePane.querySelectorAll(SELECTORS.chatRow);
  const conversations = [];

  rows.forEach(row => {
    const nameElement = row.querySelector('span[title][dir="auto"]') || row.querySelector('span[title]');
    const avatarElement = row.querySelector('img[src*="http"]');
    
    const lastMsgElement = row.querySelector('span[dir="ltr"]') || 
                           row.querySelector('div[role="gridcell"] span[title]') ||
                           row.querySelector('._ak8k span');

    // Extract unread count - usually a span with a specific class or background color
    const unreadElement = row.querySelector('span[aria-label*="não lida"]') || 
                          row.querySelector('._ak8i .x1n2onr6') || // Badge common class
                          row.querySelector('span.x1rg5ohu.x16dsc37'); // Another common class for badges

    let unreadCount = 0;
    if (unreadElement) {
      const text = unreadElement.innerText || "";
      unreadCount = parseInt(text.replace(/\D/g, '')) || 0;
      // If element exists but no number, it might be just a dot (silent)
      if (text === "" && unreadElement) unreadCount = 1;
    }

    if (nameElement && nameElement.title) {
      conversations.push({
        id: nameElement.title,
        name: nameElement.title,
        avatar: avatarElement ? avatarElement.src : '',
        lastMsg: lastMsgElement ? lastMsgElement.innerText : '',
        unreadCount: unreadCount
      });
    }
  });

  return Array.from(new Map(conversations.map(item => [item.id, item])).values());
}

