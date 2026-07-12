import {
  RandomSourceBase,
  assertUint32,
  frozenSnapshot,
  type RandomSnapshot,
} from '../RandomSource';

export const SEQUENCE_RANDOM_ALGORITHM = 'sequence-random-v1' as const;

function sequenceHash(values: readonly number[]): number {
  let hash = 0x811c_9dc5;
  for (const value of values) {
    hash = Math.imul(hash ^ value, 0x0100_0193) >>> 0;
  }
  return hash >>> 0;
}

/** Fonte finita para testes: cada entrada representa exatamente um uint32. */
export class SequenceRandom extends RandomSourceBase {
  readonly algorithm = SEQUENCE_RANDOM_ALGORITHM;
  private readonly values: readonly number[];
  private readonly hash: number;
  private cursor = 0;

  constructor(values: readonly number[]) {
    super();
    if (values.length === 0) throw new RangeError('SequenceRandom exige ao menos um valor');
    for (const value of values) assertUint32(value, 'valor da sequência');
    this.values = Object.freeze([...values]);
    this.hash = sequenceHash(this.values);
  }

  static fromFloats(values: readonly number[]): SequenceRandom {
    if (values.length === 0) throw new RangeError('SequenceRandom exige ao menos um valor');
    return new SequenceRandom(
      values.map((value) => {
        if (!Number.isFinite(value) || value < 0 || value >= 1) {
          throw new RangeError('valor float da sequência deve estar em [0,1)');
        }
        return Math.floor(value * 0x1_0000_0000);
      }),
    );
  }

  nextUint32(): number {
    if (this.cursor >= this.values.length) throw new RangeError('SequenceRandom exhausted');
    const value = this.values[this.cursor++];
    this.recordDraw();
    return value;
  }

  snapshot(): Readonly<RandomSnapshot> {
    return frozenSnapshot(
      this.algorithm,
      [this.cursor, this.hash, this.values.length, 0],
      this.draws,
    );
  }

  restore(snapshot: RandomSnapshot): void {
    if (snapshot.algorithm !== this.algorithm) {
      throw new RangeError(`algorithm incompatível: ${snapshot.algorithm}`);
    }
    const [cursor, hash, length, reserved] = snapshot.state;
    if (
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      cursor > this.values.length ||
      hash !== this.hash ||
      length !== this.values.length ||
      reserved !== 0
    ) {
      throw new RangeError('state incompatível com esta SequenceRandom');
    }
    if (snapshot.draws !== cursor) {
      throw new RangeError('draws incompatível com o cursor da SequenceRandom');
    }
    this.restoreDraws(snapshot.draws);
    this.cursor = cursor;
  }
}
