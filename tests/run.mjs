// Runner de testes sem dependencias. Uso: node tests/run.mjs [filtro]
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT_DIR = join(HERE, 'unit');

const useColor = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;
const paint = (code, text) => (useColor ? `[${code}m${text}[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const dim = (t) => paint('90', t);
const bold = (t) => paint('1', t);
const yellow = (t) => paint('33', t);

const state = {
  suites: [],
  current: null,
  passed: 0,
  failed: 0,
  skipped: 0,
  failures: []
};

export function describe(name, fn) {
  const previous = state.current;
  const suite = { name, parent: previous, tests: [] };
  state.current = suite;
  state.suites.push(suite);
  fn();
  state.current = previous;
}

function suitePath(suite) {
  const parts = [];
  let node = suite;
  while (node) {
    parts.unshift(node.name);
    node = node.parent;
  }
  return parts.join(' › ');
}

const pending = [];

export function it(name, fn) {
  pending.push({ name, fn, suite: state.current });
}

it.skip = (name) => {
  pending.push({ name, fn: null, suite: state.current });
};

function stringify(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

export function expect(actual) {
  const api = {
    toBe(expected, message) {
      if (!Object.is(actual, expected)) {
        throw new Error(message || `esperado ${stringify(expected)}, recebido ${stringify(actual)}`);
      }
    },
    toEqual(expected, message) {
      if (!deepEqual(actual, expected)) {
        throw new Error(message || `esperado ${stringify(expected)}, recebido ${stringify(actual)}`);
      }
    },
    toBeTruthy(message) {
      if (!actual) throw new Error(message || `esperado valor truthy, recebido ${stringify(actual)}`);
    },
    toBeFalsy(message) {
      if (actual) throw new Error(message || `esperado valor falsy, recebido ${stringify(actual)}`);
    },
    toBeNull(message) {
      if (actual !== null) throw new Error(message || `esperado null, recebido ${stringify(actual)}`);
    },
    toBeUndefined(message) {
      if (actual !== undefined) throw new Error(message || `esperado undefined, recebido ${stringify(actual)}`);
    },
    toContain(needle, message) {
      const ok = typeof actual === 'string' ? actual.includes(needle) : Array.isArray(actual) && actual.includes(needle);
      if (!ok) throw new Error(message || `esperado que ${stringify(actual)} contivesse ${stringify(needle)}`);
    },
    toHaveLength(len, message) {
      if (!actual || actual.length !== len) {
        throw new Error(message || `esperado length ${len}, recebido ${actual ? actual.length : stringify(actual)}`);
      }
    },
    toBeGreaterThan(n, message) {
      if (!(actual > n)) throw new Error(message || `esperado > ${n}, recebido ${stringify(actual)}`);
    },
    toBeGreaterThanOrEqual(n, message) {
      if (!(actual >= n)) throw new Error(message || `esperado >= ${n}, recebido ${stringify(actual)}`);
    },
    toBeLessThan(n, message) {
      if (!(actual < n)) throw new Error(message || `esperado < ${n}, recebido ${stringify(actual)}`);
    },
    toBeLessThanOrEqual(n, message) {
      if (!(actual <= n)) throw new Error(message || `esperado <= ${n}, recebido ${stringify(actual)}`);
    },
    async toReject(message) {
      let rejected = false;
      try {
        await actual;
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(message || 'esperado que a promise rejeitasse');
    },
    get not() {
      return {
        toBe(expected, message) {
          if (Object.is(actual, expected)) {
            throw new Error(message || `nao esperado ${stringify(expected)}`);
          }
        },
        toEqual(expected, message) {
          if (deepEqual(actual, expected)) {
            throw new Error(message || `nao esperado ${stringify(expected)}`);
          }
        },
        toContain(needle, message) {
          const ok = typeof actual === 'string' ? actual.includes(needle) : Array.isArray(actual) && actual.includes(needle);
          if (ok) throw new Error(message || `nao esperado conter ${stringify(needle)}`);
        }
      };
    }
  };
  return api;
}

async function main() {
  const filter = process.argv[2] || '';
  let files = [];
  try {
    files = readdirSync(UNIT_DIR)
      .filter((f) => f.endsWith('.test.mjs'))
      .filter((f) => (filter ? f.includes(filter) : true))
      .sort();
  } catch {
    console.error(red('Pasta tests/unit nao encontrada.'));
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(red('Nenhum arquivo de teste encontrado.'));
    process.exit(1);
  }

  const started = Date.now();
  for (const file of files) {
    pending.length = 0;
    state.suites.length = 0;
    state.current = null;
    console.log(`\n${bold(file)}`);
    await import(pathToFileURL(join(UNIT_DIR, file)).href);

    for (const test of pending) {
      const label = test.suite ? `${suitePath(test.suite)} › ${test.name}` : test.name;
      if (!test.fn) {
        state.skipped += 1;
        console.log(`  ${yellow('○')} ${dim(label)}`);
        continue;
      }
      try {
        await test.fn();
        state.passed += 1;
        console.log(`  ${green('✓')} ${dim(label)}`);
      } catch (error) {
        state.failed += 1;
        state.failures.push({ file, label, error });
        console.log(`  ${red('✗')} ${label}`);
        console.log(`    ${red(error?.message || String(error))}`);
      }
    }
  }

  const ms = Date.now() - started;
  console.log('');
  if (state.failures.length > 0) {
    console.log(bold(red(`${state.failures.length} falha(s):`)));
    for (const failure of state.failures) {
      console.log(`  ${red('✗')} ${failure.file} › ${failure.label}`);
      const stack = String(failure.error?.stack || '').split('\n').slice(1, 3).join('\n');
      if (stack) console.log(dim(stack));
    }
    console.log('');
  }
  const summary = `${state.passed} passou, ${state.failed} falhou, ${state.skipped} pulado — ${ms}ms`;
  console.log(state.failed === 0 ? green(bold(`✓ ${summary}`)) : red(bold(`✗ ${summary}`)));
  process.exit(state.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(red('Runner quebrou:'), error);
  process.exit(1);
});
