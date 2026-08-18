# Textos da listagem — Chrome Web Store / Edge Add-ons

Copie e cole. A Web Store **não renderiza markdown**: o campo de descrição é texto puro, então os
marcadores abaixo são caracteres literais, de propósito.

---

## Resumo do pacote (limite 132 caracteres)

Organize suas conversas do WhatsApp Web em um funil Kanban: colunas, tags, notas e lembretes. Tudo salvo só no seu navegador.

---

## Descrição (limite 16.000 caracteres)

Cole daqui até o fim da seção.

---

KanZapp transforma a lista de conversas do WhatsApp Web em um quadro Kanban de verdade, para quem usa o chat como canal de vendas ou de atendimento e se perde na rolagem infinita.

Nada sai do seu computador: não há cadastro, login, servidor ou nuvem. Todo o seu funil fica salvo apenas no armazenamento local do navegador.

▸ O QUE ELE FAZ

• Funil visual — arraste cada conversa entre colunas como "Entrada", "Em atendimento", "Negociação" e "Concluído". Crie, renomeie, recolha, reordene e pinte as colunas do jeito que o seu processo pede.

• Limite de trabalho em andamento (WIP) — defina um teto por coluna e veja o destaque quando ela estourar.

• Tags coloridas — marque "VIP", "Lead frio", "Aguardando pagamento" e filtre o quadro por elas.

• Notas internas — registre o histórico de cada cliente em um campo privado, visível só para você.

• Modelos de mensagem — monte sua biblioteca de respostas prontas. Ao escolher um modelo, o texto é INSERIDO no campo de digitação do WhatsApp para você revisar e enviar. O KanZapp não envia mensagens sozinho e não faz disparo em massa.

• Lembretes de follow-up — agende o retorno de um cliente e receba a notificação na hora certa.

• Captura da lista — a lista lateral do WhatsApp carrega poucas conversas por vez. O botão "Capturar conversas" percorre a lista inteira uma vez e traz todo mundo para o quadro.

• Busca que entende o seu funil — procure por nome, prévia, nota ou tag, com prefixos como tag:vip, nota:orçamento e coluna:negociação.

• Filtros — só não lidas, esconder grupos, ver arquivados.

• Ações em lote — selecione vários cards e mova, marque ou arquive todos de uma vez.

• Desfazer — Ctrl+Z devolve o último movimento, marcação ou arquivamento.

• Arquivar — tire do quadro quem já não faz parte do funil, sem apagar nada. Dá para trazer de volta quando quiser.

• Backup — exporte e importe todo o seu CRM em um arquivo JSON, que fica sob o seu controle.

• Tema claro e escuro — acompanha o tema do WhatsApp Web automaticamente, com opção de fixar. Há também um modo compacto, para caber mais card na tela.

▸ ATALHOS DE TECLADO

Ctrl+Shift+K — abrir e fechar o quadro
/ — ir para a busca
Esc — fecha o que estiver por cima: diálogo, seleção, edição, busca e por fim o quadro
Espaço e setas — pegar e mover um card sem usar o mouse
Ctrl+Z — desfazer

▸ PRIVACIDADE

O KanZapp foi feito para não precisar de confiança cega:

• Não existe servidor. A extensão não envia absolutamente nada para a internet.
• Não há telemetria, analytics, publicidade nem rastreadores — nem em versão "anônima".
• Todo o código vem dentro do pacote instalado. Nada é baixado de fora depois da instalação.
• A extensão roda em um único site: web.whatsapp.com.
• Ela lê a lista lateral de conversas — nome, prévia e contador de não lidas — para montar os cards. Não lê o conteúdo das conversas abertas.

Como os dados ficam apenas no seu navegador, desinstalar a extensão apaga tudo. Use a exportação de backup antes, se quiser levar o funil para outro computador.

▸ QUANDO O WHATSAPP MUDA DE LAYOUT

