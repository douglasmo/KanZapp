# KanZapp v2 — Especificação de Arquitetura (contrato de implementação)

Este documento é o **contrato**. O agente implementador constrói exatamente isto; o agente
validador audita contra isto. Onde o documento é omisso, vale o princípio geral:
_resiliência a mudanças de layout > funcionalidade > estética > brevidade de código_.

---

## 0. Problemas do v1 que a v2 obrigatoriamente resolve

| # | Problema no v1 | Exigência na v2 |
|---|---|---|
| P1 | `innerHTML` com dados do usuário (nome do contato, tag, nota) → XSS real: um contato chamado `<img src=x onerror=...>` executa código. Pior caso em `kanban.js:284` (injeção dentro de atributo `onerror`). | **Zero** `innerHTML`/`outerHTML`/`insertAdjacentHTML` com dado dinâmico. Toda árvore de UI construída por `h()` (hyperscript). |
| P2 | `MutationObserver` no `document.body` com `subtree:true` disparando em cada mutação do WhatsApp (centenas/segundo). | Observer escopado ao container da lista de conversas, throttle por `requestIdleCallback`/rAF, e desligamento automático quando o board está fechado. |
| P3 | ID do contato = nome (`makeConversationId` cai no nome). Renomear contato = perder todo o CRM dele. | Resolução de identidade em camadas (JID > data-id > hash do nome normalizado) + *upgrade* de identidade com merge quando um ID melhor aparece. |
| P4 | Read-modify-write concorrente em `chrome.storage.local` (drop, save de tag, updateBoard) → atualizações perdidas. | Todas as escritas passam por uma **fila serializada** (mutex) no `storage-driver`. Nenhum módulo chama `chrome.storage` diretamente. |
| P5 | `updateBoard()` reconstrói 100% do DOM a cada 1.2 s → flicker, perda de foco, perda de scroll, perda de drag. | Render por diff com chave estável (`data-card-id`), sem recriar nós existentes; scroll e foco preservados. |
| P6 | Scraper acoplado a `role="row"`, `span[title]`, `._ak8t`, `.x1n2onr6._ak9y`. Uma mudança de markup quebra tudo silenciosamente. | Camada `wa/` com estratégias pontuadas, autodiagnóstico e degradação explícita (aviso na UI), nunca falha silenciosa. |
| P7 | `prompt()`/`confirm()`/`alert()` bloqueantes e fora do padrão visual. | Diálogos próprios com foco preso, ESC, backdrop. Zero `prompt`/`confirm`/`alert` no código. |
| P8 | CSS global com `!important` competindo com o CSS do WhatsApp. | Toda a UI dentro de **Shadow DOM** (`mode: 'open'`) + `adoptedStyleSheets`. Nenhum `!important` necessário. |
| P9 | Alarmes de follow-up perdidos se o navegador estiver fechado no horário. | Re-hidratação em `onStartup`/`onInstalled` + disparo de pendentes atrasados. |
| P10 | Ícone de notificação vindo de CDN externo (`flaticon.com`). | Ícone local (`assets/icon128.png`). Zero rede externa. |
| P11 | Sem tema escuro; overlay claro sobre WhatsApp escuro. | Tema segue o WhatsApp (detecção por classe **e** por luminância computada), com override manual. |
| P12 | Sem backup, sem versão de schema, sem migração. | Schema versionado + migração automática do v1 (sem perda) + export/import JSON. |

---

## 1. Estrutura de arquivos (obrigatória)

