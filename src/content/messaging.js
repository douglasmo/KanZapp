// Ponte tipada entre o content script e o service worker. O protocolo canonico
// vive em core/constants; aliases antigos continuam aceitos durante updates.

import {
  LEGACY_ALARM_PREFIX,
  LEGACY_MSG,
  MSG,
  messageTypeOf
} from '../core/constants.js';

function runtimeFromGlobal() {
  try {
    return typeof chrome !== 'undefined' ? chrome.runtime : null;
  } catch {
    return null;
  }
}

function runtimeAlive(runtime) {
  try {
    return Boolean(runtime?.id && typeof runtime.sendMessage === 'function');
  } catch {
    return false;
  }
}

function respond(sendResponse, payload) {
  if (typeof sendResponse !== 'function') return;
  try {
    sendResponse(payload);
  } catch {
    // A porta pode ter sido fechada enquanto uma operacao assincrona rodava.
  }
}

/**
 * Cria o cliente de mensagens usado pelas views. `runtime` e injetavel para o
 * teste de contrato entre content e background.
 */
export function createMessenger(logger, { runtime = runtimeFromGlobal() } = {}) {
  const log = logger || { warn() {} };

  function send(payload) {
    return new Promise((resolve) => {
      if (!runtimeAlive(runtime)) {
        resolve(null);
        return;
      }
      try {
        runtime.sendMessage(payload, (response) => {
          let error = null;
          try {
            error = runtime.lastError;
          } catch {
            error = null;
          }
          if (error) {
            log.warn('mensagem ao service worker falhou:', error.message);
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch (error) {
        log.warn('mensagem ao service worker falhou', error);
        resolve(null);
      }
    });
  }

  return {
    send,
    scheduleFollowup(data) {
      const contactId = String(data?.contactId || '');
      const timestamp = Number(data?.timestamp);
      return send({
        type: MSG.SCHEDULE_ALARM,
        action: LEGACY_MSG.SCHEDULE_ALARM,
        contactId,
        name: `${LEGACY_ALARM_PREFIX}${contactId}`,
        when: timestamp,
        timestamp,
        contactName: data?.contactName || '',
        title: data?.title || '',
        followup: data
      });
    },
    cancelFollowup(contactId) {
      const id = String(contactId || '');
      return send({
        type: MSG.CANCEL_ALARM,
        action: LEGACY_MSG.CANCEL_ALARM,
        contactId: id,
        name: `${LEGACY_ALARM_PREFIX}${id}`
      });
    },
    syncFollowups() {
      return send({
        type: MSG.SYNC_ALARMS,
        action: LEGACY_MSG.SYNC_ALARMS
      });
    }
  };
}

/**
 * Listener do content script. Fica isolado do boot para ser testavel sem DOM e
 * para que todos os caminhos (type novo ou action antiga) usem a mesma regra.
 */
export function createContentMessageHandler({ appRoot, store, composer, logger } = {}) {
  const log = logger || { warn() {} };

  return function onRuntimeMessage(message, sender, sendResponse) {
    void sender;
    const type = messageTypeOf(message);

    if (type === MSG.TOGGLE_BOARD) {
      appRoot?.toggle?.();
      respond(sendResponse, { ok: true, open: Boolean(appRoot?.isOpen?.()) });
      return false;
    }

    if (type === MSG.OPEN_BOARD) {
      appRoot?.open?.();
      respond(sendResponse, { ok: true });
      return false;
    }

    if (type === MSG.FOLLOWUP_DUE) {
      const name = message?.contactName || message?.followup?.contactName || 'contato';
      const title = message?.title || message?.followup?.title || 'Follow-up';
      appRoot?.toast?.(`${title} — ${name}`, {
        type: 'warn',
        duration: 12000,
        action: { label: 'Abrir quadro', onClick: () => appRoot?.open?.() }
      });
      respond(sendResponse, { ok: true });
      return false;
    }

    if (type === MSG.OPEN_CHAT) {
      const contactId = String(message?.contactId || '');
      const contact = store?.getState?.()?.contacts?.[contactId] || null;
      if (!contact || typeof composer?.openChat !== 'function') {
        appRoot?.open?.();
        appRoot?.toast?.('Não foi possível localizar esse contato no quadro.', { type: 'warn' });
        respond(sendResponse, { ok: false, reason: contact ? 'composer-unavailable' : 'contact-not-found' });
        return false;
      }

      // O overlay aberto impediria o usuario de ver a conversa selecionada.
      appRoot?.close?.();
      Promise.resolve(composer.openChat(contact))
        .then((result) => {
          const ok = result?.ok !== false;
          if (!ok) {
            appRoot?.toast?.(result?.reason || 'Não foi possível abrir a conversa.', { type: 'error' });
          }
          respond(sendResponse, { ok, via: result?.via, reason: result?.reason });
        })
        .catch((error) => {
          log.warn('abertura de conversa pedida pelo background falhou', error);
          appRoot?.toast?.('Não foi possível abrir a conversa.', { type: 'error' });
          respond(sendResponse, { ok: false, reason: 'open-chat-failed' });
        });
      return true;
    }

    return false;
  };
}
