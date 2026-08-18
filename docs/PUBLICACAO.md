# Publicação na Chrome Web Store e no Edge Add-ons

Estado atual, o que falta, e os riscos reais. Ordenado por: **o que pode barrar a publicação**
primeiro, depois o que é trabalho mecânico.

---

## 1. Riscos que você precisa decidir ANTES de investir mais

### 1.1 O nome cita uma marca da Meta — risco alto de exigência de mudança

`"KanZapp — CRM Kanban para WhatsApp"`. As duas lojas proíbem usar marca de terceiro de um jeito
que sugira afiliação, e a Meta é ativa na defesa de "WhatsApp" e do sufixo "Zapp"/"Zap".
Extensões parecidas são publicadas o tempo todo, mas rejeição e pedido de renomeação também
acontecem, e a rejeição vem **depois** de você já ter montado a listagem inteira.

Redução de risco, em ordem de eficácia:

1. Nome da loja **sem** a marca: `KanZapp — CRM Kanban` ou `KanZapp — Funil de vendas`.
2. Descrição usando forma **descritiva**, não possessiva: "funciona com o WhatsApp Web",
   nunca "CRM do WhatsApp" / "WhatsApp CRM".
3. Disclaimer de não-afiliação na descrição da loja **e** na política de privacidade (já está
   em `PRIVACY.md`).
4. Nada de usar o logo, o verde-assinatura ou o balão do WhatsApp nos ícones e screenshots.

**Decisão sua.** Se aceitar o risco do nome atual, ao menos aplique os itens 2–4.

### 1.2 Os Termos de Uso do WhatsApp — o risco de produto, não de loja

Os ToS do WhatsApp proíbem uso automatizado e acesso não autorizado ao serviço. Ferramentas de
**disparo em massa** são o alvo preferencial de banimento de conta. O KanZapp hoje está do lado
seguro dessa linha por uma escolha de projeto: modelos são **inseridos no campo de digitação**
para revisão humana, e não existe envio automático nem em massa.

**Recomendação forte para "duradouro": mantenha assim.** Um botão de "enviar para todos" mudaria
a categoria do produto de organizador para automação, e passaria a expor o **usuário** a
banimento — além de atrair escrutínio das lojas. Se um dia quiser disparo, isso é a API oficial
do WhatsApp Business, não raspagem de DOM.

### 1.3 Conta de desenvolvedor

- Chrome Web Store: taxa única de US$ 5, paga uma vez por conta.
- Edge Add-ons: gratuito, exige conta Microsoft Partner Center.
- Ambas: verificação de identidade e prazo de revisão variável (dias a semanas na primeira
  submissão; extensões que pedem host permission costumam demorar mais).

Só você pode fazer estas etapas.

---

## 2. Bloqueadores concretos

### 2.1 Política de privacidade hospedada — obrigatório

As duas lojas exigem **URL pública**, não arquivo no pacote. Já escrevi o texto em `PRIVACY.md`;
falta: revisar, preencher o e-mail de contato e publicar (GitHub Pages resolve em minutos).

Na Chrome Web Store você também preenche o formulário de **divulgação de uso de dados**. As
respostas corretas para o KanZapp hoje:

- coleta dados pessoais? **Sim** — "comunicações pessoais" (nomes de conversa e prévias) e
  "conteúdo do usuário" (notas), mas **processados localmente**;
- vende ou transfere a terceiros? **Não**;
- usa para propósito não relacionado à funcionalidade principal? **Não**;
- usa para avaliar crédito ou solvência? **Não**.

Marcar "não coleta nada" seria incorreto e é motivo de remoção quando detectado — a extensão lê
nomes de conversas, ainda que nunca os envie. Declare o processamento local com honestidade;
isso não impede a publicação.

### 2.2 Justificativa de cada permissão — campo obrigatório

Textos prontos para colar (a tabela completa está em `PRIVACY.md`):

- **`storage`** — armazenar localmente o funil, tags, notas e modelos criados pelo usuário.
- **`alarms`** — disparar no horário certo os lembretes de follow-up agendados pelo usuário.
- **`notifications`** — exibir esses lembretes.
- **`host_permissions: https://web.whatsapp.com/*`** — a extensão só funciona nesse site; precisa
  ler a lista de conversas para montar o quadro e abrir a conversa escolhida.
