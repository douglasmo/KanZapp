import { describe, it, expect } from '../run.mjs';
import { installChromeStub } from '../chrome-stub.mjs';
import {
  ALARM_PREFIX,
  LEGACY_MSG,
  MSG,
  STORAGE_KEY,
  defaultState,
  messageTypeOf
} from '../../src/core/constants.js';
import {
  createContentMessageHandler,
  createMessenger
} from '../../src/content/messaging.js';
import { createStore } from '../../src/core/store.js';

const staleFollowup = {
  contactId: 'stale@c.us',
  contactName: 'Contato antigo',
  title: 'Não deve voltar',
  timestamp: Date.now() - 1000,
  done: false
};

const stub = installChromeStub({
  initial: {
    [STORAGE_KEY]: { version: 2, followups: {} },
    followups: { [staleFollowup.contactId]: staleFollowup }
  }
});
const background = await import('../../src/background/index.js');

function runtimeThroughBackground(onPayload) {
  return {
    id: 'kanzapp-integration-test',
    lastError: null,
    sendMessage(message, callback) {
      onPayload?.(message);
      stub.chrome.runtime.onMessage.dispatch(message, {}, callback);
    }
  };
}

function dispatchToBackground(message) {
  return new Promise((resolve) => {
    stub.chrome.runtime.onMessage.dispatch(message, {}, resolve);
  });
}

describe('messaging/protocolo compartilhado', () => {
  it('normaliza type canonico e aliases antigos', () => {
    expect(messageTypeOf({ type: MSG.TOGGLE_BOARD })).toBe(MSG.TOGGLE_BOARD);
    expect(messageTypeOf({ action: 'toggle_board' })).toBe(MSG.TOGGLE_BOARD);
    expect(messageTypeOf({ action: 'toggle_kanban' })).toBe(MSG.TOGGLE_BOARD);
    expect(messageTypeOf({ action: 'followup_due' })).toBe(MSG.FOLLOWUP_DUE);
    expect(messageTypeOf({ action: 'show_followup_toast' })).toBe(MSG.FOLLOWUP_DUE);
  });

  it('content envia timestamp/when e o background cria o alarme canonico', async () => {
    let payload = null;
    const messenger = createMessenger(null, {
      runtime: runtimeThroughBackground((message) => {
        payload = message;
      })
    });
    const timestamp = Date.now() + 60000;
    const response = await messenger.scheduleFollowup({
      contactId: 'novo@c.us',
      contactName: 'Novo contato',
      title: 'Retornar',
      timestamp,
      done: false
    });

    expect(response).toEqual({ ok: true });
    expect(payload.type).toBe(MSG.SCHEDULE_ALARM);
    expect(payload.action).toBe(LEGACY_MSG.SCHEDULE_ALARM);
    expect(payload.when).toBe(timestamp);
    expect(payload.timestamp).toBe(timestamp);
    expect(stub.alarms.get(`${ALARM_PREFIX}novo@c.us`).when).toBe(timestamp);
  });

  it('background continua aceitando o payload legado name/when', async () => {
    const timestamp = Date.now() + 120000;
    const response = await dispatchToBackground({
      action: 'schedule_alarm',
      name: 'followup_legado@c.us',
      when: timestamp
    });
    expect(response).toEqual({ ok: true });
    expect(stub.alarms.get(`${ALARM_PREFIX}legado@c.us`).when).toBe(timestamp);
  });

  it('estado v2 vazio é autoritativo e não ressuscita follow-up da v1', async () => {
    expect(await background.readFollowups()).toEqual({});
  });

  it('SCHEDULE_ALARM recalcula badge com leitura fresca após a gravação da UI', async () => {
    const contactId = 'vencido@c.us';
    const timestamp = Date.now() - 1000;
    stub.reset({
      [STORAGE_KEY]: {
        ...defaultState(),
        followups: {
          [contactId]: { contactId, contactName: 'Vencido', title: 'Cobrar', timestamp, done: false }
        }
      }
    });

    const response = await dispatchToBackground({
      type: MSG.SCHEDULE_ALARM,
      contactId,
      when: timestamp
    });

    expect(response.ok).toBe(true);
    expect(stub.actionState.badgeText).toBe('1');
  });

  it('SYNC_ALARMS invalida cache quente e relê o estado recém-importado', async () => {
    // O handler acima aqueceu o cache do driver do background. `reset`
    // simula storage.set concluído antes de storage.onChanged chegar ao worker.
    const contactId = 'fresh@c.us';
    const timestamp = Date.now() + 150000;
    stub.reset({
      [STORAGE_KEY]: {
        ...defaultState(),
        followups: {
          [contactId]: { contactId, contactName: 'Fresh', title: 'Reler', timestamp, done: false }
        }
      }
    });

    const response = await dispatchToBackground({ type: MSG.SYNC_ALARMS });

    expect(response.ok).toBe(true);
    expect(stub.alarms.get(`${ALARM_PREFIX}${contactId}`).when).toBe(timestamp);
  });

  it('botão Abrir conversa cria a aba ausente e preserva o contactId', async () => {
    stub.sentMessages.length = 0;
    const delivered = await background.openChatFromNotification('sem-aba@c.us', {
      attempts: 1,
      retryMs: 1
    });
    const sent = stub.sentMessages.find((entry) => entry?.message?.type === MSG.OPEN_CHAT);
    expect(delivered).toBe(true);
    expect(sent.message.contactId).toBe('sem-aba@c.us');
    expect(sent.message.action).toBe(LEGACY_MSG.OPEN_CHAT);
  });

  it('não considera entregue quando o content responde ok:false', async () => {
    const original = stub.chrome.tabs.sendMessage;
    stub.chrome.tabs.sendMessage = (tabId, message, callback) => {
      void tabId;
      void message;
      queueMicrotask(() => callback({ ok: false, reason: 'contact-not-found' }));
    };
    const delivered = await background.sendOpenChatToTab(99, 'ausente@c.us', {
      attempts: 1,
      retryMs: 1
    });
    stub.chrome.tabs.sendMessage = original;
    expect(delivered).toBe(false);
  });

  it('import sincroniza o conjunto de alarmes e remove os que saíram no replace', async () => {
    const store = createStore({});
    await store.ready();
    const contactId = 'importado@c.us';
    const timestamp = Date.now() + 180000;
    const messenger = createMessenger(null, { runtime: runtimeThroughBackground() });

    const imported = await store.actions.importJSON({
      ...defaultState(),
      followups: {
        [contactId]: { contactId, contactName: 'Importado', title: 'Ligar', timestamp, done: false }
      }
    }, { merge: false });
    expect(imported.ok).toBe(true);
    const created = await messenger.syncFollowups();
    expect(created.ok).toBe(true);
    expect(stub.alarms.get(`${ALARM_PREFIX}${contactId}`).when).toBe(timestamp);

    await store.actions.importJSON(defaultState(), { merge: false });
    const removed = await messenger.syncFollowups();
    expect(removed.ok).toBe(true);
    expect(stub.alarms.has(`${ALARM_PREFIX}${contactId}`)).toBe(false);
    store.destroy();
  });
});

