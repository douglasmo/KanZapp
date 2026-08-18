/**
 * views/settings.js — preferências, backup e o painel de diagnóstico.
 *
 * O painel de diagnóstico é obrigatório pelo contrato: mostra a estratégia
 * usada pelo adapter, a confiança, quantas linhas foram lidas, o último erro
 * e se a extração está degradada. Falha silenciosa é proibida.
 */
import { h, icon, clear, setText } from '../h.js';
import { archiveEntry } from '../undo.js';

const THEMES = [['auto', 'Seguir o WhatsApp'], ['light', 'Claro'], ['dark', 'Escuro']];
const DENSITIES = [['comfortable', 'Confortável'], ['compact', 'Compacta']];
const SORTS = [['manual', 'Ordem manual'], ['inbox', 'Ordem da caixa'], ['recent', 'Mais recentes'], ['name', 'Nome (A–Z)']];

function selectField(label, options, value, onChange) {
  const select = h('select', { class: 'kz-select', onChange: () => onChange(select.value) },
    ...options.map(([id, text]) => h('option', { value: id }, text)));
  select.value = value;
  return h('div', { class: 'kz-field' }, h('label', {}, label), select);
}

function describe(value) {
  if (value == null) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flatten(source, prefix = '', out = []) {
  for (const key of Object.keys(source || {})) {
    const value = source[key];
    const label = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length && prefix.split('.').length < 2) {
      flatten(value, label, out);
    } else {
      out.push([label, value]);
    }
  }
  return out;
}

