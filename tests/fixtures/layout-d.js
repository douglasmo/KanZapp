// Fixture D — layout A com CONTROLES ANTES DO NOME.
//
// É o markup que reprovou a auditoria 01 (achado #1): um
// `<button aria-label="Menu de contexto da conversa">` como primeiro filho da
// linha fazia 100% dos contatos serem gravados com o nome do botão. Aqui os
// controles vêm de propósito antes do nome, e ainda há um segundo rótulo
// concorrente ("Selecionar conversa") e um `aria-label` genérico no avatar.

const CONTATOS = [
  { jid: '5511988880001@c.us', name: 'Adriana Peçanha', time: '10:03', preview: 'Bom dia, recebeu o orçamento?', unread: 3 },
  { jid: '5511988880002@c.us', name: 'Bruno Tavares', time: '09:47', preview: 'Confirmo até as 14h', unread: 0 },
  { jid: '5511988880003@c.us', name: 'Célia Marques', time: 'ontem', preview: 'Obrigada pelo retorno', unread: 1 },
  { jid: '120363000000000009@g.us', name: 'Equipe Suporte', time: 'ontem', preview: 'Léo: chamado fechado', unread: 8 },
  { jid: '5511988880005@c.us', name: 'Diego Ramalho', time: '08:15', preview: 'Segue o comprovante', unread: 0 },
  { jid: '5511988880006@c.us', name: 'Editora Farol', time: '12/03', preview: 'Contrato assinado', unread: 0 },
  { jid: '5511988880007@c.us', name: 'Dr. Fernando Aguiar', time: '11:22', preview: 'Podemos remarcar?', unread: 2 },
  { jid: '5511988880008@c.us', name: 'Gustavo', time: '07:05', preview: 'Bom dia', unread: 0 },
  { jid: '5511988880009@c.us', name: 'Helena Vasques', time: '15/02', preview: 'Perfeito, combinado', unread: 0 },
  { jid: '5511988880010@c.us', name: 'Ismael Furtado', time: '16:40', preview: 'Depois te ligo', unread: 5 }
];

const AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="49" height="49"><circle cx="24" cy="24" r="24" fill="#cfd8dc"/></svg>');

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
  // 1) botão de menu de contexto — PRIMEIRO filho da linha
  const menu = mk(doc, 'button', {
    'aria-label': 'Menu de contexto da conversa',
    type: 'button',
    style: 'width:24px;height:24px;border:0;background:transparent;flex:0 0 auto'
  });

  // 2) caixa de seleção — segundo rótulo concorrente
  const selecionar = mk(doc, 'div', {
    role: 'button',
    'aria-label': 'Selecionar conversa',
    style: 'width:20px;height:20px;flex:0 0 auto'
  });

  const avatar = mk(doc, 'div', {
    role: 'img',
    'aria-label': 'Foto do perfil',
    style: 'width:49px;height:49px;border-radius:50%;overflow:hidden;flex:0 0 auto'
  }, [mk(doc, 'img', { src: AVATAR, alt: '', style: 'width:49px;height:49px' })]);

  const linha1 = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:8px' }, [
    mk(doc, 'span', { title: contato.name, dir: 'auto', style: 'font-weight:500;color:#111b21' }, [
      doc.createTextNode(contato.name)
    ]),
    mk(doc, 'span', { style: 'font-size:12px;color:#667781' }, [doc.createTextNode(contato.time)])
  ]);

  const badge = contato.unread
    ? mk(doc, 'span', {
      'aria-label': `${contato.unread} mensagens não lidas`,
      style:
        'min-width:20px;height:20px;border-radius:10px;background:#25d366;color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center'
    }, [doc.createTextNode(String(contato.unread))])
    : null;

  const linha2 = mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
    mk(doc, 'span', { style: 'font-size:14px;color:#667781' }, [doc.createTextNode(contato.preview)]),
    badge
  ]);

  const celula = mk(doc, 'div', {
    role: 'gridcell',
    style: 'display:flex;gap:10px;align-items:center;width:100%;padding:0 12px'
  }, [menu, selecionar, avatar, mk(doc, 'div', { style: 'flex:1;min-width:0' }, [linha1, linha2])]);

  return mk(doc, 'div', {
    role: 'row',
    'data-id': contato.jid,
    tabindex: '-1',
    style: 'height:72px;display:flex;align-items:center;border-bottom:1px solid #e9edef;background:#fff'
  }, [celula]);
}

export const layoutD = {
  id: 'layout-d',
  title: 'Layout D — controles antes do nome',
  description: 'como o A, mas com button[aria-label="Menu de contexto da conversa"] e "Selecionar conversa" antes do nome',
  expected: CONTATOS.map((c) => ({ id: c.jid, name: c.name, unread: c.unread, preview: c.preview })),
  /** @param {Document} doc */
  build(doc) {
    const pane = mk(doc, 'div', { id: 'pane-side', style: 'height:100%;overflow-y:auto;background:#fff' });
    CONTATOS.forEach((contato) => pane.appendChild(linha(doc, contato)));
    return pane;
  }
};

export default layoutD;
