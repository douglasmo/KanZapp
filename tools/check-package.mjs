/**
 * Confere que TODO módulo alcançável a partir do content script está exposto em
 * `web_accessible_resources`. Sem isto, um arquivo novo importado por `app.js`
 * faz o import dinâmico falhar e a extensão simplesmente não carrega — sem erro
 * visível, porque a falha acontece dentro do `import()` do boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const patterns = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);

/** Os padroes usados sao 'pasta/*' ou caminho exato: nao precisa de regex. */
function exposed(rel) {
  return patterns.some((pattern) => {
    if (!pattern.includes('*')) return pattern === rel;
    const prefix = pattern.slice(0, pattern.indexOf('*'));
    return rel.startsWith(prefix);
  });
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const problems = [];
const seen = new Set();

/** O content script em si é injetado pelo manifest: não precisa de WAR. */
const entry = path.join(ROOT, manifest.content_scripts[0].js[0]);

function visit(file, viaDynamicImport) {
  const key = rel(file);
  if (seen.has(key)) return;
  seen.add(key);
  if (!fs.existsSync(file)) { problems.push(`arquivo inexistente: ${key}`); return; }
  if (viaDynamicImport && !exposed(key)) problems.push(`importado mas fora do web_accessible_resources: ${key}`);

  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) visit(path.resolve(path.dirname(file), m[1]), true);
  // qualquer getURL('...js') e um ponto de entrada dinamico, inline ou via variavel
  for (const m of src.matchAll(/getURL\(\s*['"]([^'"]+\.js)['"]/g)) visit(path.join(ROOT, m[1]), true);
  // recursos buscados por fetch(getURL(...)) — o CSS do shadow root entra aqui
  for (const m of src.matchAll(/getURL\(\s*['"]([^'"]+\.(?:css|png|svg|json))['"]/g)) {
    const target = m[1];
    if (!fs.existsSync(path.join(ROOT, target))) problems.push(`recurso inexistente: ${target}`);
    else if (!exposed(target)) problems.push(`buscado por fetch mas fora do web_accessible_resources: ${target}`);
  }
  for (const m of src.matchAll(/const\s+CSS_PATH\s*=\s*['"]([^'"]+)['"]/g)) {
    const target = m[1];
    if (!fs.existsSync(path.join(ROOT, target))) problems.push(`recurso inexistente: ${target}`);
    else if (!exposed(target)) problems.push(`CSS fora do web_accessible_resources: ${target}`);
  }
}

visit(entry, false);

console.log(`${seen.size} módulos alcançáveis a partir de ${rel(entry)}`);
if (problems.length) {
  console.error('\nPacote quebraria ao carregar:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('web_accessible_resources cobre todo o grafo de imports.');
