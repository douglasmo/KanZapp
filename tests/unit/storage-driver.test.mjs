import { describe, it, expect } from '../run.mjs';
import { installChromeStub } from '../chrome-stub.mjs';
import { createStorageDriver } from '../../src/core/storage-driver.js';
import { STORAGE_KEY } from '../../src/core/constants.js';

describe('storage-driver/fila serializada', () => {
  it('10 mutações em paralelo — nenhuma se perde (defeito P4)', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { n: 0, log: [] } }, latency: 1 });
    const driver = createStorageDriver({});

    const jobs = [];
    for (let i = 0; i < 10; i += 1) {
      jobs.push(
        driver.mutate((draft) => {
          const base = draft || { n: 0, log: [] };
          base.n += 1;
          base.log.push(i);
          return base;
        })
      );
    }
    await Promise.all(jobs);
    await driver.flush();

    const saved = stub.snapshot()[STORAGE_KEY];
    expect(saved.n).toBe(10, 'read-modify-write concorrente perdeu atualizações');
    expect(saved.log).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'a ordem FIFO não foi respeitada');
    stub.uninstall();
  });

  it('mutações são aplicadas em ordem mesmo com latência variável', async () => {
    const stub = installChromeStub({ initial: {}, latency: 2 });
    const driver = createStorageDriver({});
    const results = await Promise.all(
      ['a', 'b', 'c', 'd'].map((letter) =>
        driver.mutate((draft) => {
          const base = draft || { s: '' };
          base.s += letter;
          return base;
        })
      )
    );
    expect(results[results.length - 1].s).toBe('abcd');
    expect(stub.snapshot()[STORAGE_KEY].s).toBe('abcd');
    stub.uninstall();
  });

  it('uma mutação que lança não trava a fila', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { n: 0 } } });
    const driver = createStorageDriver({});
    const bad = driver.mutate(() => {
      throw new Error('boom');
    });
    const good = driver.mutate((draft) => {
      draft.n += 1;
      return draft;
    });
    await bad;
    const after = await good;
    expect(after.n).toBe(1);
    stub.uninstall();
  });

  it('dois drivers concorrentes preservam ambas as atualizações', async () => {
    const stub = installChromeStub({
      initial: { [STORAGE_KEY]: { a: 0, b: 0 } },
      latency: 1
    });
    const first = createStorageDriver({ lockPollMs: 5 });
    const second = createStorageDriver({ lockPollMs: 5 });

    await Promise.all([
      first.mutate(async (draft) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        draft.a += 1;
        return draft;
      }),
      second.mutate((draft) => {
        draft.b += 1;
        return draft;
      })
    ]);

    expect(stub.snapshot()[STORAGE_KEY]).toEqual({ a: 1, b: 1 });
    const leakedLocks = Object.keys(stub.snapshot()).filter((key) => key.includes('.__lock__.'));
    expect(leakedLocks).toHaveLength(0);
    stub.uninstall();
  });

  it('renova o lease durante um mutator longo', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { a: 0, b: 0 } }, latency: 1 });
    const options = { lockLeaseMs: 200, lockTimeoutMs: 1000, lockPollMs: 5 };
    const first = createStorageDriver(options);
    const second = createStorageDriver(options);

    const slow = first.mutate(async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      draft.a += 1;
      return draft;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const concurrent = second.mutate((draft) => {
      draft.b += 1;
      return draft;
    });
    await Promise.all([slow, concurrent]);

    expect(stub.snapshot()[STORAGE_KEY]).toEqual({ a: 1, b: 1 });
    stub.uninstall();
  });

  it('recupera depois que um lock órfão expira', async () => {
    const orphanKey = `${STORAGE_KEY}.__lock__.orphan`;
    const stub = installChromeStub({
      initial: {
        [STORAGE_KEY]: { n: 1 },
        [orphanKey]: {
          owner: 'orphan',
          choosing: false,
          ticket: 1,
          expiresAt: Date.now() + 60,
          leaseMs: 200
        }
      }
    });
    const driver = createStorageDriver({ lockLeaseMs: 200, lockTimeoutMs: 600, lockPollMs: 5 });
    const next = await driver.mutate((draft) => {
      draft.n += 1;
      return draft;
    });

    expect(next.n).toBe(2);
    expect(stub.snapshot()[orphanKey]).toBeUndefined();
    stub.uninstall();
  });
});

describe('storage-driver/contexto e cache', () => {
  it('read devolve null quando não há nada gravado', async () => {
    const stub = installChromeStub({ initial: {} });
    const driver = createStorageDriver({});
    expect(await driver.read()).toBeNull();
    stub.uninstall();
  });

  it('reaproveita o cache: uma leitura de disco para várias chamadas', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { n: 1 } } });
    const driver = createStorageDriver({});
    await driver.read();
    await driver.read();
    await driver.read();
    expect(stub.stats.get).toBe(1);
    stub.uninstall();
  });

  it('contexto morto: mutate vira no-op silencioso', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { n: 5 } } });
    const driver = createStorageDriver({});
    await driver.read();
    stub.kill();
    const result = await driver.mutate((draft) => {
      draft.n = 999;
      return draft;
    });
    expect(result.n).toBe(5);
    expect(stub.snapshot()[STORAGE_KEY].n).toBe(5);
    stub.uninstall();
  });

  it('readRaw/removeRaw operam nas chaves legadas', async () => {
    const stub = installChromeStub({ initial: { kanbanData: { x: 'todo' }, kanbanTags: [] } });
    const driver = createStorageDriver({});
    const raw = await driver.readRaw(['kanbanData', 'kanbanTags']);
    expect(raw.kanbanData).toEqual({ x: 'todo' });
    await driver.removeRaw(['kanbanData']);
    expect(stub.snapshot().kanbanData).toBeUndefined();
    stub.uninstall();
  });
});

describe('storage-driver/mudanças externas', () => {
  it('ignora o eco da própria escrita e avisa nas de fora', async () => {
    const stub = installChromeStub({ initial: {} });
    const driver = createStorageDriver({});
    const seen = [];
    const stop = driver.onExternalChange((state) => seen.push(state));

    await driver.mutate(() => ({ n: 1 }));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toHaveLength(0, 'a escrita própria não pode disparar o callback');

    stub.emitExternalChange(STORAGE_KEY, { n: 42 });
    expect(seen).toHaveLength(1);
    expect(seen[0].n).toBe(42);

    stop();
    stub.emitExternalChange(STORAGE_KEY, { n: 43 });
    expect(seen).toHaveLength(1, 'o unsubscribe não removeu o listener');
    stub.uninstall();
  });

  it('mudança externa invalida o cache: a próxima mutação parte do valor novo', async () => {
    const stub = installChromeStub({ initial: { [STORAGE_KEY]: { n: 1 } } });
    const driver = createStorageDriver({});
    await driver.read();
    stub.emitExternalChange(STORAGE_KEY, { n: 10 });
    const next = await driver.mutate((draft) => {
      draft.n += 1;
      return draft;
    });
    expect(next.n).toBe(11);
    stub.uninstall();
  });
});