```
manifest.json
package.json                 # sem dependências; scripts de teste
docs/ARCHITECTURE.md         # este arquivo
assets/                      # ícones existentes (não mexer)
src/
  background/index.js        # service worker (ESM: "type": "module")
  content/boot.js            # content script clássico; só faz import() dinâmico
  content/app.js             # entrypoint ESM: compõe adapter + store + ui
  core/
    constants.js
    logger.js
    utils.js
    events.js
    storage-driver.js
    migrations.js
    store.js
  wa/
    strategies.js
    adapter.js
    composer.js
  ui/
    h.js
    styles.css
    theme.js
    app-root.js
    launcher.js
    board.js
    card.js
    dnd.js
    dialog.js
    toast.js
    views/tags.js
    views/templates.js
    views/followups.js
    views/notes.js
    views/settings.js
tests/
  run.mjs                    # runner Node, zero dependências
  chrome-stub.mjs
  unit/*.test.mjs
  fixtures/layout-a.js       # markup "atual" do WhatsApp
  fixtures/layout-b.js       # markup mutado: classes/roles diferentes
  fixtures/layout-c.js       # markup minimalista/degradado
  harness.html               # bancada visual no navegador
```

Os arquivos antigos de `src/content/` (`main.js`, `kanban.js`, `scraper.js`, `tags.js`,
`messages.js`, `followup.js`, `notes.js`, `storage.js`, `styles.css`) são **removidos**.

## 2. Carregamento (MV3 sem bundler)

Content scripts MV3 não aceitam ESM diretamente. Padrão obrigatório:

- `content_scripts.js = ["src/content/boot.js"]`, `run_at: "document_idle"`, `all_frames: false`.
- `boot.js` (clássico, ~15 linhas) faz `import(chrome.runtime.getURL('src/content/app.js'))`,
  com `try/catch` e log de erro claro. Guarda contra dupla execução (`window.__kanzappBooted`).
- `web_accessible_resources` expõe `src/*` e `assets/*` para `https://web.whatsapp.com/*`.
- Sem `content_scripts.css`: o CSS é buscado com `fetch(chrome.runtime.getURL('src/ui/styles.css'))`
  e aplicado ao Shadow Root via `CSSStyleSheet.replace()` + `adoptedStyleSheets`
  (fallback: `<style>` dentro do shadow root se `adoptedStyleSheets` não existir).
- `background` roda como `"type": "module"`.

## 3. `core/` — contratos de API

### 3.1 `constants.js`
Exporta `STORAGE_KEY = 'kanzapp.v2'`, `SCHEMA_VERSION = 2`, `LEGACY_KEYS` (lista das chaves v1),
`DEFAULT_COLUMNS` (4 colunas: Entrada / Em atendimento / Negociação / Concluído, cada uma com
`{ id, title, color, wipLimit: null, collapsed: false }`), `DEFAULT_SETTINGS`.

### 3.2 `utils.js` (funções puras, testáveis em Node)
`debounce`, `throttle`, `nextId(prefix)`, `hashString(str)` (FNV-1a, retorna base36),
`normalizeText`, `normalizeForMatch` (sem acento, minúsculo), `relativeTime(ts, now)`
(pt-BR: "agora", "há 5 min", "há 3 h", "ontem", "12/03"), `clamp`, `shallowEqual`,
`groupBy`, `escapeForRegExp`, `deepFreeze`. Nenhuma dependência de DOM neste arquivo.

### 3.3 `events.js`
`createEmitter()` → `{ on(evt, fn) → unsubscribe, off, emit(evt, payload), clear() }`.
`emit` nunca deixa exceção de um listener quebrar os demais.

### 3.4 `storage-driver.js`
Única camada que toca `chrome.storage`.
```js
createStorageDriver({ area = 'local' }) → {
  read(),                    // Promise<object|null>  (chave STORAGE_KEY)
  mutate(fn),                // Promise<state>  fn(draft) → draft; SERIALIZADO (fila)
  readRaw(keys),             // para migração das chaves legadas
  removeRaw(keys),
  onExternalChange(cb),      // chrome.storage.onChanged, ignora escritas próprias
  isContextAlive()           // chrome.runtime?.id
}
```
Requisitos: fila FIFO (uma escrita por vez, nunca lost update); toda operação captura
`Extension context invalidated` e resolve com no-op silencioso; `mutate` reaproveita
o cache em memória e só relê do disco se houve mudança externa.

