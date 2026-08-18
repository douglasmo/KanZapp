// Fixture A — markup "atual" do WhatsApp Web:
// #pane-side + div[role="row"] + span[title] + data-id="...@c.us".
// Construido com createElement (nada de innerHTML, nem aqui).

const CONTATOS = [
  { jid: '5511999990001@c.us', name: 'João Silva', time: '10:03', preview: 'Oi, tudo bem?', unread: 3 },
  { jid: '5511999990002@c.us', name: 'Maria Fernanda', time: '09:47', preview: 'Vou confirmar o pedido', unread: 0 },
  { jid: '5511999990003@c.us', name: 'Carlos Eduardo Souza', time: 'ontem', preview: 'Obrigado!', unread: 1 },
  { jid: '120363000000000001@g.us', name: 'Equipe Comercial', time: 'ontem', preview: 'Ana: fechamos o mês', unread: 12 },
  { jid: '5511999990005@c.us', name: 'Beatriz Antunes', time: '08:15', preview: 'Documento recebido', unread: 0 },
  { jid: '5511999990006@c.us', name: 'Fornecedor ACME', time: '12/03', preview: 'Segue a nota fiscal', unread: 0 },
  { jid: '5511999990007@c.us', name: 'Dra. Helena Prado', time: '11:22', preview: 'Podemos remarcar?', unread: 2 },
  { jid: '5511999990008@c.us', name: 'Rafael', time: '07:05', preview: 'Bom dia', unread: 0 },
  { jid: '5511999990009@c.us', name: 'Loja Centro — Suporte', time: '15/02', preview: 'Chamado encerrado', unread: 0 },
  { jid: '5511999990010@c.us', name: 'Patrícia Nogueira', time: '16:40', preview: 'Combinado então', unread: 5 }
];

const AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="49" height="49"><circle cx="24" cy="24" r="24" fill="#d1d7db"/></svg>');

function mk(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') el.setAttribute('style', value);
    else if (key === 'text') el.appendChild(doc.createTextNode(value));
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.appendChild(child);
  return el;
}

function linha(doc, contato) {
  const avatar = mk(doc, 'div', { style: 'width:49px;height:49px;border-radius:50%;overflow:hidden;flex:0 0 auto' }, [
    mk(doc, 'img', { src: AVATAR, alt: '', style: 'width:49px;height:49px' })
  ]);

  const linha1 = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:8px' }, [
    mk(doc, 'span', { title: contato.name, dir: 'auto', style: 'font-weight:500;color:#111b21' }, [
      doc.createTextNode(contato.name)
    ]),
    mk(doc, 'span', { style: 'font-size:12px;color:#667781' }, [doc.createTextNode(contato.time)])
  ]);

  const badge = contato.unread
    ? mk(
        doc,
        'span',
        {
          'aria-label': `${contato.unread} mensagens não lidas`,
          style:
            'min-width:20px;height:20px;border-radius:10px;background:#25d366;color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center'
        },
        [doc.createTextNode(String(contato.unread))]
      )
    : null;

  const linha2 = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
    mk(doc, 'span', { title: contato.preview, style: 'font-size:14px;color:#667781' }, [
      doc.createTextNode(contato.preview)
    ]),
    badge
  ]);

  const celula = mk(doc, 'div', { role: 'gridcell', style: 'display:flex;gap:12px;align-items:center;width:100%;padding:0 12px' }, [
    avatar,
    mk(doc, 'div', { style: 'flex:1;min-width:0' }, [linha1, linha2])
  ]);

  return mk(
    doc,
    'div',
    {
      role: 'row',
      'data-id': contato.jid,
      tabindex: '-1',
      style: 'height:72px;display:flex;align-items:center;border-bottom:1px solid #e9edef;background:#fff'
    },
    [celula]
  );
}

export const layoutA = {
  id: 'layout-a',
  title: 'Layout A — markup atual',
  description: '#pane-side + div[role="row"] + span[title] + data-id JID',
  expected: CONTATOS.map((c) => ({ id: c.jid, name: c.name, unread: c.unread, preview: c.preview })),
  /** @param {Document} doc @param {{repeat?: number}} [options] */
  build(doc, options = {}) {
    const repeat = Math.max(1, options.repeat || 1);
    const pane = mk(doc, 'div', {
      id: 'pane-side',
      style: 'height:100%;overflow-y:auto;background:#fff'
    });
    for (let r = 0; r < repeat; r += 1) {
      CONTATOS.forEach((contato, i) => {
        // na medição de performance os contatos são multiplicados; nomes
        // precisam continuar distintos, senão a repetição vira sinal de
        // rótulo envenenado para o adapter (e é artefato da fixture)
        const clone = repeat > 1
          ? { ...contato, jid: `55110000${r}${i}@c.us`, name: `${contato.name} ${r + 1}` }
          : contato;
        pane.appendChild(linha(doc, clone));
      });
    }
    return pane;
  }
};

export default layoutA;
