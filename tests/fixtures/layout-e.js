// Fixture E — sem `role`, sem `data-id`, nome em `<span>` ANINHADO.
//
// Segundo furo apontado pela auditoria 01: as três fixtures originais tinham o
// nome como primeiro rótulo da linha. Aqui não há rótulo nenhum no nome — ele
// está três níveis abaixo, em texto — e ainda existem dois rótulos concorrentes
// por linha: um `title` na própria linha (que NÃO é decorativo, então não pode
// ser descartado por origem) e um botão de menu.

const CONTATOS = [
  { name: 'Amanda Rocha', time: '14:02', preview: 'Fechado para sexta', unread: 0 },
  { name: 'Benedito Alves', time: '13:40', preview: 'Vou ver e te falo', unread: 4 },
  { name: 'Consultoria Nordeste', time: '12:15', preview: 'Relatório enviado', unread: 0 },
  { name: 'Daniela Prado', time: 'ontem', preview: 'Muito obrigada!', unread: 2 },
  { name: 'Eduardo Bittencourt', time: 'ontem', preview: 'Chego às 9h', unread: 0 },
  { name: 'Fernanda Quintela', time: '10:30', preview: 'Pode ser amanhã?', unread: 1 },
  { name: 'Grupo Obra Centro', time: '09:55', preview: 'Ana: material chegou', unread: 11 },
  { name: 'Heloísa Sampaio', time: '21/02', preview: 'Segue anexo', unread: 0 },
  { name: 'Ivan Portela', time: '20/02', preview: 'Ok', unread: 0 },
  { name: 'Joana Medeiros', time: '19/02', preview: 'Perfeito', unread: 3 }
];

function mk(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') el.setAttribute('style', value);
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.appendChild(child);
  return el;
}

function linha(doc, contato) {
  const menu = mk(doc, 'button', {
    'aria-label': 'Menu de contexto da conversa',
    type: 'button',
    style: 'width:22px;height:22px;border:0;background:transparent;flex:0 0 auto;order:3'
  });

  const avatar = mk(doc, 'div', {
    style: 'width:46px;height:46px;border-radius:23px;background:#c3ccd1;flex:0 0 auto'
  });

  // nome três níveis abaixo, só texto
  const nome = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, [
    mk(doc, 'div', { style: 'min-width:0;overflow:hidden' }, [
      mk(doc, 'span', { style: 'font-size:15px;font-weight:600;color:#0f1b21' }, [doc.createTextNode(contato.name)])
    ]),
    mk(doc, 'span', { style: 'font-size:11px;color:#79878e' }, [doc.createTextNode(contato.time)])
  ]);

  const previa = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
    mk(doc, 'span', { style: 'font-size:13px;color:#5e6c73' }, [doc.createTextNode(contato.preview)]),
    contato.unread
      ? mk(doc, 'span', {
        style:
          'width:20px;height:20px;border-radius:10px;background:#0a8;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center'
      }, [doc.createTextNode(String(contato.unread))])
      : null
  ]);

  // rótulo concorrente na PRÓPRIA linha: não é botão nem ícone, então só a
  // pontuação (não corresponde a texto visível) pode derrubá-lo
  return mk(doc, 'div', {
    title: `Conversa com ${contato.name}`,
    style: 'height:74px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid #eef1f2;background:#fff'
  }, [avatar, mk(doc, 'div', { style: 'flex:1;min-width:0' }, [nome, previa]), menu]);
}

export const layoutE = {
  id: 'layout-e',
  title: 'Layout E — nome em span aninhado, sem role/data-id',
  description: 'nenhum rótulo no nome; um title concorrente na linha e um botão de menu por linha',
  expected: CONTATOS.map((c) => ({ name: c.name, unread: c.unread, preview: c.preview })),
  /** @param {Document} doc */
  build(doc) {
    const lista = mk(doc, 'div', { style: 'height:100%;overflow-y:auto;background:#fff' });
    CONTATOS.forEach((contato) => lista.appendChild(linha(doc, contato)));
    return mk(doc, 'div', { style: 'height:100%;display:flex;flex-direction:column' }, [
      mk(doc, 'div', { style: 'height:52px;background:#f3f5f6;flex:0 0 auto' }),
      lista
    ]);
  }
};

export default layoutE;
