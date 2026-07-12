import {
  RandomSourceBase,
  assertUint32,
  frozenSnapshot,
  type RandomSnapshot,
  type RandomStateTuple,
} from './RandomSource';

export const XOSHIRO128SS_ALGORITHM = 'xoshiro128ss-splitmix32-v1' as const;

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** Expansão versionada de uma seed uint32 para os quatro words do xoshiro. */
function expandSeed(seed: number): RandomStateTuple {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e37_79b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0_aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a_2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

function validateState(state: RandomStateTuple): void {
  if (!Array.isArray(state) || state.length !== 4) {
    throw new RangeError('state deve conter quatro uint32');
  }
  for (const word of state) assertUint32(word, 'state');
  if (state.every((word) => word === 0)) {
    throw new RangeError('state do xoshiro não pode ser todo zero');
  }
}

export class Xoshiro128StarStar extends RandomSourceBase {
  readonly algorithm = XOSHIRO128SS_ALGORITHM;
  private state: [number, number, number, number];

  constructor(seed: number) {
    super();
    assertUint32(seed, 'seed');
    this.state = [...expandSeed(seed)];
  }

  nextUint32(): number {
    const result = Math.imul(rotateLeft(Math.imul(this.state[1], 5) >>> 0, 7), 9) >>> 0;
    const shifted = (this.state[1] << 9) >>> 0;

    this.state[2] = (this.state[2] ^ this.state[0]) >>> 0;
    this.state[3] = (this.state[3] ^ this.state[1]) >>> 0;
    this.state[1] = (this.state[1] ^ this.state[2]) >>> 0;
    this.state[0] = (this.state[0] ^ this.state[3]) >>> 0;
    this.state[2] = (this.state[2] ^ shifted) >>> 0;
    this.state[3] = rotateLeft(this.state[3], 11);
    this.recordDraw();
    return result;
  }

  snapshot(): Readonly<RandomSnapshot> {
    return frozenSnapshot(this.algorithm, this.state, this.draws);
  }

  restore(snapshot: RandomSnapshot): void {
    if (snapshot.algorithm !== this.algorithm) {
      throw new RangeError(`algorithm incompatível: ${snapshot.algorithm}`);
    }
    validateState(snapshot.state);
    if (!Number.isSafeInteger(snapshot.draws) || snapshot.draws < 0) {
      throw new RangeError('draws deve ser inteiro seguro não negativo');
    }
    this.state = [...snapshot.state];
    this.restoreDraws(snapshot.draws);
  }
}
