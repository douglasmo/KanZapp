# Auditoria 01 — KanZapp v2 (veredito: REPROVADO)

Auditoria executada pelo agente `kanzapp-validator` contra `docs/ARCHITECTURE.md`.
Este documento é a lista de trabalho do implementador. Cada achado traz arquivo:linha,
cenário de falha reproduzido e a correção sugerida.

## O que já passou (não regredir)

`node --check` limpo em 40 arquivos; nenhum `innerHTML`/`eval`/`alert`/`confirm`/`prompt`;
`chrome.storage` só no driver; nenhum `!important`; nenhuma URL externa; todos os imports
resolvem para arquivo **e símbolo** existentes; `node tests/run.mjs` → 158/158.
Fixtures A/B/C extraem 100 % dos nomes. `listChats()` 5,2–9,5 ms para 100 linhas.
`checkDiff`: 125 nós reaproveitados, 0 recriados; repaint 3–7 ms com 127 cards.
Cadeia real `app.js` → store real → adapter real → UI monta e sincroniza.
Observer desligado com o board fechado (0 syncs em 4 s). Teardown limpo na invalidação de
contexto. Migração v1→v2 sem perda e idempotente. Contraste AA nos dois temas. 1024 px OK.
`checkDrag(20)` verde — a correção do card duplicado se sustentou sob estresse.
Testes de `store`/`storage-driver`/`migrations`/`utils` são substanciais, não tautológicos.

---

## BLOQUEADORES

### #1 CRÍTICO — Um `[title]`/`[aria-label]` concorrente envenena 100 % dos nomes
`src/wa/adapter.js:135-148` (`pickName`), `src/wa/adapter.js:85-105` (`collectLabels`)

`collectLabels()` coleta rótulos de **todos** os descendentes em ordem de documento e
`pickName()` faz `const chosen = fromLabels.length > 0 ? fromLabels : clean(fragments)` —
se **qualquer** rótulo passar por `usableName()`, os fragmentos de texto nunca são
consultados e o **primeiro** rótulo vence.

Reproduzido: fixture A intacta (`#pane-side` + `role="row"` + `span[title]` + JID) mais um
`<button aria-label="Menu de contexto da conversa">` como primeiro filho da linha — que é
markup que o WhatsApp já usa hoje:

```
antes:  ["João Silva","Maria Fernanda","Carlos Eduardo Souza", …]  (10 corretos)
depois: ["Menu de contexto da conversa" × 10]
health: { ok:true, strategy:"pane-side/role-row", confidence:96, degraded:false }
```

Pelo store real, como os ids são JIDs, `src/core/store.js:216`
(`name: normalizeText(chat.name) || existing?.name`) **sobrescreve o nome bom pelo lixo** e
grava em disco. O backup exportado carrega a corrupção.

A 4ª mutação do validador (layout D: `role="tree"`/`role="treeitem"`, `data-id` sem JID, nome
em `<span>` aninhado, botão de menu por linha) deu **0/10** com `confidence: 59, ok: true`.
Removendo só os botões: **10/10**. As três fixtures existentes passam porque todas foram
desenhadas com o nome como primeiro rótulo da linha.

**Correção**: pontuar candidatos a nome (posição na primeira linha visual, tamanho,
coincidência com um fragmento de texto realmente visível) em vez de "primeiro rótulo vence";
descartar rótulos de `button`/`[role=button]`/`[data-icon]`/`[role=img]`; quando o rótulo não
corresponder a nenhum fragmento de texto visível da linha, preferir o fragmento.
Adicionar fixture com botão de menu **antes** do nome e outra sem `role`/`data-id` com nome
aninhado.

### #2 CRÍTICO — `confidence`/`degraded` medem a estratégia, não a qualidade da extração
`src/wa/adapter.js:284-289` (`computeConfidence`), `src/wa/adapter.js:526-534`

Não há nenhum termo sobre o **conteúdo** extraído. Medido:
- achado #1: 0 % de nomes corretos com `confidence: 96, degraded: false`;
- inverso: layout C extrai **100 %** dos nomes e reporta `degraded: true, confidence: 60`
  — banner "Leitura degradada" sem motivo.

Viola §8.2 ("`confidence` reflete a degradação") e P6 ("nunca falha silenciosa").

**Correção**: incorporar sinais de resultado — proporção de linhas que viraram chat, **nomes
duplicados entre linhas** (sinal forte de rótulo envenenado ⇒ `degraded = true` e confiança
baixa), nomes idênticos ao rótulo de um botão, nomes sem espaço/só maiúsculas. E parar de
marcar `degraded` quando a extração está perfeita.

