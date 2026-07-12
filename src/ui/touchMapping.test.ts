import { describe, expect, it } from 'vitest';
import { screenAxisFromStick } from './touchMapping';

const RADIUS = 52;

describe('screenAxisFromStick', () => {
  it('mantém o centro e toda a deadzone radial em zero', () => {
    expect(screenAxisFromStick(0, 0, RADIUS)).toEqual({ right: 0, up: 0 });
    expect(screenAxisFromStick(RADIUS * 0.2, RADIUS * 0.2, RADIUS)).toEqual({
      right: 0,
      up: 0,
    });
  });

  it('mapeia direita e cima da tela para eixos positivos', () => {
    expect(screenAxisFromStick(RADIUS, 0, RADIUS)).toEqual({ right: 1, up: -0 });
    expect(screenAxisFromStick(0, -RADIUS, RADIUS)).toEqual({ right: 0, up: 1 });
  });

  it('remapeia suavemente o restante da deadzone até deflexão total', () => {
    const half = screenAxisFromStick(RADIUS * 0.675, 0, RADIUS);
    expect(half.right).toBeCloseTo(0.5);
    expect(half.up).toBeCloseTo(0);
  });

  it('normaliza diagonal e limita deslocamento além do raio', () => {
    const diagonal = screenAxisFromStick(RADIUS, -RADIUS, RADIUS);
    expect(Math.hypot(diagonal.right, diagonal.up)).toBeCloseTo(1);
    expect(diagonal.right).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal.up).toBeCloseTo(Math.SQRT1_2);
  });

  it('tolera raio inválido sem produzir NaN', () => {
    expect(screenAxisFromStick(10, -10, 0)).toEqual({ right: 0, up: 0 });
    expect(screenAxisFromStick(Number.NaN, 0, RADIUS)).toEqual({ right: 0, up: 0 });
  });
});
