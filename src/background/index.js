// Service worker (ESM). Responsavel por: alternar o board, alarmes de
// follow-up, notificacoes com icone local e badge de vencidos.
// Nao toca chrome.storage direto: tudo pelo storage-driver.

import {
  MSG,
  LEGACY_MSG,
  ALARM_PREFIX,
  LEGACY_ALARM_PREFIX,
  COMMAND_TOGGLE,
  LEGACY_KEYS,
  ACCENT,
  messageTypeOf
} from '../core/constants.js';
import { createStorageDriver } from '../core/storage-driver.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('bg');
const driver = createStorageDriver({ area: 'local', logger: log });

const WA_URL = 'https://web.whatsapp.com/';
const WA_QUERY = '*://web.whatsapp.com/*';
const ICON = 'assets/icon128.png';

function iconUrl() {
  try {
    return chrome.runtime.getURL(ICON);
  } catch {
    return ICON;
  }
}

function alarmNameFor(contactId) {
  return `${ALARM_PREFIX}${contactId}`;
}

function contactIdFromAlarm(name) {
  const value = String(name || '');
  if (value.startsWith(ALARM_PREFIX)) return value.slice(ALARM_PREFIX.length);
  if (value.startsWith(LEGACY_ALARM_PREFIX)) return value.slice(LEGACY_ALARM_PREFIX.length);
  return value;
}

function queryTabs(query) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(query, (tabs) => {
        void chrome.runtime.lastError;
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch {
      resolve([]);
    }
  });
}

function sendToTab(tabId, message, { requireAck = false } = {}) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        // Em uma aba recem-criada o content script pode ainda nao ter subido.
        const error = chrome.runtime.lastError;
        if (error) {
          resolve(false);
          return;
        }
        resolve(requireAck ? response?.ok === true : response?.ok !== false);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Le os follow-ups do estado v2; cai para as chaves v1 se ainda nao migrou. */
async function readFollowups() {
  const state = await driver.read();
  // Um mapa vazio no estado v2 e autoritativo: cair para a v1 aqui faria
  // lembretes ja removidos ressuscitarem depois de reiniciar o navegador.
  const fromV2 = state?.followups;
  if (fromV2 && typeof fromV2 === 'object' && !Array.isArray(fromV2)) return fromV2;
  const legacy = await driver.readRaw(LEGACY_KEYS);
  const fromV1 = legacy?.followups;
  return fromV1 && typeof fromV1 === 'object' && !Array.isArray(fromV1) ? fromV1 : {};
}

async function updateBadge({ fresh = false } = {}) {
  if (fresh) driver.invalidate();
  const followups = await readFollowups();
  const now = Date.now();
  const overdue = Object.values(followups).filter(
    (f) => f && !f.done && Number(f.timestamp) <= now
  ).length;
  try {
    await chrome.action.setBadgeText({ text: overdue > 0 ? String(overdue) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: ACCENT });
  } catch (error) {
    log.debug('badge indisponivel', error);
  }
}

async function toggleBoard() {
  const tabs = await queryTabs({ url: WA_QUERY });
  const active = tabs.find((t) => t.active) || tabs[0];
  if (!active) {
    try {
      await chrome.tabs.create({ url: WA_URL });
    } catch (error) {
      log.warn('nao foi possivel abrir o WhatsApp Web', error);
    }
    return;
  }
  // `type` e `action` com o mesmo valor: tolera listener que cheque qualquer um
  await sendToTab(active.id, { type: MSG.TOGGLE_BOARD, action: LEGACY_MSG.TOGGLE_BOARD });
  try {
    await chrome.tabs.update(active.id, { active: true });
    if (active.windowId !== undefined) await chrome.windows.update(active.windowId, { focused: true });
  } catch (error) {
    log.debug('foco na aba falhou', error);
  }
}

