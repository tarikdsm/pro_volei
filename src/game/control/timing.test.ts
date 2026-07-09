import { describe, it, expect } from 'vitest';
import { receiveTimingQuality, jumpTimingQuality, humanContactQuality } from './timing';
import { HUMAN_TIMING } from '../../core/constants';

describe('receiveTimingQuality', () => {
  it('dá 1.0 no sweet-spot da recepção', () => {
    expect(receiveTimingQuality(HUMAN_TIMING.receiveSweet)).toBeCloseTo(1);
  });
  it('cai com o erro de timing e satura em 0', () => {
    // meio slope de erro → metade da qualidade
    expect(
      receiveTimingQuality(HUMAN_TIMING.receiveSweet + 0.5 / HUMAN_TIMING.receiveSlope),
    ).toBeCloseTo(0.5);
    expect(receiveTimingQuality(1)).toBe(0);
    expect(receiveTimingQuality(-1)).toBe(0);
  });
});

describe('jumpTimingQuality', () => {
  it('dá 1.0 no sweet-spot do pulo', () => {
    expect(jumpTimingQuality(HUMAN_TIMING.jumpSweet)).toBeCloseTo(1);
  });
  it('cai com o erro e satura em 0', () => {
    expect(jumpTimingQuality(HUMAN_TIMING.jumpSweet + 0.5 / HUMAN_TIMING.jumpSlope)).toBeCloseTo(
      0.5,
    );
    expect(jumpTimingQuality(2)).toBe(0);
  });
});

describe('humanContactQuality', () => {
  it('mapeia timingQ de contactBase até contactBase+contactSpan sem bola forte', () => {
    expect(humanContactQuality(0, false)).toBeCloseTo(HUMAN_TIMING.contactBase);
    expect(humanContactQuality(1, false)).toBeCloseTo(
      HUMAN_TIMING.contactBase + HUMAN_TIMING.contactSpan,
    );
  });
  it('aplica hardPenalty contra bola forte', () => {
    expect(humanContactQuality(1, true)).toBeCloseTo(
      (HUMAN_TIMING.contactBase + HUMAN_TIMING.contactSpan) * HUMAN_TIMING.hardPenalty,
    );
  });
});
