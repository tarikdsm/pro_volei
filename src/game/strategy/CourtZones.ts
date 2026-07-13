import { COURT, TeamSide } from '../../core/constants';
import type { StrategyDecisionKind, StrategyOptionId, StrategyPoint2 } from './StrategyTypes';

export interface CanonicalStrategyOption {
  readonly optionId: StrategyOptionId;
  readonly kind: StrategyDecisionKind;
  readonly family: string;
  readonly center: StrategyPoint2;
  readonly halfSize: StrategyPoint2;
}

export interface CanonicalOptionContext {
  /** Origem z no referencial local do lado atacante. */
  readonly attackOriginZ?: number;
}

const X_MARGIN = 0.35;
const Z_MARGIN = 0.3;

function option(
  optionId: StrategyOptionId,
  family: string,
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
): CanonicalStrategyOption {
  return Object.freeze({
    optionId,
    kind: optionId.slice(0, optionId.indexOf('.')) as StrategyDecisionKind,
    family,
    center: Object.freeze({ x, z }),
    halfSize: Object.freeze({ x: halfX, z: halfZ }),
  });
}

function corridorZ(corridor: 'left' | 'center' | 'right'): number {
  return corridor === 'left' ? -3 : corridor === 'right' ? 3 : 0;
}

function serveOptions(): CanonicalStrategyOption[] {
  const result: CanonicalStrategyOption[] = [];
  for (const family of ['float-deep', 'float-short', 'power-deep'] as const) {
    for (const corridor of ['center', 'left', 'right'] as const) {
      const deep = family !== 'float-short';
      result.push(
        option(
          `serve.${family}.${corridor}`,
          family,
          deep ? 7.25 : 3.45,
          corridorZ(corridor),
          deep ? 1.15 : 0.85,
          corridor === 'center' ? 0.8 : 0.65,
        ),
      );
    }
  }
  return result;
}

function setOptions(): CanonicalStrategyOption[] {
  return [
    option('set.accelerated-left', 'accelerated', -0.95, -2.85, 0.18, 0.24),
    option('set.accelerated-right', 'accelerated', -0.95, 2.85, 0.18, 0.24),
    option('set.high-left', 'high', -1.05, -3.15, 0.24, 0.3),
    option('set.high-right', 'high', -1.05, 3.15, 0.24, 0.3),
    option('set.quick-center', 'quick', -0.82, 0, 0.14, 0.28),
  ];
}

function attackOptions(contactZ: number): CanonicalStrategyOption[] {
  const lineSign = contactZ < -0.25 ? -1 : contactZ > 0.25 ? 1 : 1;
  return [
    option('attack.placed-cross', 'placed', 6.15, -lineSign * 2.85, 1.15, 0.72),
    option('attack.placed-line', 'placed', 6.15, lineSign * 3.3, 1.15, 0.55),
    option('attack.placed-seam', 'placed', 5.65, 0, 1.05, 0.72),
    option('attack.power-cross-deep', 'power', 7.55, -lineSign * 2.85, 0.9, 0.65),
    option('attack.power-line-deep', 'power', 7.55, lineSign * 3.25, 0.9, 0.55),
    option('attack.tip-short-center', 'tip', 2.55, 0, 0.75, 0.7),
    option('attack.tip-short-left', 'tip', 2.65, -2.65, 0.75, 0.65),
    option('attack.tip-short-right', 'tip', 2.65, 2.65, 0.75, 0.65),
  ];
}

export function canonicalStrategyOptions(
  kind: StrategyDecisionKind,
  context: CanonicalOptionContext = {},
): readonly CanonicalStrategyOption[] {
  if (kind === 'attack' && !Number.isFinite(context.attackOriginZ)) {
    throw new RangeError('Ataque exige attackOriginZ local finito');
  }
  const options =
    kind === 'serve'
      ? serveOptions()
      : kind === 'set'
        ? setOptions()
        : attackOptions(context.attackOriginZ!);
  return Object.freeze(
    options.sort((a, b) => (a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0)),
  );
}

/** Referencial canônico: o próprio lado fica em x negativo e o adversário em x positivo. */
export function strategyToLocal(point: StrategyPoint2, side: TeamSide): StrategyPoint2 {
  return Object.freeze(
    side === TeamSide.HOME ? { x: point.x, z: point.z } : { x: -point.x, z: -point.z },
  );
}

export function strategyToWorld(point: StrategyPoint2, side: TeamSide): StrategyPoint2 {
  return strategyToLocal(point, side);
}

function hashKey(seed: number, key: string, salt: number): number {
  let hash = (0x811c_9dc5 ^ seed ^ salt) >>> 0;
  for (let index = 0; index < key.length; index++) {
    const code = key.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x0100_0193) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), 0x0100_0193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb_352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846c_a68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(value: number): number {
  return value / 0x1_0000_0000;
}

export function strategySubtarget(
  candidate: CanonicalStrategyOption,
  variation: number,
): StrategyPoint2 {
  if (!Number.isInteger(variation) || variation < 0 || variation > 0xffff_ffff) {
    throw new RangeError('variation deve ser uint32');
  }
  const offsetX = unit(hashKey(variation, candidate.optionId, 0x58_31_9a_07)) * 2 - 1;
  const offsetZ = unit(hashKey(variation, candidate.optionId, 0xa7_04_2d_69)) * 2 - 1;
  const x = Math.max(
    -COURT.halfLength + X_MARGIN,
    Math.min(COURT.halfLength - X_MARGIN, candidate.center.x + offsetX * candidate.halfSize.x),
  );
  const z = Math.max(
    -COURT.halfWidth + Z_MARGIN,
    Math.min(COURT.halfWidth - Z_MARGIN, candidate.center.z + offsetZ * candidate.halfSize.z),
  );
  return Object.freeze({ x, z });
}
