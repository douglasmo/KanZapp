// Fixture B — markup MUTADO. Nada em comum com o A a não ser ser uma lista:
// sem #pane-side, sem role, sem title, sem data-id, classes ofuscadas outras,
// nome só em aria-label, badge de não lidas com rótulo textual diferente,
// avatar por background-image (sem <img>), ordem visual invertida
// (prévia acima do nome).

const CONTATOS = [
  { name: 'Luciana Prates', time: '11:58', preview: 'Pode me mandar o contrato?', unread: 4 },
  { name: 'Vinícius Almeida', time: '11:20', preview: 'Já transferi', unread: 0 },
  { name: 'Studio Vega', time: '10:02', preview: 'Reunião confirmada', unread: 1 },
  { name: 'Roberta Lins', time: 'ontem', preview: 'Vou avaliar e retorno', unread: 0 },
  { name: 'Grupo Financeiro', time: 'ontem', preview: 'Paulo: fechado', unread: 27 },
  { name: 'Marcos Vinicius de Oliveira', time: '09:41', preview: 'Beleza!', unread: 0 },
  { name: 'Clínica Bem Estar', time: '08:03', preview: 'Sua consulta é amanhã', unread: 2 },
  { name: 'Ed', time: '22/02', preview: 'valeu', unread: 0 },
  { name: 'Transportadora Rio Norte', time: '18/02', preview: 'Coleta agendada', unread: 0 },
  { name: 'Sofia Rezende', time: '07:12', preview: 'Bom dia! Tudo certo?', unread: 9 }
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

function linha(doc, contato, index) {
  const avatar = mk(doc, 'div', {
    class: 'xq7f2 _b91k',
    style:
      'width:52px;height:52px;border-radius:26px;flex:0 0 auto;background-image:url("data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");background-color:#c8d1d6'
  });

  // prévia PRIMEIRO, nome depois: a ordem visual não é a mesma do layout A
  const previa = mk(doc, 'div', { class: 'x0op1', style: 'font-size:13px;color:#5b6a72;order:2' }, [
    doc.createTextNode(contato.preview)
  ]);

  const nome = mk(
    doc,
    'div',
    { class: 'x0op1 _nm', 'aria-label': contato.name, style: 'font-size:15px;color:#0b1418;order:1;font-weight:600' },
    [doc.createTextNode(contato.name)]
  );

  const meta = mk(doc, 'div', { class: 'x7ttq', style: 'display:flex;flex-direction:column;align-items:flex-end;gap:4px' }, [
    mk(doc, 'div', { class: 'x1tt', style: 'font-size:11px;color:#7a8b93' }, [doc.createTextNode(contato.time)]),
    contato.unread
      ? mk(
          doc,
          'div',
          {
            class: 'x9bdg',
            // formato de rótulo diferente do layout A
            'aria-label': `não lidas: ${contato.unread}`,
            style:
              'min-width:22px;height:22px;border-radius:11px;background:#0aa;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center'
          },
          [doc.createTextNode(String(contato.unread))]
        )
      : null
  ]);

  return mk(
    doc,
    'div',
    {
      class: `xr0w _l${index} x1n2onr6`,
      tabindex: '0',
      style: 'height:76px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid #eceff1;background:#fff'
    },
    [
      avatar,
      mk(doc, 'div', { class: 'xcol', style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, [previa, nome]),
      meta
    ]
  );
}

export const layoutB = {
  id: 'layout-b',
  title: 'Layout B — markup mutado',
  description: 'sem #pane-side/role/title/data-id; nome em aria-label; badge com rótulo textual diferente',
  expected: CONTATOS.map((c) => ({ name: c.name, unread: c.unread, preview: c.preview })),
  /** @param {Document} doc */
  build(doc) {
    const lista = mk(doc, 'div', {
      class: 'x8lst _ak00 xzz1',
      'aria-label': 'Conversas',
      style: 'height:100%;overflow-y:scroll;background:#fff'
    });
    CONTATOS.forEach((contato, index) => lista.appendChild(linha(doc, contato, index)));
    // wrapper extra: o painel real fica um nível abaixo de um container maior
    return mk(doc, 'div', { class: 'xwrap', style: 'height:100%;display:flex;flex-direction:column' }, [
      mk(doc, 'div', { class: 'xhdr', style: 'height:56px;background:#f4f6f7;flex:0 0 auto' }),
      lista
    ]);
  }
};

export default layoutB;