async function notifyFollowup(contactId, details) {
  const name = alarmNameFor(contactId);
  let notificationCreated = false;
  try {
    await chrome.notifications.create(name, {
      type: 'basic',
      iconUrl: iconUrl(),
      title: `Lembrete: ${details.title || 'Follow-up'}`,
      message: `Hora de falar com ${details.contactName || 'o contato'}`,
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: 'Abrir conversa' }, { title: 'Adiar 1 h' }]
    });
    notificationCreated = true;
  } catch (error) {
    log.warn('notificacao falhou', error);
  }
  const tabs = await queryTabs({ url: WA_QUERY });
  for (const tab of tabs) {
    await sendToTab(tab.id, {
      type: MSG.FOLLOWUP_DUE,
      action: LEGACY_MSG.FOLLOWUP_DUE,
      contactId,
      contactName: details.contactName || '',
      title: details.title || 'Lembrete'
    });
  }
  await updateBadge();
  return notificationCreated;
}

async function scheduleAlarm(contactId, when) {
  const timestamp = Number(when);
  if (!contactId || !Number.isFinite(timestamp)) return false;
  try {
    await chrome.alarms.create(alarmNameFor(contactId), { when: timestamp });
    return true;
  } catch (error) {
    log.warn('nao foi possivel criar o alarme', error);
    return false;
  }
}

async function cancelAlarm(contactId) {
  if (!contactId) return false;
  try {
    await chrome.alarms.clear(alarmNameFor(contactId));
    return true;
  } catch (error) {
    log.warn('nao foi possivel cancelar o alarme', error);
    return false;
  }
}

/** Move o lembrete para daqui a `hours` horas e reagenda. */
async function snooze(contactId, hours = 1) {
  const when = Date.now() + hours * 3600000;
  await driver.mutate((draft) => {
    if (!draft || !draft.followups || !draft.followups[contactId]) return draft;
    draft.followups[contactId] = { ...draft.followups[contactId], timestamp: when, done: false };
    return draft;
  });
  await scheduleAlarm(contactId, when);
  await updateBadge();
  return when;
}

/**
 * P9: alarmes se perdem se o navegador estava fechado na hora.
 * No startup recriamos os futuros e disparamos os vencidos.
 */
async function rehydrateAlarms({ fresh = false } = {}) {
  if (fresh) driver.invalidate();
  const followups = await readFollowups();
  const now = Date.now();
  let cleared = 0;
  let scheduled = 0;
  let notified = 0;
  let failed = 0;

  // A importacao por substituicao pode remover follow-ups. Antes de recriar o
  // conjunto autoritativo, apaga alarmes canonicos e legados que sobraram.
  try {
    const alarms = await chrome.alarms.getAll();
    for (const alarm of Array.isArray(alarms) ? alarms : []) {
      if (!alarm?.name?.startsWith(ALARM_PREFIX)
        && !alarm?.name?.startsWith(LEGACY_ALARM_PREFIX)) continue;
      if (await chrome.alarms.clear(alarm.name)) cleared += 1;
    }
  } catch (error) {
    failed += 1;
    log.warn('nao foi possivel limpar alarmes antigos', error);
  }

  for (const [contactId, details] of Object.entries(followups)) {
    if (!details || details.done) continue;
    const timestamp = Number(details.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    if (timestamp > now) {
      if (await scheduleAlarm(contactId, timestamp)) scheduled += 1;
      else failed += 1;
    } else {
      if (await notifyFollowup(contactId, details)) notified += 1;
      else failed += 1;
    }
  }
  await updateBadge();
  return { cleared, scheduled, notified, failed };
}

async function focusWhatsAppTab() {
  const tabs = await queryTabs({ url: WA_QUERY });
  if (tabs.length === 0) {
    try {
      return await chrome.tabs.create({ url: WA_URL, active: true });
    } catch (error) {
      log.warn('nao foi possivel abrir o WhatsApp Web', error);
    }
    return null;
  }
  const tab = tabs[0];
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    log.debug('foco na aba falhou', error);
  }
  return tab;
}