O WhatsApp Web muda de estrutura sem aviso, e é isso que costuma quebrar extensões desse tipo. O KanZapp foi construído esperando por isso: em vez de depender de um seletor fixo, usa uma cadeia de estratégias com pontuação e refaz a detecção sozinho quando a leitura piora.

Se ainda assim a leitura degradar, a extensão avisa na hora — com um aviso no topo do quadro e um painel de Diagnóstico em Configurações — em vez de mostrar dados errados em silêncio. E o seu funil não se perde: se a leitura falhar, os cards já salvos continuam lá.

▸ AVISO

KanZapp é um projeto independente. Não é afiliado, associado, autorizado, patrocinado nem endossado pela WhatsApp LLC ou pela Meta Platforms, Inc. "WhatsApp" é marca registrada da WhatsApp LLC, citada aqui apenas para descrever com qual site a extensão funciona.

---

## Demais campos da página "Detalhes do app"

| Campo | O que preencher |
|---|---|
| **Categoria** | Fluxo de trabalho e planejamento |
| **Idioma** | Português (Brasil) |
| **Conteúdo adulto** | Não |
| **URL da página inicial** | opcional — o repositório serve, se for público |
| **URL do suporte** | **preencha.** É por onde chega o relato quando o WhatsApp mudar de layout. Um issues do GitHub ou um e-mail dedicado. Sem isso, a reclamação vira avaliação de 1 estrela sem informação nenhuma |
| **URL oficial** | deixe em branco, a menos que você verifique um domínio no Search Console |
| **Vídeo promocional** | opcional |

## Recursos gráficos que ainda faltam

| Item | Formato | Situação |
|---|---|---|
| Ícone da Store | 128×128 | ⚠️ o `assets/icon128.png` atual desenha um **H**, não a marca nova |
| Prints | 1280×800 ou 640×400, PNG 24 bits **sem canal alfa**, mínimo 1, máximo 5 | faltam |
| Bloco promocional pequeno | 440×280, sem alfa | opcional, melhora a posição na vitrine |
| Bloco de letreiro | 1400×560, sem alfa | só para destaque editorial |

Atenção ao **"sem alfa"**: PNG com transparência é recusado no upload.

Gere os prints a partir da bancada `tests/ui-harness.html`, que tem 120 contatos sintéticos —
nunca com conversa real na tela. Sequência sugerida: (1) o quadro cheio, (2) um card com tags,
nota e follow-up, (3) a captura de conversas em andamento, (4) modelos de mensagem, (5) tema
escuro.

## Na aba Privacidade

- **Finalidade única**: "Organizar as conversas do WhatsApp Web em um quadro Kanban para gestão de atendimento e vendas."
- **Justificativas de permissão**: prontas em `docs/PUBLICACAO.md` §2.2.
- **Uso de dados**: declare **sim** para "comunicações pessoais" e "conteúdo gerado pelo usuário", com processamento **local**. Marque **não** para venda ou transferência a terceiros, para uso alheio à funcionalidade principal e para avaliação de crédito. Dizer que não coleta nada seria incorreto — a extensão lê nomes de conversas — e é motivo de remoção quando detectado.
- **Política de privacidade**: exige URL pública. O texto está em `PRIVACY.md`, faltando o e-mail de contato.

## Instruções de teste (aba Acesso)

O revisor precisa de uma conta do WhatsApp para ver a extensão funcionando, e não vai criar uma.
Deixar isso explícito reduz idas e vindas na revisão:

---

A extensão funciona exclusivamente em https://web.whatsapp.com e exige uma sessão do WhatsApp conectada (leitura do QR code com um celular).

Sem conectar uma conta, é possível verificar que a extensão carrega e que a interface abre: acesse web.whatsapp.com, aguarde a página carregar e pressione Ctrl+Shift+K, ou clique no botão flutuante. O quadro abre com o estado vazio, e o painel de Diagnóstico (Configurações → Diagnóstico) mostra o que a extensão está conseguindo ler da página.

Não há login, cadastro ou servidor próprio. Nenhum dado é enviado para fora do navegador.
