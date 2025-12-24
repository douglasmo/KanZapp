chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes("web.whatsapp.com")) {
    chrome.tabs.sendMessage(tab.id, { action: "toggle_kanban" });
  } else {
    console.log("Not on WhatsApp Web");
  }
});

// Handle follow-up alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('followup_')) {
    const contactId = alarm.name.replace('followup_', '');
    
    const storage = await chrome.storage.local.get('followups');
    const followups = storage.followups || {};
    const details = followups[contactId];

    if (details) {
      // 1. Native Notification
      chrome.notifications.create(alarm.name, {
        type: 'basic',
        iconUrl: 'https://cdn-icons-png.flaticon.com/128/3602/3602145.png',
        title: `Lembrete: ${details.title || "Follow-up"} 🔔`,
        message: `Hora de falar com: ${details.contactName}`,
        priority: 2,
        requireInteraction: true
      });

      // 2. Send message to content script for Toast
      console.log(`[Kanban] Alarme disparado para: ${details.contactName}. Tentando mostrar Toast no navegador...`);
      chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
        if (tabs.length === 0) console.log("[Kanban] Nenhuma aba do WhatsApp encontrada para o Toast.");
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: "show_followup_toast",
            contactId: contactId,
            contactName: details.contactName,
            title: details.title || "Lembrete"
          }).catch(() => {});
        });
      });
    }
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'schedule_alarm') {
    chrome.alarms.create(message.name, { when: message.when });
    console.log(`[Kanban] Alarme agendado: ${message.name}`);
  } else if (message.action === 'cancel_alarm') {
    chrome.alarms.clear(message.name);
    console.log(`[Kanban] Alarme cancelado: ${message.name}`);
  }
});

// Handle notification click
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('followup_')) {
    chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    });
  }
});
