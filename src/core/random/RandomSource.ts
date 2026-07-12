export type RandomStateTuple = readonly [number, number, number, number];

export interface RandomSnapshot {
  readonly algorithm: string;
  readonly state: RandomStateTuple;
  readonly draws: number;
}

export interface RandomSource {
  readonly algorithm: string;
  readonly draws: number;
  nextUint32(): number;
  nextFloat(): number;
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  snapshot(): Readonly<RandomSnapshot>;
  restore(snapshot: RandomSnapshot): void;
}

export abstract class RandomSourceBase implements RandomSource {
  private drawCount = 0;

  abstract readonly algorithm: string;
  abstract nextUint32(): number;
  abstract snapshot(): Readonly<RandomSnapshot>;
  abstract restore(snapshot: RandomSnapshot): void;

  get draws(): number {
    return this.drawCount;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new RangeError('range exige limites finitos com max >= min');
    }
    return min + this.nextFloat() * (max - min);
  }

  chance(probability: number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError('chance exige probabilidade em [0,1]');
    }
    return this.nextFloat() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick exige uma coleção não vazia');
    return items[Math.floor(this.nextFloat() * items.length)];
  }

  protected recordDraw(): void {
    this.drawCount++;
  }

  protected restoreDraws(draws: number): void {
    if (!Number.isSafeInteger(draws) || draws < 0) {
      throw new RangeError('draws deve ser inteiro seguro não negativo');
    }
    this.drawCount = draws;
  }
}

export function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} deve ser uint32`);
  }
}

export function frozenSnapshot(
  algorithm: string,
  state: RandomStateTuple,
  draws: number,
): Readonly<RandomSnapshot> {
  const frozenState = Object.freeze([...state]) as unknown as RandomStateTuple;
  return Object.freeze({ algorithm, state: frozenState, draws });
}