### 3.5 `store.js` — estado do CRM
Shape canônico (v2):
```js
{
  version: 2,
  columns: [{ id, title, color, wipLimit, collapsed }],
  tags:    [{ id, name, color, description }],
  templates: [{ id, title, text, shortcut }],
  contacts: { [contactId]: { id, idKind: 'jid'|'dom'|'name',
                             name, avatarUrl, preview, unread, isGroup,
                             lastSeenAt, firstSeenAt } },
  cards:    { [contactId]: { columnId, order, tagIds: [], note: '',
                             createdAt, updatedAt } },
  followups:{ [contactId]: { contactId, contactName, title, timestamp, done } },
  settings: { theme: 'auto'|'light'|'dark', density: 'comfortable'|'compact',
              autoRefresh: true, refreshMs: 4000,
              onlyUnread: false, sort: 'inbox'|'name'|'recent'|'manual' }
  // `showArchived` foi removido na auditoria 01 (#14): sob a semântica do
  // WhatsApp o campo era mentira, porque a lista lateral nunca entrega
  // conversas arquivadas. O arquivamento próprio do KanZapp — outra coisa —
  // é especificado em docs/ROADMAP-USABILIDADE.md §7.
}
```
API (todas assíncronas onde escrevem; leitura é síncrona sobre o cache):
```js
store.ready()                      // Promise — carrega + migra
store.getState()                   // objeto congelado
store.subscribe(fn) → unsubscribe  // chamado após qualquer mutação (local ou externa)
store.actions = {
  syncContacts(list),              // upsert em lote a partir do adapter; cria card na 1ª coluna
  moveCard(contactId, columnId, index),
  reorderCard(contactId, index),
  setCardTags(contactId, tagIds),
  setNote(contactId, text),
  addColumn(title), renameColumn(id, title), setColumnColor(id, color),
  removeColumn(id),                // move cards p/ primeira coluna restante; bloqueia se só resta 1
  reorderColumns(ids),
  addTag(tag), updateTag(id, patch), removeTag(id),      // remove referências em cards
  addTemplate(t), updateTemplate(id, patch), removeTemplate(id),
  setFollowup(contactId, data), clearFollowup(contactId),
  updateSettings(patch),
  exportJSON(), importJSON(json, { merge })              // valida schema antes de aplicar
}
store.select = { cardsByColumn(state, filters), contactsMissingFromInbox(state), stats(state) }
```
Regras:
- `syncContacts` **nunca** apaga contatos que sumiram da inbox (a lista lateral é virtualizada,
  o contato pode só ter saído do viewport). Marca `lastSeenAt`.
- `moveCard` recalcula `order` como inteiros densos (0..n-1) na coluna afetada.
- Toda ação retorna o novo estado e emite para os `subscribe`.

### 3.6 `migrations.js`
`migrate(raw, legacy)` puro e testado: recebe o objeto v2 (ou `null`) + o dump das chaves v1
e devolve estado v2 válido. Mapeamento v1 → v2:
`kanbanColumns→columns` (adiciona `color`/`wipLimit`), `kanbanTags→tags`,
`kanbanMessages→templates`, `contactTags[id]→cards[id].tagIds`,
`kanbanData[id]→cards[id].columnId`, `contactNotes[id]→cards[id].note`,
`followups→followups`, `allConversations`+`inboxConversations`→`contacts`.
Migração é idempotente, nunca perde dado, e **não apaga** as chaves v1 (mantém como backup;
o usuário pode limpar em Configurações).

## 4. `wa/` — camada anti-quebra (o coração do requisito "adaptável a mudanças de layout")

### 4.1 `strategies.js`
Exporta duas listas ordenadas de estratégias declarativas. Cada estratégia é
`{ id, weight, find(root) → Element[] }`. **Nenhum nome de classe ofuscado do WhatsApp
(`_ak8t`, `x1n2onr6`, …) pode ser usado como sinal primário** — só como dica de peso baixo.