async function sendOpenChatToTab(tabId, contactId, { attempts = 8, retryMs = 500 } = {}) {
  if (tabId == null || !contactId) return false;
  const total = Math.max(1, Math.floor(attempts));
  for (let attempt = 0; attempt < total; attempt += 1) {
    const delivered = await sendToTab(tabId, {
      type: MSG.OPEN_CHAT,
      action: LEGACY_MSG.OPEN_CHAT,
      contactId
    }, { requireAck: true });
    if (delivered) return true;
    if (attempt + 1 < total) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, retryMs)));
    }
  }
  return false;
}

async function openChatFromNotification(contactId, options) {
  const tab = await focusWhatsAppTab();
  if (!tab || tab.id == null) return false;
  return sendOpenChatToTab(tab.id, contactId, options);
}

// --- listeners -------------------------------------------------------------

chrome.action.onClicked.addListener(() => {
  toggleBoard();
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === COMMAND_TOGGLE) toggleBoard();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sender;
  const type = messageTypeOf(message);
  if (type === MSG.SCHEDULE_ALARM) {
    const contactId = message?.contactId || contactIdFromAlarm(message?.name);
    const when = message?.when ?? message?.timestamp ?? message?.followup?.timestamp;
    scheduleAlarm(contactId, when).then(async (ok) => {
      await updateBadge({ fresh: true });
      sendResponse({ ok });
    });
    return true; // resposta assincrona (o v1 nao respondia)
  }
  if (type === MSG.CANCEL_ALARM) {
    const contactId = message?.contactId || contactIdFromAlarm(message?.name);
    cancelAlarm(contactId).then(async (ok) => {
      await updateBadge({ fresh: true });
      sendResponse({ ok });
    });
    return true;
  }
  if (type === MSG.SYNC_ALARMS) {
    rehydrateAlarms({ fresh: true })
      .then((summary) => sendResponse({ ok: summary.failed === 0, ...summary }))
      .catch((error) => {
        log.warn('sincronizacao de alarmes falhou', error);
        sendResponse({ ok: false, reason: 'sync-alarms-failed' });
      });
    return true;
  }
  if (type === MSG.PING) {
    sendResponse({ ok: true, at: Date.now() });
    return false;
  }
  return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name?.startsWith(ALARM_PREFIX)
    && !alarm?.name?.startsWith(LEGACY_ALARM_PREFIX)) return;
  const contactId = contactIdFromAlarm(alarm.name);
  const followups = await readFollowups();
  const details = followups[contactId];
  if (!details || details.done) return;
  await notifyFollowup(contactId, details);
});

chrome.notifications?.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith(ALARM_PREFIX)) return;
  await focusWhatsAppTab();
  try {
    await chrome.notifications.clear(notificationId);
  } catch {
    /* ja fechada */
  }
});

chrome.notifications?.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith(ALARM_PREFIX)) return;
  const contactId = contactIdFromAlarm(notificationId);
  let shouldClear = false;
  if (buttonIndex === 0) {
    shouldClear = await openChatFromNotification(contactId);
    if (!shouldClear) {
      // Mantem a notificacao: depois que o WhatsApp terminar de carregar, o
      // usuario pode tentar novamente sem perder qual contato deveria abrir.
      log.warn('WhatsApp aberto, mas o content script ainda nao recebeu o contato');
    }
  } else if (buttonIndex === 1) {
    await snooze(contactId, 1);
    shouldClear = true;
  }
  if (shouldClear) {
    try {
      await chrome.notifications.clear(notificationId);
    } catch {
      /* ja fechada */
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  rehydrateAlarms();
});

chrome.runtime.onInstalled.addListener(() => {
  rehydrateAlarms();
});

export {
  toggleBoard,
  rehydrateAlarms,
  snooze,
  updateBadge,
  readFollowups,
  focusWhatsAppTab,
  sendOpenChatToTab,
  openChatFromNotification
};
