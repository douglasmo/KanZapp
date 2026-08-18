import { describe, it, expect } from '../run.mjs';
import { relativeTime } from '../../src/ui/card.js';

describe('card/tempo relativo', () => {
  it('formata follow-up futuro sem dizer que é agora', () => {
    const now = new Date(2026, 7, 10, 12, 0, 0).getTime();
    expect(relativeTime(now + 30000, now)).toBe('em instantes');
    expect(relativeTime(now + 3 * 3600000, now)).toBe('em 3 h');
  });
});