`PANE_STRATEGIES` (achar a lista de conversas):
1. `#pane-side`
2. `[aria-label]` cujo texto casa `/chat list|lista de conversas|conversas|chats/i`
3. `[role="grid"]` / `[role="list"]` visível
4. heurística estrutural: elemento com `overflow-y: auto|scroll`, altura > 50% da viewport,
   posicionado no terço esquerdo, contendo ≥ 3 filhos irmãos de altura semelhante (±20%).

`ROW_STRATEGIES` (achar as linhas dentro do pane):
1. `[role="row"]`, `[role="listitem"]`, `[role="gridcell"]`
2. `[data-id]` cujo valor casa `/@(c|g|s)\.us|@lid|@broadcast/`
3. heurística estrutural: irmãos diretos do maior "cluster" de filhos com altura 44–120 px,
   contendo ≥ 1 nó de texto não vazio.

`scoreCandidate(el, kind)` retorna 0–100 combinando: visibilidade, área, quantidade de filhos
repetidos, presença de `[title]`/`aria-label`, densidade de texto, posição na viewport.

### 4.2 `adapter.js` — `createWhatsAppAdapter({ logger })`
```js
{
  probe(force = false) → { ok, pane, strategy, confidence, rowsFound, at },
  listChats() → Chat[],                 // usa o pane resolvido; re-probe automático se 0 linhas
  observe(cb) → stop,                   // observer escopado + throttle idle (mín. 400 ms)
  getTheme() → 'light'|'dark',
  health → { ok, strategy, confidence, rowsFound, lastProbeAt, lastError, degraded },
  diagnostics() → objeto serializável para o painel de diagnóstico
}
```
`Chat = { id, idKind, name, avatarUrl, preview, unread, isGroup, muted, pinned, timeLabel, inboxOrder }`

Regras duras:
- **Auto-recuperação**: se `listChats()` devolver 0 linhas 2 vezes seguidas, re-executa `probe(true)`
  descendo para a próxima estratégia; registra em `health.degraded = true`.
- **Nunca lança**: erros viram `health.lastError` + array vazio.
- Extração de nome: `[title]` → `aria-label` → maior nó de texto da primeira linha visual;
  descarta ruído (horários, "não lidas", números soltos, rótulos do sistema) via a mesma
  lista do v1, ampliada e centralizada em uma constante.
- Extração de não-lidas: `aria-label` com número → badge numérico pequeno (≤40×40 px) → 0.
- `id`: `data-id`/`data-jid` casando `/@[a-z.]+$/` → `jid`; senão `data-testid`/`id` estável → `dom`;
  senão `name:<hashString(normalizeForMatch(name))>` → `name`.
- Perf: `listChats()` deve custar **O(linhas)**, sem `querySelectorAll('div')` na página inteira
  e sem `getComputedStyle` por nó de texto. Alvo: < 15 ms para 100 linhas.

### 4.3 `composer.js`
```js
openChat(chat) → Promise<{ ok, via }>     // via: 'row' | 'search'
insertDraft(text) → Promise<boolean>      // insere sem enviar
sendMessage(chat, text) → Promise<boolean>// abre, insere, Enter
```
- `openChat`: (1) localiza a linha viva pelo `id`/nome e dispara `pointerdown/mouseup/click`;
  (2) fallback: usa o campo de busca da lista (`[contenteditable][role=textbox]` dentro do pane,
  ou `input[type=text]`), escreve o nome com o *native value setter* + `InputEvent`, espera a
  linha aparecer (polling com `MutationObserver` + timeout 4 s), clica e **limpa a busca**;
  (3) devolve `{ ok:false, reason }` — sem `alert`, quem chama mostra toast.
- `insertDraft`: acha o composer (contenteditable dentro do painel principal, excluindo o pane
  lateral), foca, e insere por: `execCommand('insertText')` → se o texto não apareceu, dispara
  `paste` com `DataTransfer` (compatível com o editor Lexical do WhatsApp) → `beforeinput`.
  Verifica o resultado lendo o `textContent` do composer.