### #3 ALTO — `Esc` fecha o quadro inteiro em vez de cancelar o topo da pilha
`src/ui/app-root.js:237` registra `document.addEventListener('keydown', onKeyDown, true)` —
**fase de captura no document**. Todo `stopPropagation()` dentro do shadow root roda depois e
não impede nada. Só diálogos estão protegidos (`if (dialogs.hasOpen()) return`).

| Ação | Esperado | Observado |
|---|---|---|
| `Esc` com card pego pelo teclado (`dnd.js:337-341`) | cancelar o movimento | quadro fecha |
| `Esc` na busca com texto (`board.js:70-77`) | limpar a busca | limpa **e** fecha |
| `Esc` no rename inline (`board.js:300-309`) | cancelar a edição | quadro fecha |
| `Esc` durante arraste por ponteiro | cancelar | fecha com o card ainda `is-dragging` |

Cascata: com o quadro fechado, `app-root.js:125` para de repintar e o observer é desligado.
Contrato §5.6 exige "Esc fecha o topo da pilha (popup → diálogo → board)".

**Correção**: listener na fase de bolha, ou consultar uma pilha de modos antes de fechar
(diálogo → grab do dnd → arraste em andamento → edição inline → busca preenchida → board).

### #4 ALTO — Soltar fora de qualquer coluna move o card assim mesmo
`src/ui/dnd.js:43-58` (`columnAt`), `139-142` (`moveDrag`), `167-177` (`cleanupDrag`)

`columnAt()` nunca devolve `null` havendo ao menos uma coluna: fora de todos os retângulos
ele cai no `fallback` da coluna mais próxima **em x, ignorando y**. Reproduzido: card
`c4@c.us` solto em `(700, 20)` — dentro do cabeçalho do quadro — resultou em
`{antes:"todo", depois:"nego"}`. Quem arrasta para cima para desistir perde a posição, sem
desfazer.

**Correção**: exigir que `y` esteja na faixa vertical das colunas (mesma tolerância de 40 px)
antes de aceitar o fallback horizontal; sem coluna válida, `cleanupDrag` reverte para
`originList`/`originNext`.

### #5 MÉDIO — `syncContacts` descarta `timeLabel`/`muted`/`pinned`; todo card mostra "agora"
`src/core/store.js:213-224` monta o contato campo a campo e não copia os três, apesar de
§4.2 declará-los em `Chat` e do adapter extraí-los corretamente.

```
adapter: { id:"5511999990001@c.us", name:"João Silva", timeLabel:"10:03", unread:3 }
store:   { …sem timeLabel, sem muted, sem pinned }
```
`src/ui/card.js:155` faz `contact.timeLabel || relativeTime(contact.lastSeenAt, now)`; como
`timeLabel` é sempre `undefined` e `lastSeenAt` é reescrito a cada sync (4 s), **todos os
cards exibem "agora", sempre** (confirmado no e2e). O tempo relativo de §5.3 não funciona e
`muted`/`pinned` são código morto.

### #7 MÉDIO — Autoteste `__testObserverRebind()` falha de forma determinística
`tests/harness.html:364-393` — 4/4 execuções: `{"pass":false,"callbacks":0}`.

O comportamento subjacente **funciona**: com 4 s para o watchdog + 2 s após a mutação o
validador obteve `{sanity:1, afterWatchdog:1, afterMutation:1}`. O problema é a janela de
2700 ms para um watchdog de 2000 ms + throttle de 400 ms + `requestIdleCallback({timeout:1000})`
— medido, o callback chegou 1002 ms após a mutação, ou seja o `requestIdleCallback` só dispara
no timeout. Ou o teste ganha folga, ou `observe()` precisa de caminho mais rápido. Como está,
é um autoteste vermelho que não guarda nada.

### #8 MÉDIO — `wipLimit` é exibido mas nenhuma tela o configura
`src/core/store.js:313-320` exporta `setColumnWipLimit`; `src/ui/board.js:747-749` desenha
`28/25` e a classe `is-over`. Nenhuma chamada a `setColumnWipLimit` existe em `src/ui` ou
`src/content`. Com o store real o campo é sempre `null` (`migrations.js:57` só preserva o que
já existe), então o badge nunca mostra limite. Só funcionou na bancada porque ela injeta o
valor à mão. §5.3 lista "limite WIP com destaque quando estourado" como requisito.

