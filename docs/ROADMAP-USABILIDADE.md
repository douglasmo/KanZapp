# KanZapp v2.1 — Usabilidade (contrato de implementação)

Complementa `docs/ARCHITECTURE.md`, que continua valendo integralmente: `h()` para todo DOM,
store como fonte única, `storage-driver` como única porta do `chrome.storage`, Shadow DOM,
render por diff, zero diálogo nativo, pt-BR na interface.

Ordem de implementação obrigatória: **1 → 2 → 3 → 5 → 6 → 7 → 4**. As duas primeiras são o que
separa "demonstração" de "ferramenta"; a 4 é a maior e depende da seleção introduzida na 7.

---

## 1. Varredura da lista de conversas

**Problema.** A lista lateral do WhatsApp é virtualizada: só existem ~15–25 linhas no DOM.
O adapter lê o que está renderizado e o `refresh-controller` relê as mesmas linhas a cada 4 s.
Resultado: o funil nasce com 20 dos 300 contatos e o usuário não tem como saber disso.

**Entrega.** `src/wa/sweeper.js`:

```js
createSweeper({ adapter, logger }) → {
  run({ onProgress, signal }) → Promise<{ ok, found, batches, stopped, reason }>
}
```

- Resolve o elemento **rolável** da lista (pode ser o pane resolvido pelo adapter ou um
  descendente com `overflow-y: auto|scroll` e `scrollHeight > clientHeight`). Se não achar,
  devolve `{ ok:false, reason:'sem-scroller' }` — sem lançar.
- Guarda o `scrollTop` original e **restaura no fim**, inclusive em erro ou cancelamento.
  O usuário não pode terminar a varredura com a lista em outro lugar.
- Laço: `adapter.listChats()` → emite lote → rola `~80%` de `clientHeight` → espera o DOM
  assentar (`MutationObserver` no scroller + `requestAnimationFrame`, com timeout de 400 ms
  por passo) → repete.
- Critérios de parada, todos obrigatórios: `scrollTop` não mudou entre dois passos; nenhum id
  novo em 3 passos consecutivos; teto absoluto de 300 passos **ou** 90 s; `signal.aborted`.
- `onProgress({ found, step, done })` a cada lote, para a UI.
- Durante a varredura o auto-refresh fica **suspenso** (evita dois leitores disputando) e é
  restaurado ao final.

**UI.** Botão "Capturar conversas" no header, ao lado de "Atualizar". Abre diálogo com:
contador de contatos encontrados, passo atual, botão "Parar", e um aviso de que a aba do
WhatsApp precisa ficar visível durante o processo. Ao terminar: toast com o total capturado.
Se `reason === 'sem-scroller'`, mensagem explicando que a lista não foi localizada e sugerindo
o painel de Diagnóstico.

**Testes.** Unitário em Node com scroller falso (stub de `scrollTop`/`scrollHeight`/
`clientHeight` e uma fonte de linhas por faixa de scroll): cobre parada por fim de lista,
parada por teto, cancelamento por `signal`, e **restauração do `scrollTop` em todos os
caminhos, inclusive quando `onProgress` lança**.

## 2. Endurecer `composer.openChat` (achado #10 da auditoria)

**Problema.** `currentChatName()` devolve o **primeiro** `[title]`/`[aria-label]` do header do
painel principal — que no WhatsApp real costuma ser o botão de voltar ou "Foto do perfil de X".
`clickRow` exige igualdade exata, então a conversa abre e a extensão reporta falha, exibindo
"Não foi possível abrir a conversa" indevidamente.

**Entrega.** É o mesmo defeito de "primeiro rótulo vence" já corrigido no adapter — reaproveite
a solução, não escreva outra:

- Exporte de `src/wa/adapter.js` o que já existe de pontuação de candidatos
  (`scanRowNodes`/`buildNameCandidates` e o descarte de rótulos de `button`/`[role=button]`/
  `[data-icon]`/`[role=img]`) e use no header do painel principal.
- `currentChatName()` passa a devolver o **conjunto** de candidatos pontuados, não uma string.
- A confirmação de abertura deixa de ser igualdade exata: é positiva quando algum candidato
  casa por `normalizeForMatch` **ou** quando o composer apareceu e o header contém o nome
  esperado como subcadeia normalizada.
- Só reporte `{ ok:false }` depois de esgotar linha viva **e** busca. Registre `via` e o motivo.

**Teste.** Unitário com mini-DOM: header cujo primeiro rotulado é "Foto do perfil de Ana
Almeida" e o nome real vem depois ⇒ `openChat` confirma. Header de outra conversa ⇒ não confirma.

**Aviso ao implementador:** este achado nunca foi reproduzido contra o WhatsApp real, só por
leitura de código. Não invente markup real; torne a lógica robusta a variações e deixe o caminho
de diagnóstico legível.

