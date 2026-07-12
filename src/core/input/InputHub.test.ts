import { describe, expect, it } from 'vitest';
import { InputHub } from './InputHub';

describe('InputHub — fila temporal', () => {
  it('preserva múltiplas bordas no mesmo tick em ordem de timestamp e sequência', () => {
    const hub = new InputHub();

    hub.setAction('keyboard', true, 12);
    hub.setAction('keyboard', false, 14);
    hub.setAction('keyboard', true, 14);

    const frame = hub.consumeUntil(20);

    expect(frame.actionEdges.map(({ kind, atMs }) => ({ kind, atMs }))).toEqual([
      { kind: 'press', atMs: 12 },
      { kind: 'release', atMs: 14 },
      { kind: 'press', atMs: 14 },
    ]);
    expect(frame.actionEdges[1]!.sequence).toBeLessThan(frame.actionEdges[2]!.sequence);
    expect(frame.actionDown).toBe(true);
  });

  it('ordena eventos recebidos fora de ordem e mantém os futuros na fila', () => {
    const hub = new InputHub();

    hub.setAction('keyboard', true, 30);
    hub.setAction('keyboard', false, 40);
    hub.setAction('touch', true, 20);

    const first = hub.consumeUntil(25);
    const second = hub.consumeUntil(35);
    const third = hub.consumeUntil(45);

    expect(first.actionEdges.map((edge) => [edge.kind, edge.atMs])).toEqual([['press', 20]]);
    expect(second.actionEdges).toEqual([]);
    expect(second.actionDown).toBe(true);
    expect(third.actionEdges.map((edge) => [edge.kind, edge.atMs])).toEqual([]);
    expect(third.actionDown).toBe(true);
  });

  it('consome cada borda exatamente uma vez', () => {
    const hub = new InputHub();
    hub.setAction('keyboard', true, 5);
    hub.setAction('keyboard', false, 8);

    expect(hub.consumeUntil(10).actionEdges).toHaveLength(2);
    expect(hub.consumeUntil(10).actionEdges).toEqual([]);
    expect(hub.consumeUntil(11).actionEdges).toEqual([]);
  });

  it('ignora auto-repeat representado por estados de ação duplicados', () => {
    const hub = new InputHub();

    hub.setAction('keyboard', true, 1);
    hub.setAction('keyboard', true, 2);
    hub.setAction('keyboard', true, 3);

    const frame = hub.consumeUntil(3);
    expect(frame.actionEdges.map((edge) => edge.kind)).toEqual(['press']);
  });

  it('recusa consumo temporal regressivo', () => {
    const hub = new InputHub();
    hub.consumeUntil(10);

    expect(() => hub.consumeUntil(9)).toThrow(RangeError);
  });
});

describe('InputHub — composição de fontes', () => {
  it('compõe a ação por OR sem release falso entre teclado e touch', () => {
    const hub = new InputHub();

    hub.setAction('keyboard', true, 1);
    hub.setAction('touch', true, 2);
    hub.setAction('keyboard', false, 3);

    const held = hub.consumeUntil(3);
    expect(held.actionEdges.map((edge) => edge.kind)).toEqual(['press']);
    expect(held.actionDown).toBe(true);

    hub.setAction('touch', false, 4);
    const released = hub.consumeUntil(4);
    expect(released.actionEdges.map((edge) => edge.kind)).toEqual(['release']);
    expect(released.actionDown).toBe(false);
  });

  it('usa o movimento não neutro alterado mais recentemente sem somar fontes', () => {
    const hub = new InputHub();

    hub.setMove('keyboard', { right: 1, up: 0 }, 1);
    hub.setMove('touch', { right: 0, up: 1 }, 2);
    expect(hub.consumeUntil(2).screenAxis).toEqual({ right: 0, up: 1 });

    hub.setMove('touch', { right: 0, up: 0 }, 3);
    expect(hub.consumeUntil(3).screenAxis).toEqual({ right: 1, up: 0 });
  });

  it('não promove uma fonte por repetir o mesmo movimento', () => {
    const hub = new InputHub();

    hub.setMove('keyboard', { right: 1, up: 0 }, 1);
    hub.setMove('touch', { right: 0, up: 1 }, 2);
    hub.setMove('keyboard', { right: 1, up: 0 }, 3);

    expect(hub.consumeUntil(3).screenAxis).toEqual({ right: 0, up: 1 });
  });

  it('arbitra movimento pela linha do tempo mesmo quando os eventos chegam fora de ordem', () => {
    const hub = new InputHub();

    hub.setMove('keyboard', { right: 1, up: 0 }, 20);
    hub.setMove('touch', { right: 0, up: 1 }, 10);

    expect(hub.consumeUntil(20).screenAxis).toEqual({ right: 1, up: 0 });
  });

  it('normaliza diagonais e nunca entrega módulo superior a 1', () => {
    const hub = new InputHub();
    hub.setMove('touch', { right: 8, up: -8 }, 1);

    const axis = hub.consumeUntil(1).screenAxis;
    expect(Math.hypot(axis.right, axis.up)).toBeCloseTo(1);
    expect(axis.right).toBeCloseTo(Math.SQRT1_2);
    expect(axis.up).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe('InputHub — cancelamento', () => {
  it('limpa todas as fontes sem fabricar release', () => {
    const hub = new InputHub();
    hub.setMove('keyboard', { right: 1, up: 0 }, 1);
    hub.setMove('touch', { right: 0, up: 1 }, 2);
    hub.setAction('keyboard', true, 3);
    hub.setAction('touch', true, 4);
    hub.consumeUntil(4);

    hub.cancel('blur', 5);
    const cancelled = hub.consumeUntil(5);

    expect(cancelled.actionDown).toBe(false);
    expect(cancelled.actionEdges).toEqual([]);
    expect(cancelled.screenAxis).toEqual({ right: 0, up: 0 });
    expect(cancelled.cancellations).toEqual([expect.objectContaining({ reason: 'blur', atMs: 5 })]);

    hub.setAction('keyboard', true, 6);
    hub.setMove('touch', { right: -1, up: 0 }, 6);
    const resumed = hub.consumeUntil(6);
    expect(resumed.actionEdges.map((edge) => edge.kind)).toEqual(['press']);
    expect(resumed.screenAxis).toEqual({ right: -1, up: 0 });
  });

  it('ordena cancelamentos empatados por sequência e os consome uma vez', () => {
    const hub = new InputHub();

    hub.cancel('pause', 7);
    hub.cancel('portrait', 7);

    const frame = hub.consumeUntil(7);
    expect(frame.cancellations.map((item) => item.reason)).toEqual(['pause', 'portrait']);
    expect(frame.cancellations[0]!.sequence).toBeLessThan(frame.cancellations[1]!.sequence);
    expect(hub.consumeUntil(7).cancellations).toEqual([]);
  });
});
