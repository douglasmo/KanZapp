// Fixture C — markup DEGRADADO: só divs aninhados com texto.
// Sem id, sem role, sem aria-*, sem title, sem data-id, sem <img>.
// É o pior caso: só sobram sinais estruturais (elemento rolável, alto, à
// esquerda, com filhos irmãos de altura parecida) e a ordem do texto.

const CONTATOS = [
  { name: 'Anderson Peixoto', time: '13:44', preview: 'Recebido, obrigado', unread: 0 },
  { name: 'Camila Duarte', time: '13:01', preview: 'Me liga quando puder', unread: 2 },
  { name: 'Escritório Andrade', time: '12:30', preview: 'Enviamos por e-mail', unread: 0 },
  { name: 'Fabio Ramos', time: 'ontem', preview: 'Ok', unread: 0 },
  { name: 'Gisele Monteiro', time: 'ontem', preview: 'Adorei a proposta', unread: 6 },
  { name: 'Henrique Vasconcelos', time: '10:10', preview: 'Chego às 15h', unread: 0 },
  { name: 'Ivone Barbosa', time: '09:33', preview: 'Bom dia', unread: 1 },
  { name: 'Juliana Ferraz', time: '21/02', preview: 'Segue anexo', unread: 0 },
  { name: 'Kleber Nunes', time: '20/02', preview: 'Combinamos amanhã', unread: 0 },
  { name: 'Larissa Coutinho', time: '19/02', preview: 'Perfeito!', unread: 3 }
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

function texto(doc, value, style) {
  return mk(doc, 'div', { style }, [doc.createTextNode(value)]);
}

function linha(doc, contato) {
  const iniciais = contato.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // o "avatar" é só texto com as iniciais — armadilha clássica para o extrator
  const avatar = mk(
    doc,
    'div',
    {
      style:
        'width:48px;height:48px;border-radius:24px;background:#b9c4ca;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto'
    },
    [doc.createTextNode(iniciais)]
  );

  const corpo = mk(doc, 'div', { style: 'flex:1;min-width:0' }, [
    mk(doc, 'div', { style: 'display:flex;justify-content:space-between' }, [
      texto(doc, contato.name, 'font-size:15px;color:#101c22;font-weight:600'),
      texto(doc, contato.time, 'font-size:11px;color:#78878e')
    ]),
    mk(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      texto(doc, contato.preview, 'font-size:13px;color:#5d6b72'),
      contato.unread
        ? texto(
            doc,
            String(contato.unread),
            'width:20px;height:20px;border-radius:10px;background:#0a8;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center'
          )
        : null
    ])
  ]);

  return mk(
    doc,
    'div',
    { style: 'height:70px;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid #edf1f2;background:#fff' },
    [avatar, corpo]
  );
}

export const layoutC = {
  id: 'layout-c',
  title: 'Layout C — degradado',
  description: 'apenas divs aninhados com texto: sem id, role, aria, title, data-id ou img',
  expected: CONTATOS.map((c) => ({ name: c.name, unread: c.unread, preview: c.preview })),
  /** @param {Document} doc */
  build(doc) {
    const lista = mk(doc, 'div', { style: 'height:100%;overflow-y:auto;background:#fff' });
    CONTATOS.forEach((contato) => lista.appendChild(linha(doc, contato)));
    return lista;
  }
};

export default layoutC;