- Todas as esperas usam `waitFor(predicate, { timeout, interval })` de `utils`, nunca `setInterval` solto.

## 5. `ui/` — camada visual

### 5.1 `h.js`
`h(tag, props, ...children)` com: `class`/`className`, `style` (objeto), `dataset`, `on*`
(listeners), `attrs`, `ref`. Filhos string viram `document.createTextNode` — **é impossível
injetar HTML por este caminho**. Também exporta `frag()`, `svg()` (namespace correto)
e `clear(node)`.

### 5.2 `app-root.js`
- Cria `<div id="kanzapp-root">` em `document.documentElement`, `attachShadow({mode:'open'})`.
- Carrega `styles.css` para `adoptedStyleSheets`.
- Monta `launcher` (botão flutuante arrastável com posição persistida) + o overlay do board.
- Expõe `mount()`, `unmount()`, `toggle()`, `open()`, `close()`.
- Reinjeta-se se o WhatsApp remover o host (observer leve no `documentElement`, throttled).

### 5.3 `board.js` / `card.js` / `dnd.js`
- Layout: header (marca, busca, filtros, ações, status de saúde), colunas roláveis horizontalmente.
- **Render por diff**: `renderBoard(state)` reaproveita nós por `data-card-id`/`data-column-id`;
  só cria/remove/reordena o necessário. Proibido `container.innerHTML = ''` no caminho de update.
- Colunas: contador, limite WIP com destaque quando estourado, cor, colapsar, renomear inline
  (duplo clique), arrastar para reordenar, excluir com diálogo de confirmação.
- Cards: avatar (imagem com fallback para iniciais coloridas — **fallback via `onerror`
  programático, nunca atributo HTML**), nome, prévia truncada por CSS (não por `substring`),
  badge de não lidas, pílulas de tag, ícones de nota/follow-up, tempo relativo.
  Clique no card abre a conversa; ações rápidas aparecem no hover/foco.
- DnD via **Pointer Events** (funciona com mouse e toque), com:
  placeholder de inserção, auto-scroll horizontal nas bordas, `aria-grabbed`, e
  alternativa por teclado: `Espaço` pega/solta, setas movem, `Esc` cancela.
- Virtualização simples: renderiza no máximo 60 cards por coluna, com botão "Mostrar mais".
- Estados vazios desenhados (sem card / sem resultado de busca / WhatsApp não detectado).

### 5.4 `dialog.js` / `toast.js`
`openDialog({ title, body(h), actions, size, onClose }) → Promise<result>` com foco preso,
`Esc`, clique no backdrop, retorno de foco ao elemento anterior, `role="dialog"` + `aria-modal`.
`confirm(msg)`/`prompt(label, value)` próprios construídos sobre `openDialog`.
`toast(msg, { type, action, duration })` empilhável, com `role="status"`.

### 5.5 Design
- Tokens em `:host` (cores, raios, sombras, espaçamentos, tipografia) com blocos separados
  para `[data-theme="dark"]`. Contraste AA em ambos os temas.
- Acento primário WhatsApp (`#00a884`) preservado; superfícies neutras; sombras suaves;
  transições ≤ 180 ms; `prefers-reduced-motion` respeitado.
- Foco visível em **todo** elemento interativo (`:focus-visible`).
- Responsivo até 1024 px de largura (colunas com scroll horizontal e largura mínima 260 px).

### 5.6 Atalhos
`Ctrl+Shift+K` abre/fecha o board (via `commands` no manifest + fallback local),
`/` foca a busca, `Esc` fecha o topo da pilha (popup → diálogo → board).

## 6. `background/index.js`
- `chrome.action.onClicked` → toggle na aba do WhatsApp; se não houver aba, abre `web.whatsapp.com`.
- `chrome.commands.onCommand` → mesmo toggle.
- Alarmes: `schedule_alarm`/`cancel_alarm` via `chrome.runtime.onMessage` **com `sendResponse`**
  (o v1 não respondia). Nome do alarme: `followup:<contactId>`.