## 3. Busca sobre notas e tags

Hoje `board.collect()` filtra por `contact.name` e `contact.preview` (`board.js:580`).
Passa a considerar também `card.note` e o **nome das tags** do card.

Sintaxe de filtro reconhecida no mesmo campo, tudo opcional e combinável com texto livre:
`tag:vip`, `nota:orçamento`, `coluna:negociação`. Prefixos casam por `normalizeForMatch` e por
prefixo do nome (`tag:vi` acha "VIP"). Sem prefixo, busca em nome + prévia + nota + tags.
Atualize o `placeholder` e adicione um `title` explicando a sintaxe.

Extraia o parser para função **pura e exportada** (`parseSearchQuery(input)`) com teste em Node
cobrindo: texto simples, prefixo isolado, prefixo + texto, prefixo desconhecido tratado como
texto literal, acentuação e caixa.

## 5. Desfazer

Ações reversíveis: mover card, aplicar/remover tags, arquivar/desarquivar, e as ações em lote
da seção 4. Pilha limitada a 25 entradas, **em memória** (não persiste entre sessões).

- Após cada movimento por arraste, o toast ganha ação **"Desfazer"**.
- `Ctrl+Z` dentro do quadro desfaz o topo da pilha; `Ctrl+Shift+Z` refaz.
- Cada entrada guarda a operação inversa **e** o estado esperado do alvo. Se o estado tiver
  mudado desde então (o contato foi movido por outro caminho, o card sumiu), não aplique às
  cegas: informe por toast que a ação não pôde ser desfeita e descarte a entrada.
- A pilha vive na camada de UI (é sessão, não dado), mas cada desfazer aplica-se por
  `store.actions`, nunca escrevendo estado direto.

## 6. Filtro de grupos

O adapter já extrai `isGroup`. Adicione `settings.hideGroups` (padrão `false`) com alternância
na barra de filtros, ao lado de "Só não lidas". Filtro é de **exibição**: nada é apagado do
store, para que desligar o filtro devolva os cards intactos.

## 7. Arquivar cards

**Atenção — não confundir com o campo removido.** A auditoria (#14) removeu `settings.showArchived`
porque, sob a semântica do WhatsApp, ele era mentira: a lista lateral **nunca** entrega conversas
arquivadas, então nenhum consumidor honesto era possível. O arquivamento desta seção é **do
KanZapp**, não do WhatsApp: é o usuário marcando um card como fora do funil. É um conceito novo,
sob nosso controle, e por isso legítimo. Reintroduza `settings.showArchived` com esta semântica
e documente-a no próprio `constants.js`, para que uma auditoria futura não o remova de novo.

- `cards[id].archived: boolean` e `archivedAt: number`, com `store.actions.setArchived(id, bool)`.
- Cards arquivados somem do quadro salvo quando `settings.showArchived` está ligado; nesse modo
  aparecem com aparência esmaecida e ação "Desarquivar".
- Ação "Arquivar" no card e no menu de lote.
- Em Configurações, um utilitário **manual** (nunca automático): "Arquivar contatos sem
  atividade há mais de N dias", com N configurável (padrão 90), que mostra **quantos** serão
  afetados e pede confirmação antes de aplicar. Nada de apagar dado: arquivar é reversível.
- `store.select.stats` passa a contar arquivados à parte.

## 4. Ações em lote

Depende da seleção; implemente por último.

- Modo seleção: `Ctrl`/`Cmd` + clique alterna um card; `Shift` + clique seleciona intervalo
  dentro da mesma coluna; `Esc` limpa a seleção (**entra na pilha de `Esc` corrigida no achado
  #3, acima de "busca preenchida"**).
- Seleção é estado de sessão, não persiste, e é limpa quando os filtros mudam.
- Barra de ações flutuante ao pé do quadro enquanto houver seleção: contador, "Mover para…",
  "Aplicar tag…", "Remover tag…", "Arquivar", "Limpar seleção".
- Toda ação em lote é **uma** mutação do store (uma escrita, não N), e **uma** entrada na pilha
  de desfazer.
- Acessibilidade: os cards selecionados recebem `aria-selected`; a barra é `role="toolbar"` com
  `aria-label`; a contagem é anunciada na live region existente.

---

## Verificação (igual ao contrato principal, seção 7)

`node --check` limpo; `node tests/run.mjs` 100 % verde incluindo os testes novos; checklist da
seção 7 sem regressão; as duas bancadas verdes (`checkDrag`, `checkDiff`, fixtures de layout).

Acrescente à `tests/ui-harness.html` uma checagem de transbordo — percorrer o shadow root e
falhar se qualquer elemento pintar fora do retângulo do seu container. Foi assim que o
`display: inline` no `.kz-card__preview` escapou de todo mundo, inclusive da auditoria, que
julgou a UI por DOM e estilos computados.
