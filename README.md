# KanZapp — CRM Kanban dentro do WhatsApp Web

O KanZapp é uma extensão de navegador (Chrome/Edge, Manifest V3) que coloca um quadro
Kanban por cima do WhatsApp Web. As conversas da lista lateral viram cards; você arrasta
entre colunas, marca com tags, escreve notas internas e agenda lembretes — sem sair da aba
e **sem nada sair do seu computador**.

Esta é a versão 2, reescrita do zero. Nenhuma dependência de runtime, nenhuma requisição de
rede, nenhum dado enviado para lugar nenhum.

---

## Funcionalidades

**Quadro**
- Colunas configuráveis: criar, renomear (duplo clique no título), recolher, reordenar
  (arrastar o cabeçalho ou `Alt`+`←`/`→`), escolher cor e definir **limite WIP** — o contador
  do cabeçalho fica em destaque quando a coluna estoura o limite.
- Cards com avatar (com fallback de iniciais coloridas), prévia da última mensagem, badge de
  não lidas, pílulas de tag, ícone de nota e de follow-up, e tempo relativo.
- Arrastar e soltar por mouse **e** por toque, com auto-scroll nas bordas. Soltar fora das
  colunas devolve o card para o lugar de origem, sem mexer no quadro.
- Alternativa completa por teclado: `Espaço` pega o card, setas movem, `Espaço`/`Enter` solta,
  `Esc` cancela e devolve à posição original.
- Busca, filtro por tag, "só não lidas" e ordenação (manual, ordem da caixa, mais recentes,
  nome).
- Até 60 cards por coluna com botão "Mostrar mais" — quadros grandes não travam.

**CRM**
- Tags com nome, cor e descrição.
- Modelos de mensagem com atalho, inseridos no campo de digitação sem enviar sozinhos.
- Notas internas por contato.
- Follow-ups com notificação do sistema, botões "Abrir conversa" e "Adiar 1 h", e contador de
  atrasados no ícone da extensão. Lembretes vencidos enquanto o navegador estava fechado
  disparam assim que ele volta.

**Dados**
- Tudo em `chrome.storage.local`. Sem servidor, sem conta, sem telemetria.
- Export e import de backup em JSON (com opção de mesclar ou substituir).
- Migração automática dos dados do KanZapp v1, sem perda. As chaves antigas ficam como
  backup até você mandar apagar em Configurações.

**Aparência e acessibilidade**
- Tema claro/escuro seguindo o WhatsApp (detecção por classe **e** por luminância) ou fixado
  na mão; densidade confortável/compacta.
- Toda a interface vive em um Shadow DOM, então o CSS do WhatsApp não afeta o quadro e
  vice-versa.
- Foco visível em tudo, leitores de tela anunciam os movimentos de card, `prefers-reduced-motion`
  respeitado, contraste AA nos dois temas.

---

## Instalação (modo desenvolvedor)

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions/` (ou `edge://extensions/`).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e escolha a pasta raiz do projeto (a que tem o
   `manifest.json`).
5. Abra <https://web.whatsapp.com>. O botão flutuante do KanZapp aparece no canto — arraste-o
   para onde preferir, a posição fica salva.

## Atalhos

| Atalho | O que faz |
|---|---|
| `Ctrl`+`Shift`+`K` | abre/fecha o quadro |
| `/` | foca a busca (quando o quadro está aberto) |
| `Esc` | fecha **o topo da pilha**: diálogo → arraste/card pego → renomear coluna → busca preenchida → quadro |
| `Espaço` no card | pega/solta o card para mover com o teclado |
| `←` `→` `↑` `↓` com card pego | move entre colunas e posições |
| `Alt`+`←` / `Alt`+`→` no título da coluna | move a coluna |
| duplo clique no título da coluna | renomeia sem abrir diálogo |

O clique no ícone da extensão faz o mesmo que `Ctrl`+`Shift`+`K`. Se não houver aba do
WhatsApp Web aberta, ele abre uma.

---

## Como a extensão lê a lista de conversas

O WhatsApp Web muda de markup sem aviso e sem versão. Em vez de depender de um seletor, o
KanZapp usa uma cadeia de estratégias pontuadas:

