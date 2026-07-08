import { describe, it, expect } from 'vitest';
import { receiveTimingQuality, jumpTimingQuality, humanContactQuality } from './timing';

describe('receiveTimingQuality', () => {
  it('dá 1.0 no instante ideal (0.08s antes do contato)', () => {
    expect(receiveTimingQuality(0.08)).toBeCloseTo(1);
  });
  it('cai com o erro de timing e satura em 0', () => {
    expect(receiveTimingQuality(0.08 + 0.5 / 3.2)).toBeCloseTo(0.5);
    expect(receiveTimingQuality(1)).toBe(0);
    expect(receiveTimingQuality(-1)).toBe(0);
  });
});

describe('jumpTimingQuality', () => {
  it('dá 1.0 no instante ideal (0.26s antes do contato)', () => {
    expect(jumpTimingQuality(0.26)).toBeCloseTo(1);
  });
  it('cai com o erro e satura em 0', () => {
    expect(jumpTimingQuality(0.26 + 0.5 / 2.8)).toBeCloseTo(0.5);
    expect(jumpTimingQuality(2)).toBe(0);
  });
});

describe('humanContactQuality', () => {
  it('mapeia timingQ para 0.45..1.0 sem bola forte', () => {
    expect(humanContactQuality(0, false)).toBeCloseTo(0.45);
    expect(humanContactQuality(1, false)).toBeCloseTo(1);
  });
  it('penaliza 20% contra bola forte', () => {
    expect(humanContactQuality(1, true)).toBeCloseTo(0.8);
  });
});
