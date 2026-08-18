# Avaliação visual e de produto — o que melhorar

Levantado observando o app renderizado (bancada `tests/ui-harness.html`, 1440×900 e 1024×700) e
os arquivos de ícone. Não é palpite de estilo: cada item abaixo foi visto.

Ordenado por impacto. Os itens de **identidade** vêm primeiro porque bloqueiam a submissão às
lojas e porque refazer screenshots depois é retrabalho.

---

## A. Identidade — resolver antes de produzir material de loja

### A1. O ícone desenha um "H", não um "K" 🔴

`assets/kanzapp-icon.svg`, linhas 38–39: o path traça duas hastes verticais unidas por uma
travessa central — isso é um **H**. O produto se chama KanZapp e o cabeçalho do quadro mostra
um **K**. Quem instalar vê um "H" na barra do navegador e um "K" dentro do app.

Foi confirmado renderizando `assets/icon128.png`.

### A2. O ícone não sobrevive a 16px 🔴

A arte empilha três camadas — moldura arredondada, quatro barras horizontais (as "raias" do
kanban) e a letra por cima. Em 128px lê bem; em 16px, que é o tamanho na barra de ferramentas e
na lista de extensões, vira um borrão esverdeado. Precisa de uma variante simplificada para
tamanhos pequenos: só a letra sobre o fundo, sem as barras e sem o degradê interno.

### A3. A paleta do ícone é o verde do WhatsApp 🟠

`#00A884` é literalmente a cor de marca do WhatsApp, e o gradiente `#7CF0D3 → #00A884` reforça a
associação. Combinado com o nome citando a marca (ver `docs/PUBLICACAO.md` §1.1), aumenta o risco
de a revisão entender que há afiliação implícita.

Sugestão: manter o verde-azulado como acento **dentro** do app (onde ajuda a integrar com o
WhatsApp) e diferenciar o ícone da loja — outro matiz, ou fundo escuro com a letra em acento.

---

## B. Layout — defeitos observados

### B1. O botão flutuante fica por cima do quadro aberto 🔴

Visível nas duas capturas: o círculo verde com o "K" fica sobre a coluna "Concluído", tapando
parte de um card. Ele é o atalho para **abrir** o quadro; com o quadro aberto não tem função e só
atrapalha. Deve ocultar-se enquanto o quadro está aberto (e reaparecer ao fechar).

### B2. O título da coluna trunca sem necessidade 🟠

"Em atendimento" aparece como "Em atendime…" já em 1440px. A causa não é falta de espaço na
coluna, é competição: o cabeçalho empilha recolher + título + badge + **três** botões de ícone
sempre visíveis (renomear, cor/WIP, excluir).

Sugestão: colapsar as três ações num único botão "⋯" que abre um menu, revelado em `:hover` e
`:focus-within`. Devolve ~60px ao título e limpa o cabeçalho.

### B3. A lixeira fica a um clique, colada no renomear 🟠

Excluir coluna é destrutivo (reatribui todos os cards) e está permanentemente visível ao lado de
uma ação inócua. Há diálogo de confirmação, o que evita o desastre, mas o alvo não deveria estar
sempre exposto. Resolve junto com B2, movendo para dentro do menu.

### B4. A linha de follow-up quebra feio no card 🟡

No card "Íris Iglesias": `Enviar contrato · em 2` / `h` — a unidade órfã na segunda linha. Falta
`white-space: nowrap` no trecho do prazo, ou truncagem do título do lembrete com reticências.

### B5. O indicador de nota é um glifo solto 🟡

O ícone de documento ocupa uma linha inteira sozinho, embaixo da prévia. Custa altura em todos os
cards com nota e não comunica muito. Melhor: agrupar os indicadores (nota, follow-up, grupo) numa
única linha de metadados, ou levar o ícone para junto do horário.

### B6. Dois contadores dizendo quase a mesma coisa 🟡

"125 contatos" e "Leitura ok · 125 conversas" ficam lado a lado no cabeçalho. O primeiro é o
quadro, o segundo é a leitura do WhatsApp — a distinção é real, mas não está legível. Só faz
sentido mostrar os dois quando **divergem** (ex.: "125 no quadro · 98 lidas agora").

### B7. O que está bom, não mexer

A degradação para ícones sem rótulo em 1024px funciona; as colunas rolam horizontalmente sem
estourar a página; a truncagem de prévia agora respeita a borda do card; as cores de avatar
distinguem bem; o acento por coluna no topo é discreto e útil.

---

## C. Funcionalidades ausentes para um CRM de verdade

Não estão no roadmap em andamento.

### C1. Envelhecimento de card ("parado há X dias") 🔴 — a maior lacuna

Um funil serve para mostrar **onde o negócio travou**. Hoje o card exibe a hora da última
mensagem, mas nada diz há quanto tempo ele está parado naquela coluna. É o dado mais acionável de
um Kanban de vendas.

O dado já existe: `cards[id].updatedAt` muda quando o card muda de coluna. Falta:
- exibir "parado há N dias" quando ultrapassa um limiar (sugestão: 3 dias, configurável);
- destaque visual crescente (borda âmbar → vermelha) por faixa de tempo;
- ordenação "mais parados primeiro";
- opcionalmente, limiar por coluna — 2 dias em "Negociação" é grave, 30 em "Concluído" é normal.

### C2. Variáveis nos modelos de mensagem 🟠 — barato e muito visível

Modelos hoje são texto fixo. Com `{{nome}}` e `{{primeiro_nome}}` substituídos na inserção, o
recurso passa de "cola de texto" a "modelo" de verdade. É pouco código: substituição na hora de
inserir, mais uma dica na tela de modelos listando as variáveis disponíveis.

### C3. Follow-up rápido 🟠

Agendar exige abrir diálogo e preencher data e hora. Botões de atalho — "amanhã 9h", "em 2 h",
"segunda-feira" — cobrem a maior parte dos casos reais em um clique.

### C4. Ordenar/filtrar por follow-up vencido 🟡

Existem os lembretes e a lista deles, mas o quadro não consegue responder "quem eu devia ter
retornado e não retornei". Um filtro "com follow-up vencido" ao lado de "só não lidas" resolve.

### C5. Resumo do funil 🟡

Um cabeçalho com contagem por coluna, quantos entraram na semana e quantos estão parados daria
leitura de gestão. Depende de C1.

---

## Ordem sugerida

1. **A1 + A2** (ícone) — bloqueia material de loja, e é rápido.
2. **B1** (launcher por cima) — defeito visível em todo uso.
3. **C1** (envelhecimento) — a diferença entre um quadro bonito e um CRM útil.
4. **B2 + B3** (menu da coluna) — limpa o cabeçalho e tira o destrutivo da frente.
5. **C2 + C3** (variáveis e follow-up rápido) — baratos, muito percebidos.
6. **B4, B5, B6** (acabamento).
7. **C4, C5** — depois de C1.
