import { describe, expect, it } from 'vitest';
import { InputHub } from './InputHub';
import { KeyboardInput } from './KeyboardInput';

function setup() {
  const hub = new InputHub();
  return { hub, keyboard: new KeyboardInput(hub) };
}

describe('KeyboardInput', () => {
  it('mapeia somente as setas para os eixos relativos à tela', () => {
    const { hub, keyboard } = setup();

    expect(keyboard.keyDown('ArrowUp', false, 1)).toBe(true);
    expect(keyboard.keyDown('ArrowRight', false, 2)).toBe(true);
    const axis = hub.consumeUntil(2).screenAxis;

    expect(Math.hypot(axis.right, axis.up)).toBeCloseTo(1);
    expect(axis.right).toBeCloseTo(Math.SQRT1_2);
    expect(axis.up).toBeCloseTo(Math.SQRT1_2);
  });

  it('cancela direções opostas e restaura a restante ao soltar', () => {
    const { hub, keyboard } = setup();

    keyboard.keyDown('ArrowLeft', false, 1);
    keyboard.keyDown('ArrowRight', false, 2);
    expect(hub.consumeUntil(2).screenAxis).toEqual({ right: 0, up: 0 });

    keyboard.keyUp('ArrowRight', 3);
    expect(hub.consumeUntil(3).screenAxis).toEqual({ right: -1, up: 0 });
  });

  it('ignora WASD e Escape completamente', () => {
    const { hub, keyboard } = setup();

    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']) {
      expect(keyboard.keyDown(code, false, 1)).toBe(false);
      expect(keyboard.keyUp(code, 2)).toBe(false);
    }

    expect(hub.consumeUntil(2)).toMatchObject({
      screenAxis: { right: 0, up: 0 },
      actionDown: false,
      actionEdges: [],
    });
  });

  it('emite uma única borda por pressão de Espaço e ignora auto-repeat', () => {
    const { hub, keyboard } = setup();

    expect(keyboard.keyDown('Space', false, 1)).toBe(true);
    expect(keyboard.keyDown('Space', true, 2)).toBe(true);
    expect(keyboard.keyDown('Space', false, 3)).toBe(true);
    expect(hub.consumeUntil(3).actionEdges.map((edge) => edge.kind)).toEqual(['press']);

    expect(keyboard.keyUp('Space', 4)).toBe(true);
    expect(hub.consumeUntil(4).actionEdges.map((edge) => edge.kind)).toEqual(['release']);
  });

  it('blur limpa estado físico e cancela sem fabricar release', () => {
    const { hub, keyboard } = setup();

    keyboard.keyDown('ArrowUp', false, 1);
    keyboard.keyDown('Space', false, 2);
    hub.consumeUntil(2);

    keyboard.cancel('blur', 3);
    const cancelled = hub.consumeUntil(3);
    expect(cancelled.screenAxis).toEqual({ right: 0, up: 0 });
    expect(cancelled.actionDown).toBe(false);
    expect(cancelled.actionEdges).toEqual([]);
    expect(cancelled.cancellations.map(({ reason }) => reason)).toEqual(['blur']);

    keyboard.keyUp('Space', 4);
    expect(hub.consumeUntil(4).actionEdges).toEqual([]);
  });
});
