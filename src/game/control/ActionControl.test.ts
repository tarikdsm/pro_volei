import { describe, expect, it } from 'vitest';
import type { ControlFrame } from './ControlFrame';
import { ActionControl } from './ActionControl';

let sequence = 0;

function frame(
  simulationTick: number,
  edge?: 'press' | 'release',
  actionDown = edge === 'press',
): ControlFrame {
  return {
    simulationTick,
    sampledAtMs: simulationTick * (1_000 / 60),
    screenAxis: { right: 0, up: 0 },
    courtAxis: { x: 0.6, z: 0.8 },
    actionDown,
    actionEdges: edge
      ? [
          {
            kind: edge,
            source: 'keyboard',
            atMs: simulationTick * (1_000 / 60),
            sequence: sequence++,
          },
        ]
      : [],
    cancellations: [],
  };
}

describe('ActionControl', () => {
  it('abre a janela pelo contexto e consome buffer no primeiro tick legal', () => {
    const control = new ActionControl();

    expect(
      control.step(frame(0, 'press', true), {
        token: 7,
        context: 'receive',
        contactInTicks: 49,
        compatibleContact: false,
        lockedIllegal: false,
      }),
    ).toBe(null);
    control.step(frame(1, 'release'), {
      token: 7,
      context: 'receive',
      contactInTicks: 49,
      compatibleContact: false,
      lockedIllegal: false,
    });

    const intent = control.step(frame(2), {
      token: 7,
      context: 'receive',
      contactInTicks: 48,
      compatibleContact: false,
      lockedIllegal: false,
    });

    expect(intent).toMatchObject({
      token: 7,
      context: 'receive',
      gesture: 'tap',
      technique: 'platform-pass',
      cause: 'buffer',
    });
  });

  it('guarda intenção one-shot até a mecânica consumir token e contexto compatíveis', () => {
    const control = new ActionControl();
    control.step(frame(0, 'press', true), {
      token: 9,
      context: 'set',
      contactInTicks: 20,
      compatibleContact: false,
      lockedIllegal: false,
    });
    control.step(frame(2, 'release'), {
      token: 9,
      context: 'set',
      contactInTicks: 18,
      compatibleContact: false,
      lockedIllegal: false,
    });

    expect(control.take(8, 'set')).toBe(null);
    expect(control.peek()).toMatchObject({ token: 9, technique: 'high-set' });
    expect(control.take(9, 'receive')).toBe(null);
    expect(control.take(9, 'set')).toMatchObject({ token: 9, technique: 'high-set' });
    expect(control.peek()).toBe(null);
    expect(control.snapshot()).toMatchObject({
      lastTechnique: 'high-set',
      lastGesture: 'tap',
      lastCharge: 0,
      lastResolvedToken: 9,
    });
  });

  it('contato compatível resolve hold com a carga atual', () => {
    const control = new ActionControl();
    control.step(frame(0, 'press', true), {
      token: 11,
      context: 'attack',
      contactInTicks: 30,
      compatibleContact: false,
      lockedIllegal: false,
    });

    const intent = control.step(frame(27, undefined, true), {
      token: 11,
      context: 'attack',
      contactInTicks: 0,
      compatibleContact: true,
      lockedIllegal: false,
    });

    expect(intent).toMatchObject({ gesture: 'hold', technique: 'power-spike', charge: 0.5 });
    expect(control.snapshot()).toMatchObject({ lastGesture: 'hold', lastCharge: 0.5 });
  });

  it('cancelamento de lifecycle revoga pending e permite retry do mesmo token', () => {
    const control = new ActionControl();
    const request = {
      token: 13,
      context: 'freeball' as const,
      contactInTicks: 20,
      compatibleContact: false,
      lockedIllegal: false,
    };
    control.step(frame(0, 'press', true), request);
    control.step(frame(1, 'release'), request);
    expect(control.peek()).not.toBe(null);

    control.cancel('pause');
    expect(control.peek()).toBe(null);
    expect(control.snapshot()).toMatchObject({
      token: null,
      status: 'idle',
      lastCancellation: 'pause',
      pendingTechnique: null,
      lastTechnique: 'safe-save',
    });

    control.step(frame(2, 'press', true), request);
    expect(control.step(frame(3, 'release'), request)).not.toBe(null);
  });
});
