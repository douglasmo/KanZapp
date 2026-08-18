// Constantes compartilhadas. Este arquivo nao pode importar nada nem tocar no DOM.

export const STORAGE_KEY = 'kanzapp.v2';
export const SCHEMA_VERSION = 2;

/** Chaves usadas pela v1. Sao lidas na migracao e mantidas como backup. */
export const LEGACY_KEYS = [
  'kanbanColumns',
  'kanbanTags',
  'kanbanMessages',
  'contactTags',
  'kanbanData',
  'contactNotes',
  'followups',
  'allConversations',
  'inboxConversations',
  'inboxLastUpdatedAt'
];

export const ACCENT = '#00a884';

export const COLUMN_PALETTE = ['#00a884', '#2563eb', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#65a30d'];

export const TAG_PALETTE = ['#00a884', '#2563eb', '#f59e0b', '#ef4444', '#7c3aed', '#db2777', '#0891b2', '#64748b'];

export const AVATAR_PALETTE = ['#00a884', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0f766e', '#4f46e5'];

export const DEFAULT_COLUMNS = Object.freeze([
  Object.freeze({ id: 'inbox', title: 'Entrada', color: '#00a884', wipLimit: null, collapsed: false }),
  Object.freeze({ id: 'doing', title: 'Em atendimento', color: '#2563eb', wipLimit: null, collapsed: false }),
  Object.freeze({ id: 'deal', title: 'Negociação', color: '#f59e0b', wipLimit: null, collapsed: false }),
  Object.freeze({ id: 'done', title: 'Concluído', color: '#7c3aed', wipLimit: null, collapsed: false })
]);

/**
 * ATENCAO A QUEM AUDITAR `showArchived` — nao remova de novo.
 *
 * O campo do rascunho original foi removido na AUDIT-01 #14, e com razao: sob a
 * semantica do WhatsApp ele era mentira, porque a lista lateral NUNCA entrega
 * conversas arquivadas, entao nenhum consumidor honesto era possivel.
 *
 * Este `showArchived` e outra coisa: o arquivamento e do KanZapp (o usuario
 * marca um card como fora do funil, `cards[id].archived`), e um conceito sob
 * nosso controle, reversivel, e o campo tem consumidor real —
 * `store.select.cardsByColumn` e a barra de filtros do quadro
 * (docs/ROADMAP-USABILIDADE.md §7).
 */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'auto',
  density: 'comfortable',
  autoRefresh: true,
  refreshMs: 4000,
  onlyUnread: false,
  hideGroups: false,
  showArchived: false,
  sort: 'inbox',
  debug: false,
  launcherPos: null
});

/** Padrao do utilitario manual "arquivar contatos sem atividade" (§7). */
export const ARCHIVE_INACTIVE_DAYS = 90;

/** Copias mutaveis dos defaults (nunca devolver o objeto congelado para o store). */
export function defaultColumns() {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    columns: defaultColumns(),
    tags: [],
    templates: [],
    contacts: {},
    cards: {},
    followups: {},
    settings: defaultSettings()
  };
}

// --- Mensagens entre background <-> content -------------------------------
// O background envia `{ type, action }` com o MESMO valor nos dois campos para
// tolerar listeners que checam qualquer um dos dois.
export const MSG = Object.freeze({
  TOGGLE_BOARD: 'kanzapp:toggle-board',
  OPEN_BOARD: 'kanzapp:open-board',
  SCHEDULE_ALARM: 'kanzapp:schedule-alarm',
  CANCEL_ALARM: 'kanzapp:cancel-alarm',
  FOLLOWUP_DUE: 'kanzapp:followup-due',
  SYNC_ALARMS: 'kanzapp:sync-alarms',
  OPEN_CHAT: 'kanzapp:open-chat',
  PING: 'kanzapp:ping'
});

export const ALARM_PREFIX = 'followup:';
export const LEGACY_ALARM_PREFIX = 'followup_';

/**
 * Acoes usadas pela v1 e por builds intermediarios da v2. Manter esses aliases
 * evita quebrar uma aba do WhatsApp que ainda esteja com o content script da
 * versao anterior enquanto o service worker ja foi atualizado (e vice-versa).
 */
export const LEGACY_MSG = Object.freeze({
  TOGGLE_BOARD: 'toggle_board',
  TOGGLE_KANBAN: 'toggle_kanban',
  OPEN_BOARD: 'open_board',
  SCHEDULE_ALARM: 'schedule_alarm',
  CANCEL_ALARM: 'cancel_alarm',
  FOLLOWUP_DUE: 'show_followup_toast',
  FOLLOWUP_DUE_INTERMEDIATE: 'followup_due',
  SYNC_ALARMS: 'sync_alarms',
  OPEN_CHAT: 'open_chat',
  PING: 'ping'
});

const MESSAGE_TYPE_BY_ALIAS = Object.freeze({
  [LEGACY_MSG.TOGGLE_BOARD]: MSG.TOGGLE_BOARD,
  [LEGACY_MSG.TOGGLE_KANBAN]: MSG.TOGGLE_BOARD,
  [LEGACY_MSG.OPEN_BOARD]: MSG.OPEN_BOARD,
  [LEGACY_MSG.SCHEDULE_ALARM]: MSG.SCHEDULE_ALARM,
  [LEGACY_MSG.CANCEL_ALARM]: MSG.CANCEL_ALARM,
  [LEGACY_MSG.FOLLOWUP_DUE]: MSG.FOLLOWUP_DUE,
  [LEGACY_MSG.FOLLOWUP_DUE_INTERMEDIATE]: MSG.FOLLOWUP_DUE,
  [LEGACY_MSG.SYNC_ALARMS]: MSG.SYNC_ALARMS,
  [LEGACY_MSG.OPEN_CHAT]: MSG.OPEN_CHAT,
  [LEGACY_MSG.PING]: MSG.PING
});

