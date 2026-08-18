/**
 * content/app.js — entrypoint ESM do content script.
 *
 * É o ÚNICO arquivo da camada de interface que conhece os módulos do motor.
 * Ele compõe `store` + `adapter` + `composer` e injeta tudo na UI; nenhum
 * componente de `src/ui/` importa singleton do motor (é isso que permite
 * abrir `tests/ui-harness.html` sem o motor carregado).
 */
import { createAppRoot } from '../ui/app-root.js';
import { createContentMessageHandler, createMessenger } from './messaging.js';
import { createRefreshController } from './refresh-controller.js';

/* ------------------------------- logger ------------------------------- */

function fallbackLogger() {
  const prefix = '[KanZapp]';
  return {
    debug: () => {},
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args)
  };
}

/* --------------------------- carga do motor --------------------------- */

async function loadModule(loader, logger, label) {
  try {
    return await loader();
  } catch (error) {
    logger.error(`módulo ${label} não pôde ser carregado`, error);
    return null;
  }
}

function pickFactory(mod, names) {
  if (!mod) return null;
  for (const name of names) {
    if (typeof mod[name] === 'function') return mod[name];
  }
  return null;
}

function isStoreLike(value) {
  return Boolean(value && typeof value.getState === 'function' && typeof value.ready === 'function');
}

function isComposerLike(value) {
  return Boolean(value && typeof value.openChat === 'function' && typeof value.insertDraft === 'function');
}

/* --------------------------- contexto vivo ---------------------------- */

function contextAlive() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/* ------------------------------- boot --------------------------------- */