**Correção**: expor a edição (no diálogo de cor da coluna ou no menu da coluna) **ou** remover
o badge de WIP do board e o campo do contrato.

### #9 MÉDIO — `README.md` não foi atualizado
Continua o da v1. Não menciona `Ctrl+Shift+K`, atalho `/`, tema escuro, painel de diagnóstico,
export/import, migração do v1, nem resolução de problemas. §9 exige.

---

## RECOMENDADOS (não bloqueiam, corrigir se couber)

### #6 MÉDIO — Estado vazio "WhatsApp não detectado" nunca aparece depois do genérico
`src/ui/board.js:789-811`, o `if (existing) return;` da linha 800. O nó `.kz-empty--board` é
criado uma vez e o texto nunca é atualizado. Repro: quadro aberto com 0 contatos → depois
`health.ok = false` + repaint → segue dizendo "Nenhuma conversa capturada ainda". É exatamente
a ordem de um arranque a frio. Banner e chip de saúde acertam, o que mitiga.

### #10 MÉDIO — `composer.openChat` provavelmente reporta falha mesmo abrindo — **PLAUSÍVEL**
`src/wa/composer.js:114-122` (`currentChatName`), `321-334` (`clickRow`). `currentChatName()`
devolve `labelled[0]` — o primeiro rotulado do `<header>` do painel principal, que no WhatsApp
real costuma ser o botão de voltar ou "Foto do perfil de X", não o nome. `clickRow` exige
igualdade **exata**. É o mesmo padrão "primeiro rótulo vence" do #1 e deve ser endurecido
junto. Não reproduzível sem o WhatsApp real.

### #11 BAIXO — `store.select.cardsByColumn` é chamado e o resultado é integralmente re-derivado
`src/ui/board.js:406-501`. Instrumentado: o select é chamado 1×/paint e o fallback **não**
dispara (a API bate — suspeita descartada). Mas `collect()` (471-499) reaplica busca, filtro de
tag, só-não-lidas e ordenação por conta própria, tornando o select decorativo: se ele passar a
devolver algo errado, ninguém percebe. Ou o board confia no select, ou não o chama.

### #12 BAIXO — DOM discorda do store por ~500 ms após `Esc` no grab de teclado
`src/ui/board.js:860-887`. Em t≈500 ms: `store:"todo"` / `dom:"doing"`; converge em t≥1000 ms.
Risco maior: `dnd.js:364` `isBusy()` é `Boolean((drag && drag.started) || grab)`; se um
`pointerup` se perder (perda de foco da aba, captura de ponteiro perdida), `drag` fica preso, o
quadro **para de repintar para sempre** e recusa novos `pointerdown` (`dnd.js:197`). O
travamento é **PLAUSÍVEL** (não provocável com eventos sintéticos). Vale um watchdog em
`blur`/`visibilitychange`/timeout que force `cleanupDrag(false)`.

### #13 BAIXO — Sem armadilha de foco no overlay
`src/ui/app-root.js:199-206`. Sem `role="dialog"`/`aria-modal` nem contenção de Tab: do último
focável (657 com 125 cards) o foco vai para o WhatsApp por baixo. O resto da a11y está bom —
`role="region"`, colunas `role="list"`, cards `role="listitem"`/`aria-grabbed`, live region
funcionando, ações reveladas por `:focus-within`.

### #14 BAIXO — `settings.showArchived` é campo morto
`src/core/constants.js:40` e `migrations.js:108` o declaram; nenhuma UI o edita e nenhum
consumidor o lê. Expor ou remover.

### #15 BAIXO — `src/ui/` (~3.000 linhas) tem 1 teste unitário
`tests/unit/card.test.mjs`: um `it`, 2 asserts. `board.js` (908), `dnd.js` (379), `dialog.js`
(279) e as 5 views não têm teste em Node. Os defeitos #3, #4, #6 e #12 escaparam por isso.

### Nota de perf (não é achado)
Na primeira carga fria da bancada, `perf.mediaMs` deu 15,96 ms contra o orçamento de 15 ms e o
harness imprimiu `REPROVADO`; em 4 execuções seguintes, 6,4–9,5 ms. Artefato de compilação a
frio, mas o veredito do harness pisca vermelho de vez em quando — vale aquecer antes de medir.

---

## Limitações desta auditoria

Inspeção visual por screenshot não foi possível (o painel do navegador devolveu escala errada e
depois timeout). Todo o julgamento de UI/a11y foi por DOM + estilos computados, não por olho.
Nada foi testado contra o WhatsApp Web real — só contra fixtures.