export function openSettings(ctx, options = {}) {
  const { store, adapter, dialogs, toast, logger, messenger } = ctx;
  const diagEl = h('div', { class: 'kz-diag' });
  const legacyStatus = h('span', { class: 'kz-hint' });

  function patch(next) {
    Promise.resolve(store.actions.updateSettings(next)).catch((error) => {
      logger.warn('[settings] updateSettings falhou', error);
      toast('Não foi possível salvar a preferência.', { type: 'error' });
    });
  }

  function renderDiagnostics() {
    clear(diagEl);
    const health = (adapter && adapter.health) || null;
    let diagnostics = null;
    if (adapter && typeof adapter.diagnostics === 'function') {
      try {
        diagnostics = adapter.diagnostics();
      } catch (error) {
        logger.warn('[settings] diagnostics falhou', error);
        diagnostics = { erro: String((error && error.message) || error) };
      }
    }

    const rows = [];
    if (health) {
      rows.push(['Estado', health.ok === false ? 'não detectado' : health.degraded ? 'degradado' : 'ok']);
      rows.push(['Estratégia', health.strategy]);
      rows.push(['Confiança', health.confidence]);
      rows.push(['Linhas encontradas', health.rowsFound]);
      rows.push(['Última sondagem', health.lastProbeAt ? new Date(health.lastProbeAt).toLocaleString('pt-BR') : null]);
      rows.push(['Último erro', health.lastError]);
      rows.push(['Degradado', health.degraded ? 'sim' : 'não']);
    } else {
      rows.push(['Adapter', 'indisponível nesta tela']);
    }
    if (diagnostics && typeof diagnostics === 'object') {
      for (const [key, value] of flatten(diagnostics)) rows.push([key, value]);
    }

    const state = store.getState();
    rows.push(['Contatos no store', Object.keys(state.contacts || {}).length]);
    rows.push(['Cards no store', Object.keys(state.cards || {}).length]);
    if (store.select && typeof store.select.contactsMissingFromInbox === 'function') {
      try {
        const missing = store.select.contactsMissingFromInbox(state);
        rows.push(['Fora da caixa atual', Array.isArray(missing) ? missing.length : describe(missing)]);
      } catch (error) {
        logger.warn('[settings] contactsMissingFromInbox falhou', error);
      }
    }

    for (const [key, value] of rows) {
      const isBad = /erro/i.test(String(key)) && value != null && value !== '' && value !== '—';
      const isWarn = String(key).toLowerCase() === 'degradado' && value === 'sim';
      diagEl.appendChild(h('span', { class: 'kz-diag__k' }, String(key)));
      diagEl.appendChild(h('span', {
        class: `kz-diag__v${isBad ? ' is-bad' : isWarn ? ' is-warn' : ''}`
      }, describe(value)));
    }
  }

  async function copyDiagnostics() {
    const payload = {
      health: (adapter && adapter.health) || null,
      diagnostics: adapter && typeof adapter.diagnostics === 'function' ? adapter.diagnostics() : null,
      geradoEm: new Date().toISOString()
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('Diagnóstico copiado.', { type: 'success' });
    } catch (error) {
      logger.warn('[settings] clipboard indisponível', error);
      toast('A área de transferência foi bloqueada pelo navegador.', { type: 'warn' });
    }
  }

  async function exportData() {
    try {
      const data = await store.actions.exportJSON();
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = h('a', {
        href: url,
        attrs: { download: `kanzapp-backup-${new Date().toISOString().slice(0, 10)}.json` }
      });
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Backup gerado.', { type: 'success' });
    } catch (error) {
      logger.warn('[settings] exportJSON falhou', error);
      toast('Não foi possível gerar o backup.', { type: 'error' });
    }
  }

  async function applyImport(payload, merge) {
    const result = await store.actions.importJSON(payload, { merge });
    if (result && result.ok === false) {
      const detail = Array.isArray(result.errors) ? result.errors.join(' ') : '';
      throw new Error(detail || 'O backup não passou na validação do schema.');
    }
    let alarmsSynced = false;
    if (typeof messenger?.syncFollowups === 'function') {
      try {
        const response = await messenger.syncFollowups();
        alarmsSynced = response?.ok === true;
      } catch (error) {
        logger.warn('[settings] sincronizacao de alarmes apos import falhou', error);
      }
    }
    return { ...(result || { ok: true }), alarmsSynced };
  }

  function notifyImport(result) {
    if (result?.alarmsSynced) {
      toast('Backup importado.', { type: 'success' });
    } else {
      toast('Backup importado, mas os lembretes não puderam ser sincronizados.', { type: 'warn' });
    }
  }

  const fileInput = h('input', {
    type: 'file',
    hidden: true,
    attrs: { accept: 'application/json,.json' },
    onChange: async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      let text = '';
      try {
        text = await file.text();
      } catch (error) {
        logger.warn('[settings] leitura do arquivo falhou', error);
        toast('Não foi possível ler o arquivo.', { type: 'error' });
        return;
      }
      fileInput.value = '';

      const mode = await dialogs.openDialog({
        title: 'Importar backup',
        body: (hh) => hh('p', { class: 'kz-dialog__text' },
          'Mesclar mantém o que já existe e adiciona o que vier do arquivo. Substituir troca todo o quadro pelo conteúdo do backup.'),
        actions: [
          { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
          { id: 'merge', label: 'Mesclar', value: 'merge' },
          { id: 'replace', label: 'Substituir tudo', variant: 'danger', value: 'replace' }
        ]
      });
      if (!mode) return;
      if (mode === 'replace') {
        const ok = await dialogs.confirmDialog('Isso apaga o quadro atual e usa o do arquivo. Continuar?', {
          title: 'Substituir tudo',
          confirmLabel: 'Substituir',
          danger: true
        });
        if (!ok) return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        logger.warn('[settings] JSON inválido', error);
        toast('O arquivo não é um JSON válido.', { type: 'error' });
        return;
      }

      try {
        const result = await applyImport(parsed, mode === 'merge');
        notifyImport(result);
      } catch (error) {
        // alguns motores esperam a string crua; tenta uma vez antes de desistir
        try {
          const result = await applyImport(text, mode === 'merge');
          notifyImport(result);
        } catch (second) {
          logger.warn('[settings] importJSON falhou', second || error);
          toast('O arquivo não passou na validação do schema.', { type: 'error' });
        }
      }
    }
  });

  async function clearLegacy() {
    const action = store.actions.clearLegacyBackup
      || store.actions.clearLegacy
      || store.actions.removeLegacy
      || store.actions.clearLegacyKeys;
    if (typeof action !== 'function') {
      setText(legacyStatus, 'A limpeza das chaves antigas não está disponível nesta versão do motor.');
      toast('Limpeza indisponível nesta versão.', { type: 'warn' });
      return;
    }
    const ok = await dialogs.confirmDialog(
      'As chaves do KanZapp v1 são o backup da migração. Depois de apagar não dá para voltar atrás. Continuar?',
      { title: 'Limpar dados do v1', confirmLabel: 'Apagar backup do v1', danger: true }
    );
    if (!ok) return;
    try {
      await action.call(store.actions);
      setText(legacyStatus, 'Chaves do v1 removidas.');
      toast('Dados antigos removidos.', { type: 'success' });
    } catch (error) {
      logger.warn('[settings] limpeza legada falhou', error);
      toast('Não foi possível limpar as chaves antigas.', { type: 'error' });
    }
  }

  /* ---------------- arquivamento manual por inatividade (§7) ------------- */

  const inactiveDays = h('input', {
    class: 'kz-input',
    type: 'number',
    value: '90',
    attrs: { min: '7', max: '3650', step: '1', 'aria-label': 'Dias sem atividade' }
  });
  const inactiveStatus = h('span', { class: 'kz-hint' });

  function inactiveIds() {
    const days = Math.min(3650, Math.max(7, Number(inactiveDays.value) || 90));
    inactiveDays.value = String(days);
    if (!store.select || typeof store.select.inactiveCards !== 'function') return null;
    try {
      return { days, ids: store.select.inactiveCards(store.getState(), days) };
    } catch (error) {
      logger.warn('[settings] inactiveCards falhou', error);
      return null;
    }
  }

  /**
   * Sempre MANUAL e em dois tempos: primeiro conta, depois pede confirmação.
   * Arquivar é reversível e não apaga nada — mas mexer em 200 cards sem avisar
   * seria indistinguível de perder dado, do ponto de vista de quem usa.
   */
  async function archiveInactive() {
    const found = inactiveIds();
    if (!found) {
      setText(inactiveStatus, 'Este utilitário não está disponível nesta versão do motor.');
      return;
    }
    if (found.ids.length === 0) {
      setText(inactiveStatus, `Nenhum contato está parado há mais de ${found.days} dias.`);
      toast('Nada para arquivar.', { duration: 3000 });
      return;
    }
    setText(inactiveStatus, `${found.ids.length} card(s) sem atividade há mais de ${found.days} dias.`);
    const ok = await dialogs.confirmDialog(
      `Arquivar ${found.ids.length} card(s) sem atividade há mais de ${found.days} dias? Eles saem do quadro, mas continuam salvos: dá para revê-los ligando "Ver arquivados" e desarquivar quando quiser.`,
      { title: 'Arquivar inativos', confirmLabel: `Arquivar ${found.ids.length}` }
    );
    if (!ok) return;
    // reconta na hora de aplicar: a lista pode ter mudado durante a conversa
    const atual = inactiveIds();
    const alvo = atual ? atual.ids : found.ids;
    try {
      await store.actions.setArchived(alvo, true);
      if (ctx.history && typeof ctx.history.push === 'function') {
        ctx.history.push(archiveEntry(alvo, true, `Arquivar ${alvo.length} inativos`));
      }
      setText(inactiveStatus, `${alvo.length} card(s) arquivados.`);
      toast(`${alvo.length} card(s) arquivados. Nada foi apagado.`, { type: 'success' });
    } catch (error) {
      logger.warn('[settings] arquivamento em massa falhou', error);
      toast('Não foi possível arquivar.', { type: 'error' });
    }
  }

  function countInactive() {
    const found = inactiveIds();
    if (!found) {
      setText(inactiveStatus, 'Este utilitário não está disponível nesta versão do motor.');
      return;
    }
    setText(inactiveStatus, found.ids.length === 0
      ? `Nenhum contato está parado há mais de ${found.days} dias.`
      : `${found.ids.length} card(s) sem atividade há mais de ${found.days} dias.`);
  }

  const settings = store.getState().settings || {};
  const refreshInput = h('input', {
    class: 'kz-input',
    type: 'number',
    value: String(settings.refreshMs || 4000),
    attrs: { min: '1500', max: '60000', step: '500' },
    onChange: () => {
      const value = Math.min(60000, Math.max(1500, Number(refreshInput.value) || 4000));
      refreshInput.value = String(value);
      patch({ refreshMs: value });
    }
  });

  const autoRefresh = h('input', {
    type: 'checkbox',
    checked: settings.autoRefresh !== false,
    onChange: () => patch({ autoRefresh: autoRefresh.checked })
  });

  renderDiagnostics();

  const promise = dialogs.openDialog({
    title: 'Configurações',
    size: 'md',
    body: (hh) => hh('div', {},
      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Aparência'),
        hh('div', { class: 'kz-grid-2' },
          selectField('Tema', THEMES, settings.theme || 'auto', (value) => patch({ theme: value })),
          selectField('Densidade', DENSITIES, settings.density || 'comfortable', (value) => patch({ density: value })),
          selectField('Ordenação padrão', SORTS, settings.sort || 'manual', (value) => patch({ sort: value })))),

      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Sincronização'),
        hh('label', { class: 'kz-switch' }, autoRefresh, 'Atualizar automaticamente a lista de conversas'),
        hh('div', { class: 'kz-field' },
          hh('label', {}, 'Intervalo de atualização (ms)'),
          refreshInput,
          hh('span', { class: 'kz-hint' }, 'Valores muito baixos deixam o WhatsApp pesado. Recomendado: 4000 ms.'))),

      hh('div', { class: 'kz-section', id: 'kz-diagnostico' },
        hh('div', { class: 'kz-section__title' }, 'Diagnóstico da leitura'),
        hh('p', { class: 'kz-hint' }, 'Se o WhatsApp mudar de layout, é aqui que dá para ver o que a extensão conseguiu (ou não) ler.'),
        diagEl,
        hh('div', { class: 'kz-row' },
          hh('button', {
            class: 'kz-btn kz-btn--sm',
            type: 'button',
            onClick: () => {
              if (adapter && typeof adapter.probe === 'function') {
                try {
                  adapter.probe(true);
                } catch (error) {
                  logger.warn('[settings] probe falhou', error);
                }
              }
              renderDiagnostics();
            }
          }, icon('refresh', { size: 14 }), 'Sondar de novo'),
          hh('button', { class: 'kz-btn kz-btn--sm', type: 'button', onClick: copyDiagnostics },
            icon('copy', { size: 14 }), 'Copiar diagnóstico'))),

      hh('div', { class: 'kz-section', id: 'kz-arquivo' },
        hh('div', { class: 'kz-section__title' }, 'Arquivar inativos'),
        hh('p', { class: 'kz-hint' },
          'Tira do funil os cards parados há muito tempo. É manual: a extensão mostra quantos serão afetados e só age depois da sua confirmação. Arquivar não apaga nada — ligue "Ver arquivados" no quadro para revê-los.'),
        hh('div', { class: 'kz-field' },
          hh('label', {}, 'Sem atividade há mais de (dias)'),
          inactiveDays),
        hh('div', { class: 'kz-row' },
          hh('button', { class: 'kz-btn kz-btn--sm', type: 'button', onClick: countInactive },
            icon('search', { size: 14 }), 'Contar'),
          hh('button', { class: 'kz-btn kz-btn--sm', type: 'button', onClick: archiveInactive },
            icon('archive', { size: 14 }), 'Arquivar…')),
        inactiveStatus),

      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Backup'),
        hh('p', { class: 'kz-hint' }, 'Tudo fica no seu navegador. Exporte de vez em quando: reinstalar a extensão pode limpar o armazenamento.'),
        hh('div', { class: 'kz-row' },
          hh('button', { class: 'kz-btn', type: 'button', onClick: exportData },
            icon('download', { size: 14 }), 'Exportar JSON'),
          hh('button', { class: 'kz-btn', type: 'button', onClick: () => fileInput.click() },
            icon('upload', { size: 14 }), 'Importar JSON'),
          fileInput)),

      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Dados do KanZapp v1'),
        hh('p', { class: 'kz-hint' }, 'A migração para o v2 preservou as chaves antigas como backup. Só apague depois de conferir que está tudo certo no quadro.'),
        hh('div', { class: 'kz-row' },
          hh('button', { class: 'kz-btn kz-btn--danger', type: 'button', onClick: clearLegacy },
            icon('trash', { size: 14 }), 'Limpar chaves do v1'),
          legacyStatus))),
    actions: [{ id: 'close', label: 'Fechar', variant: 'ghost', value: null }]
  });

  if (options.tab === 'diagnostico' && promise.body) {
    const target = promise.body.querySelector('#kz-diagnostico');
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
  }
  return promise;
}