export async function start() {
  const loggerModule = await loadModule(() => import('../core/logger.js'), fallbackLogger(), 'core/logger.js');
  const createLogger = pickFactory(loggerModule, ['createLogger', 'default']);
  let logger = fallbackLogger();
  if (createLogger) {
    try {
      const candidate = createLogger('kanzapp');
      if (candidate && typeof candidate.warn === 'function') {
        logger = Object.assign({ debug: () => {} }, candidate);
      }
    } catch {
      /* mantém o fallback */
    }
  }

  const storeModule = await loadModule(() => import('../core/store.js'), logger, 'core/store.js');
  const storeFactory = pickFactory(storeModule, ['createStore', 'createKanzappStore', 'createCrmStore', 'default']);
  let store = null;
  if (storeFactory) {
    try {
      store = await storeFactory({ logger });
    } catch (error) {
      logger.error('falha ao criar o store', error);
    }
  }
  if (!isStoreLike(store) && storeModule) {
    const exported = [storeModule.store, storeModule.default].find(isStoreLike);
    if (exported) store = exported;
  }
  if (!isStoreLike(store)) {
    logger.error('store indisponível — a interface não será montada.');
    return null;
  }

  try {
    await store.ready();
  } catch (error) {
    logger.error('store.ready() falhou', error);
    return null;
  }

  const adapterModule = await loadModule(() => import('../wa/adapter.js'), logger, 'wa/adapter.js');
  const adapterFactory = pickFactory(adapterModule, ['createWhatsAppAdapter', 'createAdapter', 'default']);
  let adapter = null;
  if (adapterFactory) {
    try {
      adapter = adapterFactory({ logger });
    } catch (error) {
      logger.error('falha ao criar o adapter', error);
    }
  }
  if (!adapter) {
    logger.warn('adapter indisponível: o quadro abre, mas sem leitura de conversas.');
  }

  const composerModule = await loadModule(() => import('../wa/composer.js'), logger, 'wa/composer.js');
  const composerFactory = pickFactory(composerModule, ['createComposer', 'createWhatsAppComposer', 'default']);
  let composer = null;
  if (composerFactory) {
    try {
      composer = composerFactory({ adapter, logger });
    } catch (error) {
      logger.error('falha ao criar o composer', error);
    }
  }
  if (!isComposerLike(composer) && isComposerLike(composerModule)) composer = composerModule;
  if (!isComposerLike(composer)) {
    composer = null;
    logger.warn('composer indisponível: abrir conversa e enviar mensagem ficam desligados.');
  }

  const messenger = createMessenger(logger);

  /* --------------------------- ciclo de sync -------------------------- */

  let stopObserve = null;
  let unsubscribeSyncSettings = null;
  let syncing = false;
  let dead = false;
  let boardOpen = false;

  async function syncNow() {
    if (dead || syncing || !adapter) return;
    if (!contextAlive()) {
      teardown('contexto da extensão invalidado');
      return;
    }
    syncing = true;
    try {
      const chats = adapter.listChats() || [];
      if (chats.length) await store.actions.syncContacts(chats);
      if (appRoot) appRoot.refreshHealth && appRoot.refreshHealth();
    } catch (error) {
      logger.warn('sincronização falhou', error);
    } finally {
      syncing = false;
    }
  }

  const refreshController = createRefreshController({
    onRefresh: syncNow,
    onError: (error) => logger.warn('atualização automática falhou', error)
  });
  refreshController.configure(store.getState().settings || {});

  function startSync() {
    if (dead || !adapter) return;
    syncNow();
    if (!stopObserve && typeof adapter.observe === 'function') {
      try {
        stopObserve = adapter.observe(() => syncNow());
      } catch (error) {
        logger.warn('adapter.observe falhou', error);
        stopObserve = null;
      }
    }
    refreshController.configure(store.getState().settings || {});
    refreshController.start();
  }

  function stopSync() {
    if (typeof stopObserve === 'function') {
      try {
        stopObserve();
      } catch (error) {
        logger.warn('falha ao parar o observer', error);
      }
    }
    stopObserve = null;
    refreshController.stop();
  }

  /* ---------------------- varredura da lista lateral ------------------- */

  const sweeperModule = await loadModule(() => import('../wa/sweeper.js'), logger, 'wa/sweeper.js');
  const sweeperFactory = pickFactory(sweeperModule, ['createSweeper', 'default']);
  let sweeper = null;
  if (sweeperFactory && adapter) {
    try {
      sweeper = sweeperFactory({
        adapter,
        logger,
        // um lote por vez: o store serializa as escritas, então não há
        // atualização perdida mesmo com a varredura correndo
        onBatch: (chats) => store.actions.syncContacts(chats),
        // dois leitores disputando a mesma lista virtualizada só produzem lixo
        suspendRefresh: () => {
          refreshController.stop();
          return () => {
            if (!dead && boardOpen) refreshController.start();
          };
        }
      });
    } catch (error) {
      logger.error('falha ao criar o sweeper', error);
      sweeper = null;
    }
  }

  /* ------------------------------- UI --------------------------------- */

  const appRoot = createAppRoot({
    store,
    adapter,
    composer,
    sweeper,
    logger,
    messenger,
    onRefresh: () => syncNow(),
    onOpenChange: (isOpen) => {
      boardOpen = isOpen;
      if (isOpen) startSync();
      else stopSync();
    }
  });

  await appRoot.mount();

  if (typeof store.subscribe === 'function') {
    unsubscribeSyncSettings = store.subscribe((state) => {
      refreshController.configure(state?.settings || {});
    });
  }

  /* ------------------- mensagens vindas do background ------------------ */

  const onRuntimeMessage = createContentMessageHandler({
    appRoot,
    store,
    composer,
    logger
  });

  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  } catch (error) {
    logger.warn('não foi possível ouvir mensagens do background', error);
  }

  /* ------------------------ contexto invalidado ------------------------ */

  function teardown(reason) {
    if (dead) return;
    dead = true;
    logger.warn(`desligando a interface: ${reason}`);
    stopSync();
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    } catch {
      /* o contexto já pode ter morrido */
    }
    window.clearInterval(aliveTimer);
    if (typeof unsubscribeSyncSettings === 'function') {
      try {
        unsubscribeSyncSettings();
      } catch {
        /* noop */
      }
      unsubscribeSyncSettings = null;
    }
    refreshController.destroy();
    appRoot.unmount();
    if (typeof store.destroy === 'function') {
      try {
        store.destroy();
      } catch (error) {
        logger.warn('falha ao destruir o store', error);
      }
    }
  }

  const aliveTimer = window.setInterval(() => {
    if (!contextAlive()) teardown('contexto da extensão invalidado');
  }, 5000);

  const handle = {
    store,
    adapter,
    composer,
    appRoot,
    syncNow,
    teardown: () => teardown('pedido manual')
  };

  // Ponto de depuração documentado (seção 7.8 do contrato).
  try {
    if (window.localStorage && window.localStorage.getItem('kanzapp.debug') === '1') {
      window.__kanzapp = handle;
      logger.info('modo debug: window.__kanzapp disponível');
    }
  } catch {
    /* localStorage pode estar bloqueado */
  }

  logger.info('interface montada');
  return handle;
}

const booted = start();
export default booted;
