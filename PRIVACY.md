# Política de Privacidade — KanZapp

**Última atualização:** 16 de agosto de 2026
**Versão da extensão:** 2.x

> ⚠️ **Antes de publicar:** revise este texto, substitua `SEU-EMAIL-DE-CONTATO` por um endereço
> real e hospede o documento em uma URL pública (GitHub Pages serve). As duas lojas exigem um
> link acessível — não aceitam um arquivo dentro do pacote.

## Resumo

O KanZapp funciona inteiramente dentro do seu navegador. **Nós não temos servidores, não
recebemos nenhum dado seu e não conseguimos ver nada do que você faz na extensão.** Não há
cadastro, login, telemetria, analytics nem qualquer envio para a internet.

## Que dados a extensão acessa

Para montar o quadro Kanban, o KanZapp lê da página do WhatsApp Web que já está aberta no seu
navegador:

- nome ou número exibido de cada conversa da lista lateral;
- a prévia da última mensagem, como já aparece na lista;
- a contagem de mensagens não lidas;
- a URL da foto de perfil, quando exibida;
- o horário exibido na conversa.

Além disso, a extensão guarda o que **você** cria: colunas do funil, posição de cada contato,
tags, notas internas, modelos de mensagem e lembretes de follow-up.

## Onde esses dados ficam

Exclusivamente em `chrome.storage.local`, que é uma área de armazenamento **do seu próprio
navegador, no seu computador**. Os dados não saem da máquina. Não há sincronização com nuvem,
nem nossa nem de terceiros.

Consequências práticas:

- quem tiver acesso ao seu perfil do navegador tem acesso aos dados do KanZapp;
- desinstalar a extensão apaga os dados;
- para levar os dados para outro computador, use **Configurações → Exportar backup**, que gera
  um arquivo JSON que fica sob seu controle.

## O que a extensão NÃO faz

- Não envia dados para nenhum servidor, nosso ou de terceiros.
- Não coleta estatísticas de uso, nem anônimas.
- Não carrega código de fora do pacote instalado (sem CDN, sem `eval`).
- Não lê o conteúdo das conversas abertas — apenas a lista lateral.
- Não envia mensagens sozinha: modelos são **inseridos no campo de digitação** para você revisar
  e enviar.
- Não faz envio em massa nem disparo automatizado.

## Permissões e por que cada uma existe

| Permissão | Para quê |
|---|---|
| `storage` | Guardar seu funil, tags, notas e modelos no seu navegador. |
| `alarms` | Disparar o lembrete de follow-up no horário que você agendou. |
| `notifications` | Exibir esse lembrete como notificação do sistema. |
| `https://web.whatsapp.com/*` | Ler a lista de conversas e abrir a conversa que você clicar. É o único site em que a extensão roda. |

## Serviços de terceiros

Nenhum. A extensão não integra analytics, publicidade, rastreadores ou SDKs externos.

## Crianças

O KanZapp é uma ferramenta de trabalho e não se destina a menores de 13 anos. Como não coletamos
dado algum, não há informação de menores em nosso poder.

## Alterações nesta política

Mudanças serão publicadas nesta página com nova data de atualização. Se alguma versão futura
passar a enviar dados para fora do seu navegador — o que não está planejado — isso será
comunicado de forma destacada e dependerá do seu consentimento explícito.

## Contato

Dúvidas sobre privacidade: `SEU-EMAIL-DE-CONTATO`

## Aviso de marcas

KanZapp é um projeto independente. **Não é afiliado, associado, autorizado, patrocinado nem
endossado pela WhatsApp LLC ou pela Meta Platforms, Inc.** "WhatsApp" é marca registrada da
WhatsApp LLC e é citada aqui apenas para descrever com qual site a extensão funciona.
