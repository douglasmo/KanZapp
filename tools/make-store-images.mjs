/**
 * Gera os recursos gráficos da Chrome Web Store / Edge Add-ons.
 *
 *     npm run store:images
 *
 * Saída em `dist/store/`, tudo em PNG de 24 bits SEM canal alfa — a loja recusa
 * o upload de PNG com transparência, com mensagem genérica.
 *
 * As cenas saem da bancada `tests/ui-harness.html?shot=…`, que usa 120 contatos
 * sintéticos. Nenhum recurso da loja pode sair com conversa real na tela.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRgbPng, inspect } from './png-rgb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'store');
const TMP = path.join(ROOT, 'dist', '.shots');
const PORT = 4732;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const SHOTS = [
  { file: '01-quadro.png', url: '/tests/ui-harness.html?shot=quadro', w: 1280, h: 800 },
  { file: '02-modelos.png', url: '/tests/ui-harness.html?shot=modelos', w: 1280, h: 800 },
  { file: '03-followups.png', url: '/tests/ui-harness.html?shot=followups', w: 1280, h: 800 },
  { file: '04-escuro.png', url: '/tests/ui-harness.html?shot=escuro', w: 1280, h: 800 },
  { file: '05-ajustes.png', url: '/tests/ui-harness.html?shot=ajustes', w: 1280, h: 800 },
  { file: 'promo-440x280.png', url: '/tools/promo.html?w=440&h=280', w: 440, h: 280 },
  { file: 'promo-1400x560.png', url: '/tools/promo.html?w=1400&h=560', w: 1400, h: 560 }
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH.');
  return found;
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('não encontrado');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function capture(chrome, shot, profileDir) {
  const raw = path.join(TMP, `raw-${shot.file}`);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-prefers-reduced-motion',
    '--no-sandbox',
    '--force-device-scale-factor=1',
    // fundo opaco: sem isto o Chrome pode compor sobre transparente
    '--default-background-color=ffffffff',
    `--user-data-dir=${profileDir}`,
    `--window-size=${shot.w},${shot.h}`,
    '--virtual-time-budget=7000',
    `--screenshot=${raw}`,
    `http://127.0.0.1:${PORT}${shot.url}`
  ], { stdio: 'ignore' });
  return raw;
}

async function main() {
  const chrome = findChrome();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const profileDir = path.join(TMP, 'perfil');

  const server = await serve();
  const problems = [];
  const rows = [];

  try {
    for (const shot of SHOTS) {
      const raw = capture(chrome, shot, profileDir);
      if (!fs.existsSync(raw)) { problems.push(`${shot.file}: captura não gerou arquivo`); continue; }

      const target = path.join(OUT, shot.file);
      toRgbPng(raw, target);
      const info = inspect(target);

      if (info.width !== shot.w || info.height !== shot.h) {
        problems.push(`${shot.file}: saiu ${info.width}x${info.height}, esperado ${shot.w}x${shot.h}`);
      }
      if (info.hasAlpha || info.colorType !== 2 || info.bitDepth !== 8) {
        problems.push(`${shot.file}: precisa ser PNG 24 bits sem alfa (color type 2)`);
      }
      rows.push({
        arquivo: shot.file,
        tamanho: `${info.width}x${info.height}`,
        tipo: `${info.bitDepth} bits, color type ${info.colorType}`,
        alfa: info.hasAlpha ? 'SIM' : 'não',
        kb: (fs.statSync(target).size / 1024).toFixed(0)
      });
    }
  } finally {
    server.close();
  }

  console.table(rows);
  if (problems.length) {
    console.error('\nProblemas:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${rows.length} imagens em dist/store/ — 24 bits, sem alfa, nos tamanhos exigidos.`);
}

main();
