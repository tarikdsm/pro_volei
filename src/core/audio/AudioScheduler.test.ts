import { describe, expect, it } from 'vitest';
import { scheduleSequence } from './AudioScheduler';

describe('scheduleSequence', () => {
  it('converte offsets em tempos absolutos do AudioContext', () => {
    expect(scheduleSequence(10, [0, 0.1, 0.25])).toEqual([10, 10.1, 10.25]);
  });

  it('neutraliza offsets negativos e entradas não finitas', () => {
    expect(scheduleSequence(4, [-1, Number.NaN, Number.POSITIVE_INFINITY])).toEqual([4, 4, 4]);
  });
});