1. procura o painel da lista (`#pane-side` → rótulo acessível → `role` de lista → heurística
   estrutural: elemento rolável, alto, no terço esquerdo, com filhos de altura parecida);
2. procura as linhas dentro dele (`role` de linha → `data-id` com JID → maior grupo de irmãos
   com altura de linha de conversa);
3. em cada linha, **pontua candidatos a nome**: posição na primeira linha visual, formato do
   texto, e se o rótulo corresponde a algum texto realmente visível. Rótulo de botão ou de
   ícone nunca vira nome, e um texto que se repete na maioria das linhas é tratado como
   moldura da interface, não como contato.

Se a leitura sair errada, a extensão **fala**: o chip de saúde no cabeçalho mostra
"Leitura parcial" ou "WhatsApp não detectado", um aviso explica o que fazer, e
**Configurações → Diagnóstico da leitura** mostra a estratégia usada, a confiança, a
qualidade da extração (nomes duplicados, linhas não lidas, nomes suspeitos) e o último erro.
O botão "Copiar diagnóstico" gera um JSON para colar em um relato de bug.

---

## Resolução de problemas

**O quadro não abre.** Confira se a aba é `https://web.whatsapp.com` e recarregue a página.
Depois de atualizar a extensão em `chrome://extensions`, abas antigas continuam com a versão
anterior carregada — recarregue-as.

**Aparece "WhatsApp não detectado".** A lista de conversas ainda não carregou (QR code, tela
de sincronização) ou o layout mudou. Espere a lista aparecer e clique em **Atualizar**. Os
cards continuam no lugar: eles vêm do que já estava salvo, não da leitura da tela.

**Aparece "Leitura parcial".** A extração está funcionando por um caminho alternativo ou o
conteúdo lido está estranho (nomes repetidos, por exemplo). Abra
**Configurações → Diagnóstico da leitura** para ver o motivo. Nomes suspeitos **não**
sobrescrevem nomes que já estavam salvos — seus dados não são corrompidos por uma leitura
ruim.

**Nomes ou fotos faltando em alguns cards.** A lista lateral do WhatsApp é virtualizada: só
existe no DOM o que está visível. Role a lista e clique em **Atualizar**. Contatos que saem
da tela **nunca** são apagados do quadro.

**Cliquei no card e a conversa não abriu.** O contato pode estar fora da parte carregada da
lista. A extensão tenta pela busca do próprio WhatsApp; se ainda assim não achar, um aviso
aparece. Role a lista até o contato e tente de novo.

**Perdi dados depois de reinstalar.** Reinstalar a extensão pode limpar o
`chrome.storage.local`. Exporte um backup de vez em quando em
**Configurações → Backup → Exportar JSON**.

**Vim do KanZapp v1.** A migração é automática na primeira abertura e não apaga nada: as
chaves antigas continuam salvas como backup. Confira o quadro e, se estiver tudo certo, use
**Configurações → Dados do KanZapp v1 → Limpar chaves do v1**.

---

## Desenvolvimento

```
npm test        # node tests/run.mjs — runner próprio, sem dependências
```

Bancadas no navegador (precisam de HTTP; ESM não carrega por `file://`):

```
python -m http.server 4599 --bind 127.0.0.1
# http://localhost:4599/tests/harness.html      → resiliência de layout (5 fixtures)
# http://localhost:4599/tests/ui-harness.html   → interface, com store e adapter falsos
```

`tests/harness.html` monta cinco markups diferentes do WhatsApp e mede quantos contatos o
adapter extrai com o nome correto, o tempo de leitura e a saúde reportada. `?auto=1` roda tudo
e escreve o resultado em `#auto-results` para leitura automatizada.
`tests/ui-harness.html` tem as regressões da interface (`checkAll`): arraste, pilha do `Esc`,
estado vazio, arraste órfão e transbordo de texto para fora dos cards.

Estrutura: `src/core/` (estado, storage, migração — puro e testável em Node), `src/wa/`
(leitura do WhatsApp), `src/ui/` (Shadow DOM), `src/background/` (service worker),
`src/content/` (carregamento). O contrato de arquitetura está em `docs/ARCHITECTURE.md`.
