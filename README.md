# WhatsApp Web Kanban 📊

Transforme seu WhatsApp Web em uma ferramenta de produtividade poderosa com um quadro Kanban integrado. Organize suas conversas por colunas, adicione tags coloridas e envie mensagens rápidas com apenas alguns cliques.

## 🚀 Funcionalidades

- **Quadro Kanban Integrado**: Visualize suas conversas como cards em um quadro organizado.
- **Arrastar e Soltar**: Mova conversas entre colunas para gerenciar o status do atendimento.
- **Gerenciamento de Colunas**: Crie, edite e exclua colunas personalizadas. Por padrão, inclui: "Entrada / A Fazer", "Em Andamento" e "Concluído".
- **Sistema de Tags**: 
  - Crie tags personalizadas com cores escolhidas por você.
  - Atribua múltiplas tags a cada contato.
  - Visualize as tags como pontos coloridos nos cards.
- **Agendamento de Follow-up 🔔**:
  - Clique no ícone de sininho para agendar um lembrete.
  - **Títulos Personalizados**: Adicione um motivo ao agendamento (ex: "Enviar contrato").
  - **Destaque Visual**: Cards com agendamentos ativos exibem o sininho em um círculo laranja vibrante.
  - **Visão Geral**: Botão "Agendamentos" no cabeçalho para ver todos os lembretes futuros em uma lista organizada, com fotos e nomes.
  - Receba uma notificação do sistema (Chrome) e um Toast no navegador na data e hora definida.
- **Mensagens Rápidas (Quick Messages)**:
  - Crie modelos de mensagens predefinidas (com suporte a múltiplas linhas).
  - Envie mensagens em segundos: ao selecionar uma mensagem, o Kanban minimiza, abre o chat do contato e cola o texto automaticamente.
- **Filtro de Pesquisa**: Encontre contatos rapidamente dentro do quadro Kanban.
- **Interface em Português (PT-BR)**: Totalmente traduzido para uma melhor experiência.
- **Persistência de Dados**: Todas as suas configurações, colunas, tags e posições dos cards são salvas localmente no seu navegador.

## 🛠️ Tecnologias Utilizadas

- **JavaScript (ES6+)**: Lógica principal e manipulação de DOM.
- **CSS3**: Estilização do quadro, cards e modais.
- **Chrome Extension API (Manifest V3)**:
  - `storage`: Para salvar as configurações do usuário.
  - `content_scripts`: Para injetar o Kanban diretamente no WhatsApp Web.
  - `background`: Para gerenciar o ícone da extensão.

## 📥 Como Instalar

Como esta é uma extensão em desenvolvimento, você deve instalá-la via "Modo do Desenvolvedor":

1.  Faça o download ou clone este repositório.
2.  Abra o Google Chrome e acesse `chrome://extensions/`.
3.  No canto superior direito, ative o **"Modo do desenvolvedor"**.
4.  Clique no botão **"Carregar sem compactação"**.
5.  Selecione a pasta raiz do projeto (onde está o arquivo `manifest.json`).
6.  Acesse o [WhatsApp Web](https://web.whatsapp.com) e o ícone da extensão (📊) aparecerá na barra lateral ou como um botão flutuante.

## 📖 Como Usar

1.  **Abrir o Kanban**: Clique no ícone de gráfico de barras (📊) no cabeçalho da lista de conversas do WhatsApp.
2.  **Organizar**: Arraste os cards de conversa para as colunas desejadas.
3.  **Tags**: Clique no ícone de etiqueta (🏷️) em um card para gerenciar as tags daquele contato. Use o botão "Tags" no topo para criar novas cores e nomes.
4.  **Mensagens**: Clique no botão "Mensagens" no topo para criar seus modelos. No card do contato, clique no ícone de balão (💬) para escolher e enviar uma mensagem.
5.  **Atualizar**: Se novas conversas chegarem, clique no botão "Atualizar" para sincronizar o Kanban com a lista do WhatsApp.

## ⚠️ Observações Importantes

- Esta extensão realiza **web scraping** do WhatsApp Web. Mudanças na interface oficial do WhatsApp podem exigir atualizações nesta extensão.
- A extensão não envia mensagens automaticamente (pressionando Enter), ela apenas **cola** o texto no campo de mensagem para que você possa revisar antes de enviar.
- O contato precisa estar visível na lista lateral do WhatsApp para que o Kanban consiga abrir o chat corretamente.

---
Desenvolvido para fins de produtividade e organização. 🚀