- `onStartup` + `onInstalled`: relê `followups` do store e (a) recria alarmes futuros,
  (b) dispara imediatamente os vencidos e ainda não `done`.
- Notificação: ícone **local**, botões "Abrir conversa" e "Adiar 1 h"; `onButtonClicked` trata ambos.
- Badge da extensão mostra a contagem de follow-ups vencidos.
- Sem `console.log` ruidoso: usar o `logger` com nível.

## 7. Qualidade — regras verificáveis (o validador checa cada uma)

1. `node --check` limpo em todo `.js`/`.mjs`.
2. Nenhuma ocorrência de `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
   `eval`, `new Function` em `src/` — exceto `innerHTML = ''` proibido também. (`h.js` não usa nenhum.)
3. Nenhum `alert(`, `confirm(`, `prompt(` nativo em `src/`.
4. Nenhum acesso direto a `chrome.storage` fora de `core/storage-driver.js`.
5. Nenhum `!important` em `src/ui/styles.css`.
6. Nenhuma URL `http(s)://` externa em `src/` e `manifest.json` (exceto o match do WhatsApp).
7. Todo `import` resolve para um arquivo existente; nenhum símbolo importado inexistente.
8. Nenhuma variável global implícita (`window.x = ` só no ponto de debug documentado:
   `window.__kanzapp` em modo debug).
9. Todos os `addEventListener` de escopo global e observers têm caminho de remoção
   (`unmount()`/`stop()`), sem vazamento.
10. `tests/run.mjs` passa 100%.

## 8. Testes

### 8.1 Unitários em Node (`npm test` → `node tests/run.mjs`)
Runner próprio (sem deps): `describe/it/expect` mínimos, saída colorida, exit code ≠ 0 em falha.
Cobertura obrigatória:
- `utils`: hashString estável, relativeTime em todas as faixas, debounce/throttle, normalizeForMatch.
- `migrations`: v1 completo → v2 (sem perda, idempotente), v1 parcial, estado vazio, v2 já migrado.
- `store`: mutações concorrentes (10 `moveCard` em paralelo → estado consistente, sem perda),
  `removeColumn` reatribui cards, `removeTag` limpa referências, `syncContacts` não apaga
  contatos ausentes, export/import round-trip.
- `storage-driver`: serialização da fila (escritas concorrentes aplicadas em ordem).
- `strategies`: `scoreCandidate` ordena candidatos corretamente (com um mini-DOM stub).

### 8.2 Bancada de layout (`tests/harness.html`)
Página estática que injeta `chrome` stub e monta o adapter contra 3 fixtures que simulam
**três markups diferentes** do WhatsApp:
- `layout-a`: `#pane-side` + `div[role="row"]` + `span[title]` + `data-id="...@c.us"` (atual).
- `layout-b`: sem `#pane-side`, sem `role`, classes ofuscadas diferentes, nome em `aria-label`,
  badge de não lidas com `aria-label` textual.
- `layout-c`: degradado — só `div`s aninhados com texto, sem `title`, sem `aria`, sem `data-id`.

Critério de aceite: o adapter extrai **≥ 90 % dos contatos com o nome correto** em A e B,
e **≥ 60 %** em C, e `health.confidence` reflete a degradação. O harness imprime uma
tabela de resultados e expõe `window.__harnessResults` para leitura automatizada.

## 9. Definição de pronto

- Extensão carrega em `chrome://extensions` sem erro, sem warning de manifest.
- Board abre em < 150 ms com 100 contatos; nenhum frame > 50 ms durante drag.
- Dados do v1 aparecem intactos após a atualização.
- Todos os itens da seção 7 verdes e a seção 8 passando.
- `README.md` atualizado (funcionalidades, instalação, atalhos, resolução de problemas).
