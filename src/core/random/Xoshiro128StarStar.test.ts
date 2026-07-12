import { describe, expect, it } from 'vitest';
import { XOSHIRO128SS_ALGORITHM, Xoshiro128StarStar } from './Xoshiro128StarStar';

describe('Xoshiro128StarStar', () => {
  it('segue o golden vector público do estado [1,2,3,4]', () => {
    const rng = new Xoshiro128StarStar(0);
    rng.restore({
      algorithm: XOSHIRO128SS_ALGORITHM,
      state: [1, 2, 3, 4],
      draws: 0,
    });

    expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual([
      11_520, 0, 5_927_040, 70_819_200, 2_031_721_883, 1_637_235_492, 1_287_239_034, 3_734_860_849,
    ]);
  });

  it('expande a seed zero de forma válida e fixa seu golden vector versionado', () => {
    const rng = new Xoshiro128StarStar(0);

    expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual([
      1_789_933_344, 44_971_166, 2_521_387_044, 3_848_737_593, 1_138_324_114, 749_234_105,
      1_899_511_038, 1_995_189_375,
    ]);
  });

  it('preserva wrap uint32 na maior seed pública', () => {
    const rng = new Xoshiro128StarStar(0xffff_ffff);

    expect(Array.from({ length: 4 }, () => rng.nextUint32())).toEqual([
      4_104_197_751, 1_825_856_343, 1_152_209_388, 2_427_537_429,
    ]);
  });

  it('nextFloat deriva exatamente um uint32 e permanece em [0,1) por 10 mil draws', () => {
    const golden = new Xoshiro128StarStar(1);
    expect([golden.nextFloat(), golden.nextFloat(), golden.nextFloat()]).toEqual([
      393_288_148 / 0x1_0000_0000,
      2_174_103_013 / 0x1_0000_0000,
      3_814_759_091 / 0x1_0000_0000,
    ]);

    const sample = new Xoshiro128StarStar(123);
    for (let i = 0; i < 10_000; i++) {
      const value = sample.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(sample.draws).toBe(10_000);
  });

  it('snapshot/restore reproduz exatamente o sufixo e preserva draws', () => {
    const rng = new Xoshiro128StarStar(42);
    rng.nextUint32();
    rng.nextUint32();
    const checkpoint = rng.snapshot();
    const suffix = Array.from({ length: 6 }, () => rng.nextUint32());

    rng.restore(checkpoint);

    expect(Array.from({ length: 6 }, () => rng.nextUint32())).toEqual(suffix);
    expect(rng.draws).toBe(checkpoint.draws + 6);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.state)).toBe(true);
  });

  it('rejeita seed e snapshots incompatíveis ou corrompidos', () => {
    expect(() => new Xoshiro128StarStar(-1)).toThrow(RangeError);
    expect(() => new Xoshiro128StarStar(0x1_0000_0000)).toThrow(RangeError);
    expect(() => new Xoshiro128StarStar(1.5)).toThrow(RangeError);

    const rng = new Xoshiro128StarStar(1);
    expect(() => rng.restore({ algorithm: 'outro-v1', state: [1, 2, 3, 4], draws: 0 })).toThrow(
      /algorithm/i,
    );
    expect(() =>
      rng.restore({ algorithm: XOSHIRO128SS_ALGORITHM, state: [0, 0, 0, 0], draws: 0 }),
    ).toThrow(/state/i);
    expect(() =>
      rng.restore({ algorithm: XOSHIRO128SS_ALGORITHM, state: [1, 2, 3, -1], draws: 0 }),
    ).toThrow(/state/i);
    expect(() =>
      rng.restore({ algorithm: XOSHIRO128SS_ALGORITHM, state: [1, 2, 3, 4], draws: -1 }),
    ).toThrow(/draws/i);
  });
});
