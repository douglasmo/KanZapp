/**
 * Empacota a extensão para submissão na Chrome Web Store / Edge Add-ons.
 *
 *     npm run pack
 *
 * Monta uma cópia limpa em `dist/kanzapp-<versão>/` contendo APENAS o que a
 * extensão precisa em runtime, e zipa a partir de dentro dessa pasta — as
 * lojas rejeitam zip que contenha a pasta do projeto como raiz.
 *
 * Fica de fora, deliberadamente: docs/, tests/, tools/, .claude/, .git/,
 * package.json, README.md e qualquer arquivo de desenvolvimento. Enviar isso
 * não quebra a revisão, mas expõe a árvore interna do projeto a quem baixar o
 * .crx — e o revisor lê o que estiver no pacote.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Só isto entra no pacote. Lista explícita: incluir por engano é fácil. */
const INCLUDE = ['manifest.json', 'src', 'assets'];

/** Mesmo dentro de src/ e assets/, nada disto vai. */
const EXCLUDE_NAMES = new Set(['.DS_Store', 'Thumbs.db']);
const EXCLUDE_EXT = new Set(['.map', '.md']);

function readManifest() {
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest.version) throw new Error('manifest.json sem "version"');
  return manifest;
}

function copyInto(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (EXCLUDE_NAMES.has(entry)) continue;
      copyInto(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (EXCLUDE_EXT.has(path.extname(source))) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/* --------------------------------------------------------------------------
 * Escritor de ZIP próprio.
 *
 * Não use `Compress-Archive`: o Windows PowerShell 5.1 grava os caminhos com
 * contrabarra (`src\ui\board.js`), enquanto a especificação ZIP (APPNOTE
 * 4.4.17.1) exige barra normal. O Chrome carrega esse zip como um punhado de
 * arquivos de nome estranho na raiz, sem estrutura de pastas, e a extensão não
 * funciona — com uma submissão gasta para descobrir isso.
 * ----------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function zipDirectory(stageDir, zipPath) {
  const entries = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // sempre '/', nunca path.sep — é o ponto inteiro deste escritor
      else entries.push({ name: path.relative(stageDir, full).split(path.sep).join('/'), full });
    }
  })(stageDir);

  const now = new Date();
  const { time, day } = dosDateTime(now);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = fs.readFileSync(entry.full);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const stored = deflated.length < raw.length;
    const body = stored ? deflated : raw;
    const method = stored ? 8 : 0;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // versão necessária
    local.writeUInt16LE(0x0800, 6);       // bit 11: nome em UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);             // versão que criou
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);             // extra
    dir.writeUInt16LE(0, 32);             // comentário
    dir.writeUInt16LE(0, 34);             // disco
    dir.writeUInt16LE(0, 36);             // atributos internos
    dir.writeUInt32LE(0, 38);             // atributos externos
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, end]));
  return entries.length;
}

/** Relê o zip gravado e prova que ele é válido antes de você enviar. */
function verifyZip(zipPath, stageDir) {
  const buffer = fs.readFileSync(zipPath);
  const problems = [];
  const seen = [];
  let cursor = 0;
  while ((cursor = buffer.indexOf(SIGNATURE, cursor)) !== -1) {
    const method = buffer.readUInt16LE(cursor + 8);
    const compSize = buffer.readUInt32LE(cursor + 18);
    const rawSize = buffer.readUInt32LE(cursor + 22);
    const nameLen = buffer.readUInt16LE(cursor + 26);
    const extraLen = buffer.readUInt16LE(cursor + 28);
    const name = buffer.slice(cursor + 30, cursor + 30 + nameLen).toString('utf8');
    const start = cursor + 30 + nameLen + extraLen;
    const body = buffer.slice(start, start + compSize);

    if (name.includes('\\')) problems.push(`separador inválido no caminho: ${name}`);
    const restored = method === 8 ? zlib.inflateRawSync(body) : body;
    if (restored.length !== rawSize) problems.push(`tamanho divergente em ${name}`);
    const original = fs.readFileSync(path.join(stageDir, name.split('/').join(path.sep)));
    if (!restored.equals(original)) problems.push(`conteúdo divergente em ${name}`);

    seen.push(name);
    cursor = start + compSize;
  }
  if (!seen.includes('manifest.json')) problems.push('manifest.json não está na raiz do zip');
  return { seen, problems };
}

const SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Confere o que realmente foi parar no pacote antes de você enviar. */
function verify(stageDir) {
  const problems = [];
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(stageDir, full).split(path.sep).join('/'));
    }
  })(stageDir);

  if (!files.includes('manifest.json')) problems.push('manifest.json ausente');
  for (const file of files) {
    if (/^(docs|tests|tools|\.claude|\.git)\//.test(file)) problems.push(`arquivo de desenvolvimento no pacote: ${file}`);
  }

  // O manifest referencia arquivos que existem no pacote?
  const manifest = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf8'));
  const referenced = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  for (const ref of referenced) {
    if (!files.includes(ref)) problems.push(`manifest aponta para arquivo ausente: ${ref}`);
  }
  return { files, problems };
}

function main() {
  const manifest = readManifest();
  const stageName = `kanzapp-${manifest.version}`;
  const stageDir = path.join(DIST, stageName);
  const zipPath = path.join(DIST, `${stageName}.zip`);

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const entry of INCLUDE) {
    const source = path.join(ROOT, entry);
    if (!fs.existsSync(source)) throw new Error(`faltando no projeto: ${entry}`);
    copyInto(source, path.join(stageDir, entry));
  }

  // o grafo de imports precisa estar coberto pelo WAR, senao o zip instala e
  // a extensao nao faz nada — falha silenciosa, a pior de todas
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-package.mjs')], { stdio: 'inherit' });

  const { files, problems } = verify(stageDir);
  if (problems.length) {
    console.error('\nPacote reprovado:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  zipDirectory(stageDir, zipPath);

  // Relê o que foi gravado: separador de caminho, CRC e conteúdo byte a byte.
  const check = verifyZip(zipPath, stageDir);
  if (check.problems.length) {
    console.error('\nZip inválido:');
    for (const problem of check.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  if (check.seen.length !== files.length) {
    console.error(`\nZip incompleto: ${check.seen.length} de ${files.length} arquivos.`);
    process.exit(1);
  }

  const size = fs.statSync(zipPath).size;
  console.log(`\n${path.relative(ROOT, zipPath)}`);
  console.log(`${files.length} arquivos · ${(size / 1024).toFixed(1)} KB · versão ${manifest.version}`);
  console.log('zip verificado: caminhos com "/", conteúdo confere byte a byte.');
  console.log('\nAntes de enviar: confira que a versão é maior que a da submissão anterior.');
}

main();
