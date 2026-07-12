import { describe, it, expect } from 'vitest';
import { humanContactQuality } from './timing';
import { HUMAN_TIMING } from '../../core/constants';

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
