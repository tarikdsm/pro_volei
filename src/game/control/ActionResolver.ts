import { ACTION_BUTTON } from '../../core/constants';
import type {
  ActionContext,
  ActionDirection,
  ActionGesture,
  ActionGestureEvent,
  ActionIntent,
  ActionTechnique,
} from './ActionIntent';

interface SemanticParameters {
  readonly power: number;
  readonly reach: number;
  readonly precision: number;
  readonly penetration: number;
}

interface ActionRule {
  readonly technique: ActionTechnique;
  readonly chargedTechnique?: ActionTechnique;
  readonly empty: SemanticParameters;
  readonly full: SemanticParameters;
}

const RULES = {
  serve: {
    tap: rule('float-serve', [0.45, 0.3, 0.94, 0.1]),
    hold: rule('power-serve', [0.55, 0.5, 0.9, 0.25], [1, 1, 0.55, 0.8]),
  },
  receive: {
    tap: rule('platform-pass', [0.45, 0.35, 0.96, 0]),
    hold: rule('emergency-dive', [0.35, 0.55, 0.82, 0], [0.55, 1, 0.48, 0]),
  },
  set: {
    tap: rule('high-set', [0.55, 0.35, 0.96, 0]),
    hold: rule('quick-set', [0.55, 0.35, 0.88, 0.05], [0.8, 0.6, 0.62, 0.2]),
  },
  attack: {
    tap: rule('tip', [0.28, 0.25, 0.98, 0.15], undefined, 'placed-shot'),
    hold: rule('power-spike', [0.6, 0.45, 0.88, 0.5], [1, 0.75, 0.5, 1]),
  },
  block: {
    tap: rule('quick-block', [0.2, 0.55, 0.9, 0.3]),
    hold: rule('penetrating-block', [0.25, 0.55, 0.86, 0.45], [0.5, 0.95, 0.56, 1]),
  },
  freeball: {
    tap: rule('safe-save', [0.4, 0.45, 0.96, 0.05]),
    hold: rule('reaching-freeball', [0.45, 0.55, 0.84, 0.1], [0.75, 1, 0.52, 0.3]),
  },
} as const satisfies Readonly<Record<ActionContext, Readonly<Record<ActionGesture, ActionRule>>>>;

/** Converte o gesto one-shot em uma intenção semântica, sem física, RNG ou efeitos. */
export function resolveAction(event: ActionGestureEvent): ActionIntent {
  const contextRules = RULES[event.context];
  if (contextRules === undefined) {
    throw new RangeError(`Contexto de ação incompatível: ${String(event.context)}`);
  }

  const charge = event.gesture === 'tap' ? 0 : normalizeCharge(event.charge);
  const direction = normalizeDirection(event.direction);
  const rule = contextRules[event.gesture];
  const parameters = interpolateParameters(rule.empty, rule.full, charge);
  const technique =
    rule.chargedTechnique !== undefined && isDeliberate(direction)
      ? rule.chargedTechnique
      : rule.technique;

  return Object.freeze({
    token: event.token,
    context: event.context,
    gesture: event.gesture,
    charge,
    direction,
    pressedTick: event.pressedTick,
    resolvedTick: event.resolvedTick,
    cause: event.cause,
    technique,
    ...parameters,
  });
}

function rule(
  technique: ActionTechnique,
  empty: readonly [number, number, number, number],
  full = empty,
  chargedTechnique?: ActionTechnique,
): ActionRule {
  return {
    technique,
    chargedTechnique,
    empty: parameters(empty),
    full: parameters(full),
  };
}

function parameters(values: readonly [number, number, number, number]): SemanticParameters {
  return {
    power: values[0],
    reach: values[1],
    precision: values[2],
    penetration: values[3],
  };
}

function normalizeCharge(charge: number): number {
  if (!Number.isFinite(charge)) return 0;
  return clamp01(charge);
}

function normalizeDirection(direction: ActionDirection): Readonly<ActionDirection> {
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.z)) return neutralDirection();

  const magnitude = Math.hypot(direction.x, direction.z);
  if (!Number.isFinite(magnitude) || magnitude < ACTION_BUTTON.deliberateDirection) {
    return neutralDirection();
  }

  return Object.freeze({ x: direction.x / magnitude, z: direction.z / magnitude });
}

function neutralDirection(): Readonly<ActionDirection> {
  return Object.freeze({ x: 0, z: 0 });
}

function isDeliberate(direction: ActionDirection): boolean {
  return direction.x !== 0 || direction.z !== 0;
}

function interpolateParameters(
  empty: SemanticParameters,
  full: SemanticParameters,
  charge: number,
): SemanticParameters {
  return {
    power: interpolateUnit(empty.power, full.power, charge),
    reach: interpolateUnit(empty.reach, full.reach, charge),
    precision: interpolateUnit(empty.precision, full.precision, charge),
    penetration: interpolateUnit(empty.penetration, full.penetration, charge),
  };
}

function interpolateUnit(from: number, to: number, amount: number): number {
  return clamp01(from + (to - from) * amount);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
