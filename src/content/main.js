// Function to inject the Kanban button
let injectionTimeout = null;
function injectKanbanButton() {
  if (document.getElementById('whatsapp-kanban-btn')) return;

  // Debounce injection to avoid multiple UIM root errors and overhead
  if (injectionTimeout) clearTimeout(injectionTimeout);
  injectionTimeout = setTimeout(() => {
    const sideBarHeader = document.querySelector('header') || 
                          document.querySelector('#side header') || 
                          document.querySelector('._ak8t');
    
    if (!sideBarHeader) {
      injectFloatingButton();
      return;
    }

    // Double check if already exists after timeout
    if (document.getElementById('whatsapp-kanban-btn-container')) return;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'whatsapp-kanban-btn-container';
    btnContainer.style.display = 'flex';
    btnContainer.style.alignItems = 'center';
    btnContainer.style.padding = '0 10px';

    const btn = document.createElement('button');
    btn.id = 'whatsapp-kanban-btn';
    btn.innerHTML = '📊';
    btn.title = 'Abrir Kanban';
    btn.style.fontSize = '20px';
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const conversations = scrapeConversations();
      toggleKanbanBoard(conversations);
    };

    btnContainer.appendChild(btn);
    sideBarHeader.appendChild(btnContainer);
  }, 1000); // 1 second debounce
}

function injectFloatingButton() {
  if (document.getElementById('whatsapp-kanban-btn-floating')) return;

  const btn = document.createElement('button');
  btn.id = 'whatsapp-kanban-btn-floating';
  btn.innerHTML = '📊 Kanban';
  btn.style.position = 'fixed';
  btn.style.bottom = '20px';
  btn.style.left = '20px';
  btn.style.zIndex = '9999';
  btn.style.padding = '10px 15px';
  btn.style.backgroundColor = '#00a884';
  btn.style.color = 'white';
  btn.style.border = 'none';
  btn.style.borderRadius = '50px';
  btn.style.cursor = 'pointer';
  btn.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';

  btn.onclick = () => {
    const conversations = scrapeConversations();
    toggleKanbanBoard(conversations);
  };

  document.body.appendChild(btn);
}

console.log("WhatsApp Kanban Extension loaded");
const observer = new MutationObserver(() => injectKanbanButton());
observer.observe(document.body, { childList: true, subtree: true });

