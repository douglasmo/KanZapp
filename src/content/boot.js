// Content script classico. Content scripts MV3 nao aceitam ESM direto, entao
// este arquivo so faz o import() dinamico do app real (contrato, secao 2).
(function bootKanZapp() {
  // guarda contra dupla injecao (navegacao SPA / reload da extensao)
  if (window.__kanzappBooted) return;
  window.__kanzappBooted = true;

  let url = '';
  try {
    url = chrome.runtime.getURL('src/content/app.js');
  } catch (error) {
    console.error('[KanZapp] contexto da extensão indisponível:', error);
    return;
  }

  import(url).catch((error) => {
    console.error(
      '[KanZapp] falha ao carregar src/content/app.js. ' +
        'Confira "web_accessible_resources" no manifest e recarregue a extensão.',
      error
    );
  });
})();