- **Justificativa de código remoto** — "nenhum. Todo o código está no pacote."

### 2.3 Materiais da listagem

| Item | Exigência | Estado |
|---|---|---|
| Ícone da loja | 128×128 PNG | ✅ `assets/icon128.png` |
| Screenshots | 1280×800 ou 640×400, mínimo 1, ideal 4–5 | ❌ faltam |
| Tile promocional pequeno | 440×280 | ❌ falta |
| Descrição curta | até 132 caracteres | ⚠️ revisar sob §1.1 |
| Descrição completa | até 16.000 caracteres | ❌ falta |
| Categoria | Produtividade | — |
| Idioma | pt-BR | — |

Os screenshots devem sair de dados **fictícios** — não publique print com nome, telefone ou
mensagem de cliente real. A bancada `tests/ui-harness.html` já gera 120 contatos sintéticos e
serve exatamente para isso.

---

## 3. Ajustes técnicos pendentes no pacote

Nenhum é bloqueador, todos são baratos:

1. **`web_accessible_resources` está largo demais.** Hoje expõe `src/*`, o que inclui
   `src/background/index.js`, que nunca é buscado pela página. Restringir a
   `src/content/*`, `src/core/*`, `src/ui/*`, `src/wa/*`. Avaliar também `use_dynamic_url: true`,
   que impede o site de fingerprintar a extensão por URL fixa.
2. **Faltam `minimum_chrome_version`** (o import dinâmico em content script e
   `adoptedStyleSheets` pedem um piso; fixar evita instalação em navegador onde quebraria) e,
   opcionalmente, `homepage_url` e `author`.
3. **Falta script de empacotamento.** O zip enviado não pode conter `docs/`, `tests/`,
   `.claude/`, `.git/` nem `package.json` de desenvolvimento. Um `npm run pack` que monte o zip
   só com `manifest.json`, `src/`, `assets/` evita enviar lixo — e evita o erro clássico de
   zipar a pasta em vez do conteúdo.
4. **Falta `LICENSE`.** Não é exigência de loja, mas é decisão sua se o repositório é público.
5. **Versionamento.** Cada submissão precisa de `version` maior que a anterior. Combine agora um
   esquema (sugestão: `2.1.0` para a leva de usabilidade, `2.1.1` para correções).

---

## 4. Durabilidade — o que faz a extensão sobreviver depois de publicada

Publicar é o começo do problema, não o fim: quando o WhatsApp mudar o layout, o usuário reclama
na avaliação da loja, não para você.

O que o projeto já tem a favor: estratégias pontuadas com re-probe automático, confiança medida
por **qualidade da extração** (nomes duplicados derrubam a confiança), banner explícito quando a
leitura degrada, painel de diagnóstico, e cinco fixtures de layout no CI local.

O que ainda falta para "duradouro" de verdade:

1. **Um caminho de suporte visível.** O painel de Diagnóstico deve ter um botão "Copiar
   diagnóstico" que põe no clipboard um texto sem dado pessoal (estratégia, confiança, qualidade,
   contagem de linhas, versão) — para o usuário colar num e-mail ou issue em vez de escrever
   "parou de funcionar". Sem isso, cada quebra vira uma avaliação de 1 estrela sem informação.
2. **Nunca perder dado numa quebra.** Já é o caso (`syncContacts` não apaga ausentes), mas vale
   um teste explícito: adapter retornando zero conversas **não** pode esvaziar o quadro salvo.
3. **Backup fácil de achar.** Export/import existe; deve estar visível, não escondido em
   Configurações, e vale sugerir backup periódico.
4. **Rotina de revalidação.** As fixtures A–E são hipóteses de hoje. Quando o WhatsApp mudar,
   a correção é adicionar a fixture nova e ajustar a pontuação — mantenha esse fluxo documentado
   no README para você mesmo daqui a seis meses.

---

## 5. Ordem sugerida

1. Decidir o nome (§1.1) — afeta ícone, screenshots e descrição, então vem antes de produzi-los.
2. Terminar a leva de usabilidade que está em andamento.
3. Ajustes técnicos do §3 (rápidos).
4. Hospedar a política de privacidade e preencher a divulgação de dados.
5. Gerar screenshots com os dados sintéticos da bancada.
6. Submeter primeiro no **Edge** (revisão costuma ser mais rápida e serve de ensaio), depois no
   Chrome.
