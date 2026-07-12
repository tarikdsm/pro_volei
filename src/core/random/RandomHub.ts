import { assertUint32, type RandomSnapshot, type RandomSource } from './RandomSource';
import { XOSHIRO128SS_ALGORITHM, Xoshiro128StarStar } from './Xoshiro128StarStar';

export const RANDOM_HUB_ALGORITHM = `random-hub-${XOSHIRO128SS_ALGORITHM}` as const;

export interface RandomHubStreamSnapshot {
  readonly name: string;
  readonly random: Readonly<RandomSnapshot>;
}

export interface RandomHubSnapshot {
  readonly algorithm: string;
  readonly rootSeed: number;
  readonly streams: readonly Readonly<RandomHubStreamSnapshot>[];
}

function validateName(name: string): void {
  if (name.trim().length === 0) throw new RangeError('nome do stream não pode ser vazio');
}

/** Hash FNV-1a + avalanche, estável sobre code units UTF-16 do JavaScript. */
function deriveSeed(rootSeed: number, name: string): number {
  let hash = (0x811c_9dc5 ^ rootSeed) >>> 0;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), 0x0100_0193) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), 0x0100_0193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb_352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846c_a68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function freezeHubSnapshot(
  rootSeed: number,
  streams: readonly RandomHubStreamSnapshot[],
): Readonly<RandomHubSnapshot> {
  const frozenStreams = streams.map((entry) =>
    Object.freeze({ name: entry.name, random: entry.random }),
  );
  return Object.freeze({
    algorithm: RANDOM_HUB_ALGORITHM,
    rootSeed,
    streams: Object.freeze(frozenStreams),
  });
}

/** Handle estável que pode ser invalidado por restore e reativado pelo hub na origem. */
class ManagedStream implements RandomSource {
  private active = true;

  constructor(private readonly random: Xoshiro128StarStar) {}

  get algorithm(): string {
    return this.random.algorithm;
  }

  get draws(): number {
    this.assertActive();
    return this.random.draws;
  }

  nextUint32(): number {
    this.assertActive();
    return this.random.nextUint32();
  }

  nextFloat(): number {
    this.assertActive();
    return this.random.nextFloat();
  }

  range(min: number, max: number): number {
    this.assertActive();
    return this.random.range(min, max);
  }

  chance(probability: number): boolean {
    this.assertActive();
    return this.random.chance(probability);
  }

  pick<T>(items: readonly T[]): T {
    this.assertActive();
    return this.random.pick(items);
  }

  snapshot(): Readonly<RandomSnapshot> {
    this.assertActive();
    return this.random.snapshot();
  }

  restore(snapshot: RandomSnapshot): void {
    this.assertActive();
    this.random.restore(snapshot);
  }

  restoreFromHub(snapshot: RandomSnapshot): void {
    this.random.restore(snapshot);
    this.active = true;
  }

  deactivate(origin: RandomSnapshot): void {
    this.random.restore(origin);
    this.active = false;
  }

  reactivate(): void {
    this.active = true;
  }

  snapshotFromHub(): Readonly<RandomSnapshot> {
    return this.random.snapshot();
  }

  get isActive(): boolean {
    return this.active;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('stream inativo após restore; solicite-o novamente ao RandomHub');
    }
  }
}

export class RandomHub {
  private readonly streams = new Map<string, ManagedStream>();

  constructor(readonly rootSeed: number) {
    assertUint32(rootSeed, 'rootSeed');
  }

  stream(name: string): RandomSource {
    validateName(name);
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new ManagedStream(new Xoshiro128StarStar(deriveSeed(this.rootSeed, name)));
      this.streams.set(name, stream);
    } else if (!stream.isActive) {
      stream.reactivate();
    }
    return stream;
  }

  snapshot(): Readonly<RandomHubSnapshot> {
    const streams = [...this.streams.entries()]
      .filter(([, random]) => random.isActive)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, random]) => ({ name, random: random.snapshotFromHub() }));
    return freezeHubSnapshot(this.rootSeed, streams);
  }

  restore(snapshot: RandomHubSnapshot): void {
    if (snapshot.algorithm !== RANDOM_HUB_ALGORITHM) {
      throw new RangeError(`algorithm incompatível: ${snapshot.algorithm}`);
    }
    if (snapshot.rootSeed !== this.rootSeed) {
      throw new RangeError(`rootSeed incompatível: ${snapshot.rootSeed}`);
    }

    const validated = new Map<string, Readonly<RandomSnapshot>>();
    for (const entry of snapshot.streams) {
      validateName(entry.name);
      if (validated.has(entry.name)) throw new RangeError(`stream duplicado: ${entry.name}`);
      const probe = new Xoshiro128StarStar(deriveSeed(this.rootSeed, entry.name));
      probe.restore(entry.random);
      validated.set(entry.name, probe.snapshot());
    }

    for (const [name, stream] of this.streams) {
      const saved = validated.get(name);
      if (saved) stream.restoreFromHub(saved);
      else {
        const origin = new Xoshiro128StarStar(deriveSeed(this.rootSeed, name));
        stream.deactivate(origin.snapshot());
      }
    }
    for (const [name, saved] of validated) {
      if (this.streams.has(name)) continue;
      const stream = new ManagedStream(new Xoshiro128StarStar(deriveSeed(this.rootSeed, name)));
      stream.restoreFromHub(saved);
      this.streams.set(name, stream);
    }
  }
}
