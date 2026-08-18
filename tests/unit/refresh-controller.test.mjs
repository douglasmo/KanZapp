import { describe, it, expect } from '../run.mjs';
import { createRefreshController } from '../../src/content/refresh-controller.js';

describe('refresh-controller/ciclo de vida', () => {
  it('rearma o timer quando refreshMs muda com o board aberto', () => {
    const scheduled = [];
    const cleared = [];
    let nextId = 1;
    const controller = createRefreshController({
      onRefresh: () => {},
      setTimer(fn, ms) {
        const id = nextId++;
        scheduled.push({ id, fn, ms });
        return id;
      },
      clearTimer(id) {
        cleared.push(id);
      }
    });

    controller.configure({ autoRefresh: true, refreshMs: 4000 });
    controller.start();
    expect(scheduled.map((entry) => entry.ms)).toEqual([4000]);

    controller.configure({ autoRefresh: true, refreshMs: 7000 });
    expect(cleared).toEqual([1]);
    expect(scheduled.map((entry) => entry.ms)).toEqual([4000, 7000]);

    controller.stop();
    expect(cleared).toEqual([1, 2]);
    expect(controller.status().scheduled).toBe(false);
  });

  it('desliga e religa a atualização automática sem reabrir o board', () => {
    const scheduled = [];
    const cleared = [];
    let nextId = 1;
    const controller = createRefreshController({
      onRefresh: () => {},
      setTimer(fn, ms) {
        const id = nextId++;
        scheduled.push({ id, fn, ms });
        return id;
      },
      clearTimer: (id) => cleared.push(id)
    });

    controller.start();
    controller.configure({ autoRefresh: false, refreshMs: 4000 });
    expect(cleared).toEqual([1]);
    expect(controller.status().scheduled).toBe(false);

    controller.configure({ autoRefresh: true, refreshMs: 2500 });
    expect(scheduled.map((entry) => entry.ms)).toEqual([4000, 2500]);
    controller.destroy();
    expect(cleared).toEqual([1, 2]);
    expect(controller.status().destroyed).toBe(true);
  });
});

