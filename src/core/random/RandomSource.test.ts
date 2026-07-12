import { describe, expect, it } from 'vitest';
import { parseSeed } from './Seed';
import { SequenceRandom } from './testing/SequenceRandom';

describe('operações de RandomSource', () => {
  it('range/chance/pick consomem um draw cada e respeitam limites', () => {
    const rng = SequenceRandom.fromFloats([0, 0.25, 0.75, 0.999_999]);

    expect(rng.range(-2, 2)).toBe(-2);
    expect(rng.chance(0.5)).toBe(true);
    expect(rng.pick(['a', 'b', 'c', 'd'])).toBe('d');
    expect(rng.range(4, 4)).toBe(4);
    expect(rng.draws).toBe(4);
  });

  it('chance 0/1 ainda consome draws e nunca viola a probabilidade', () => {
    const rng = SequenceRandom.fromFloats([0, 0.999_999]);

    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.draws).toBe(2);
  });

  it('rejeita ranges, probabilidades e coleções inválidas', () => {
    const rng = SequenceRandom.fromFloats([0.5]);

    expect(() => rng.range(2, 1)).toThrow(RangeError);
    expect(() => rng.range(Number.NaN, 1)).toThrow(RangeError);
    expect(() => rng.chance(-0.01)).toThrow(RangeError);
    expect(() => rng.chance(1.01)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(rng.draws).toBe(0);
  });
});

describe('SequenceRandom', () => {
  it('reproduz ramos exatos, snapshot e erro de exaustão', () => {
    const rng = SequenceRandom.fromFloats([0.1, 0.6, 0.9]);
    expect(rng.chance(0.2)).toBe(true);
    const checkpoint = rng.snapshot();
    expect(rng.chance(0.5)).toBe(false);
    expect(rng.pick(['left', 'right'])).toBe('right');
    expect(() => rng.nextFloat()).toThrow(/exhausted/i);

    rng.restore(checkpoint);
    expect(rng.chance(0.5)).toBe(false);
    expect(rng.pick(['left', 'right'])).toBe('right');
  });

  it('rejeita sequência vazia e valores fora de uint32/[0,1)', () => {
    expect(() => new SequenceRandom([])).toThrow(RangeError);
    expect(() => new SequenceRandom([-1])).toThrow(RangeError);
    expect(() => new SequenceRandom([0x1_0000_0000])).toThrow(RangeError);
    expect(() => SequenceRandom.fromFloats([-0.1])).toThrow(RangeError);
    expect(() => SequenceRandom.fromFloats([1])).toThrow(RangeError);
  });

  it('rejeita snapshot cujo contador não corresponde ao cursor', () => {
    const rng = SequenceRandom.fromFloats([0.1, 0.2]);
    rng.nextFloat();
    const snapshot = rng.snapshot();

    expect(() => rng.restore({ ...snapshot, draws: 0 })).toThrow(/draws/i);
  });
});

describe('parseSeed', () => {
  it('aceita somente decimal uint32, inclusive zero e máximo', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('00042')).toBe(42);
    expect(parseSeed('4294967295')).toBe(0xffff_ffff);
  });

  it.each([
    null,
    undefined,
    '',
    ' ',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x10',
    '4294967296',
    '999999999999999999999',
    'abc',
  ])('rejeita %j sem coerção parcial', (input) => {
    expect(parseSeed(input)).toBeNull();
  });
});