const CANONICAL_MESSAGE_TYPES = new Set(Object.values(MSG));

/** Resolve `type`/`action` canonico sem rejeitar mensagens de builds antigos. */
export function messageTypeOf(message) {
  const candidates = typeof message === 'string'
    ? [message]
    : [message?.type, message?.action];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    if (CANONICAL_MESSAGE_TYPES.has(candidate)) return candidate;
    if (MESSAGE_TYPE_BY_ALIAS[candidate]) return MESSAGE_TYPE_BY_ALIAS[candidate];
  }
  return candidates.find((candidate) => typeof candidate === 'string' && candidate) || '';
}

export const COMMAND_TOGGLE = 'toggle-board';
export const WA_ORIGIN_MATCH = 'https://web.whatsapp.com/*';

// --- Sinais da camada wa/ --------------------------------------------------

/** Reconhece um JID do WhatsApp (`...@c.us`, `@g.us`, `@lid`, `@broadcast`). */
export const JID_RE = /@(?:c\.us|g\.us|s\.whatsapp\.net|lid|broadcast|newsletter)$/i;
/** Mesmo JID quando embutido em um id maior (`true_5511...@c.us_3EB0`). */
export const JID_ANY_RE = /([A-Za-z0-9][A-Za-z0-9.-]*@(?:c\.us|g\.us|s\.whatsapp\.net|lid|broadcast|newsletter))/i;
export const GROUP_JID_RE = /@g\.us$/i;

/** Ids de coluna da v1 sem equivalente direto na v2. */
export const LEGACY_COLUMN_ALIAS = Object.freeze({
  todo: 'inbox',
  doing: 'doing',
  done: 'done'
});

/** Rotulos de sistema / cabecalhos que nunca sao nome de contato (pt-BR + en). */
export const NOISE_EXACT = Object.freeze([
  'arquivadas', 'arquivada', 'archived', 'arquivo',
  'conversas', 'chats', 'chat', 'lista de conversas', 'chat list',
  'status', 'atualizacoes', 'updates', 'canais', 'channels',
  'comunidades', 'communities', 'grupos', 'groups',
  'ligacoes', 'chamadas', 'calls',
  'mensagens', 'messages', 'menu', 'perfil', 'profile',
  'configuracoes', 'settings', 'ajuda', 'help',
  'todas', 'all', 'nao lidas', 'unread', 'favoritas', 'favorites',
  'voce', 'you', 'rascunho', 'draft',
  'digitando...', 'digitando', 'typing...', 'typing',
  'online', 'gravando audio', 'recording audio',
  'sem mensagens', 'no messages',
  'nova conversa', 'new chat', 'nova mensagem', 'new message',
  'fixada', 'fixadas', 'pinned', 'silenciada', 'silenciado', 'muted',
  'lista de transmissao', 'broadcast list',
  'selecionar conversas', 'select chats',
  'pesquisar', 'search', 'pesquisar ou comecar uma nova conversa'
]);

/**
 * Fragmentos que, se aparecerem, marcam o texto como ruido.
 * Os rotulos de controle ("menu de contexto", "foto do perfil"...) sao apenas
 * uma rede de seguranca extra: quem realmente descarta rotulo de botao e a
 * pontuacao de candidatos do adapter, que nao depende desta lista.
 */
export const NOISE_INCLUDES = Object.freeze([
  'criptografia de ponta a ponta',
  'end-to-end encrypted',
  'pesquisar ou comecar',
  'search or start',
  'clique para saber mais',
  'click to learn more',
  'suas mensagens pessoais',
  'nenhuma conversa',
  'no chats',
  'carregando',
  'loading',
  'sincronizando',
  'syncing',
  'menu de contexto',
  'context menu',
  'mais opcoes',
  'more options',
  'foto do perfil',
  'profile photo',
  'abrir conversa',
  'open chat',
  'voltar para',
  'back to'
]);

/** Textos que indicam contagem de nao lidas. */
export const UNREAD_HINTS = Object.freeze([
  'nao lida', 'nao lidas', 'unread', 'mensagem nao lida', 'mensagens nao lidas'
]);

export const PINNED_HINTS = Object.freeze(['fixad', 'pinned']);
export const MUTED_HINTS = Object.freeze(['silenciad', 'muted', 'mudo']);
export const GROUP_HINTS = Object.freeze(['grupo', 'group']);

/** Rotulos temporais que aparecem na linha da conversa. */
export const TIME_LABEL_RE =
  /^(?:\d{1,2}:\d{2}(?:\s?[ap]m)?|ontem|hoje|yesterday|today|segunda-feira|terca-feira|quarta-feira|quinta-feira|sexta-feira|sabado|domingo|seg|ter|qua|qui|sex|sab|dom|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i;

/** Limites da varredura do adapter (protegem o orcamento de performance). */
export const SCAN_LIMITS = Object.freeze({
  maxRows: 200,
  maxTextFragmentsPerRow: 24,
  maxNodesPerRow: 160,
  maxProbeNodes: 3000,
  minRowHeight: 36,
  maxRowHeight: 140,
  observeThrottleMs: 400,
  // rIC so serve para escolher um momento ocioso; acima disso a leitura atrasa
  // demais e a lista fica desatualizada (o throttle acima ja protege a pagina)
  observeIdleTimeoutMs: 250
});

/** Piso de qualidade de extracao abaixo do qual a leitura e "degradada". */
export const QUALITY_FLOOR = 0.85;