describe('messaging/listener do content', () => {
  it('trata toggle legado e toast de follow-up canonico', () => {
    const calls = [];
    const appRoot = {
      toggle: () => calls.push('toggle'),
      isOpen: () => true,
      toast: (text) => calls.push(text),
      open: () => calls.push('open')
    };
    const handler = createContentMessageHandler({ appRoot });
    let toggleResponse = null;
    handler({ action: 'toggle_board' }, {}, (response) => {
      toggleResponse = response;
    });
    handler({ type: MSG.FOLLOWUP_DUE, contactName: 'Ana', title: 'Ligar' }, {}, () => {});

    expect(toggleResponse).toEqual({ ok: true, open: true });
    expect(calls[0]).toBe('toggle');
    expect(calls[1]).toContain('Ligar');
    expect(calls[1]).toContain('Ana');
  });

  it('OPEN_CHAT fecha o board, abre o contato e responde de forma assincrona', async () => {
    const calls = [];
    const contact = { id: 'ana@c.us', name: 'Ana' };
    const handler = createContentMessageHandler({
      appRoot: { close: () => calls.push('close'), toast: () => {} },
      store: { getState: () => ({ contacts: { [contact.id]: contact } }) },
      composer: {
        openChat: async (received) => {
          calls.push(received.id);
          return { ok: true, via: 'row' };
        }
      }
    });

    const response = await new Promise((resolve) => {
      const keepsPortOpen = handler({ type: MSG.OPEN_CHAT, contactId: contact.id }, {}, resolve);
      expect(keepsPortOpen).toBe(true);
    });
    expect(calls).toEqual(['close', contact.id]);
    expect(response).toEqual({ ok: true, via: 'row', reason: undefined });
  });

  it('limpa o stub global ao final deste arquivo', () => {
    stub.uninstall();
    expect(true).toBe(true);
  });
});
