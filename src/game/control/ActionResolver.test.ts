import { describe, expect, it } from 'vitest';
import { ACTION_BUTTON } from '../../core/constants';
import type {
  ActionContext,
  ActionGesture,
  ActionGestureEvent,
  ActionTechnique,
} from './ActionIntent';
import { resolveAction } from './ActionResolver';

function gesture(
  context: ActionContext,
  actionGesture: ActionGesture,
  overrides: Partial<ActionGestureEvent> = {},
): ActionGestureEvent {
  return {
    token: 7,
    context,
    gesture: actionGesture,
    charge: actionGesture === 'tap' ? 0 : 0.6,
    direction: { x: 0.6, z: 0.8 },
    pressedTick: 100,
    resolvedTick: 124,
    cause: 'release',
    ...overrides,
  };
}

const TECHNIQUES: ReadonlyArray<readonly [ActionContext, ActionGesture, ActionTechnique]> = [
  ['serve', 'tap', 'float-serve'],
  ['serve', 'hold', 'power-serve'],
  ['receive', 'tap', 'platform-pass'],
  ['receive', 'hold', 'emergency-dive'],
  ['set', 'tap', 'high-set'],
  ['set', 'hold', 'quick-set'],
  ['attack', 'tap', 'placed-shot'],
  ['attack', 'hold', 'power-spike'],
  ['block', 'tap', 'quick-block'],
  ['block', 'hold', 'penetrating-block'],
  ['freeball', 'tap', 'safe-save'],
  ['freeball', 'hold', 'reaching-freeball'],
];

describe('resolveAction — matriz contextual', () => {
  it.each(TECHNIQUES)('%s + %s produz %s', (context, actionGesture, technique) => {
    expect(resolveAction(gesture(context, actionGesture)).technique).toBe(technique);
  });

  it('transforma tap neutro de ataque em tip e mantém tap direcionado como placed-shot', () => {
    expect(resolveAction(gesture('attack', 'tap', { direction: { x: 0, z: 0 } })).technique).toBe(
      'tip',
    );
    expect(resolveAction(gesture('attack', 'tap')).technique).toBe('placed-shot');
  });

  it('rejeita contexto incompatível em runtime', () => {
    const incompatible = gesture('serve', 'tap', {
      context: 'penalty-kick' as ActionContext,
    });

    expect(() => resolveAction(incompatible)).toThrowError(/contexto de ação incompatível/i);
  });
});

describe('resolveAction — normalização', () => {
  it('normaliza direção deliberada e não altera o DTO de entrada', () => {
    const event = gesture('serve', 'tap', { direction: { x: 3, z: 4 } });
    const intent = resolveAction(event);

    expect(intent.direction).toEqual({ x: 0.6, z: 0.8 });
    expect(Math.hypot(intent.direction.x, intent.direction.z)).toBeCloseTo(1, 12);
    expect(event.direction).toEqual({ x: 3, z: 4 });
  });

  it('considera deliberada a direção no limiar inclusivo de 0,35', () => {
    const below = resolveAction(
      gesture('serve', 'tap', {
        direction: { x: ACTION_BUTTON.deliberateDirection - 0.000_001, z: 0 },
      }),
    );
    const atThreshold = resolveAction(
      gesture('serve', 'tap', {
        direction: { x: ACTION_BUTTON.deliberateDirection, z: 0 },
      }),
    );

    expect(below.direction).toEqual({ x: 0, z: 0 });
    expect(atThreshold.direction).toEqual({ x: 1, z: 0 });
  });

  it('preserva direção neutra para o alvo seguro recomendado', () => {
    expect(
      resolveAction(gesture('receive', 'tap', { direction: { x: 0.2, z: -0.2 } })).direction,
    ).toEqual({ x: 0, z: 0 });
  });

  it.each([
    [-2, 0],
    [Number.NaN, 0],
    [0.4, 0.4],
    [2, 1],
    [Number.POSITIVE_INFINITY, 0],
  ])('limita carga %s para %s', (charge, expected) => {
    expect(resolveAction(gesture('serve', 'hold', { charge })).charge).toBe(expected);
  });

  it('normaliza tap para carga zero mesmo quando o DTO externo está inconsistente', () => {
    expect(resolveAction(gesture('serve', 'tap', { charge: 1 })).charge).toBe(0);
  });
});

describe('resolveAction — parâmetros semânticos', () => {
  it.each(TECHNIQUES)('%s + %s mantém todos os parâmetros em [0, 1]', (context, actionGesture) => {
    for (const charge of [-10, 0, 0.37, 1, 10]) {
      const intent = resolveAction(gesture(context, actionGesture, { charge }));

      for (const value of [intent.power, intent.reach, intent.precision, intent.penetration]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each<ActionContext>(['serve', 'receive', 'set', 'attack', 'block', 'freeball'])(
    'hold em %s varia continuamente entre carga vazia e cheia',
    (context) => {
      const empty = resolveAction(gesture(context, 'hold', { charge: 0 }));
      const half = resolveAction(gesture(context, 'hold', { charge: 0.5 }));
      const full = resolveAction(gesture(context, 'hold', { charge: 1 }));

      for (const parameter of ['power', 'reach', 'precision', 'penetration'] as const) {
        expect(half[parameter]).toBeCloseTo((empty[parameter] + full[parameter]) / 2, 12);
      }
    },
  );

  it('a carga aumenta potência/alcance/penetração e cobra precisão no power-spike', () => {
    const empty = resolveAction(gesture('attack', 'hold', { charge: 0 }));
    const full = resolveAction(gesture('attack', 'hold', { charge: 1 }));

    expect(full.power).toBeGreaterThan(empty.power);
    expect(full.reach).toBeGreaterThan(empty.reach);
    expect(full.penetration).toBeGreaterThan(empty.penetration);
    expect(full.precision).toBeLessThan(empty.precision);
  });
});

describe('resolveAction — contrato do DTO', () => {
  it('preserva metadados do gesto e congela intenção e direção', () => {
    const event = gesture('set', 'hold', {
      token: 99,
      pressedTick: 20,
      resolvedTick: 50,
      cause: 'contact',
    });
    const intent = resolveAction(event);

    expect(intent).toMatchObject({
      token: 99,
      context: 'set',
      gesture: 'hold',
      pressedTick: 20,
      resolvedTick: 50,
      cause: 'contact',
    });
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.direction)).toBe(true);
  });

  it('produz intenção idêntica para o mesmo gesto semântico vindo de teclado ou touch', () => {
    const keyboard = gesture('freeball', 'hold', {
      direction: { x: -0.4, z: 0.7 },
      charge: 0.73,
    });
    const touch = {
      ...keyboard,
      direction: { ...keyboard.direction },
    } satisfies ActionGestureEvent;

    expect(resolveAction(keyboard)).toEqual(resolveAction(touch));
  });
});
