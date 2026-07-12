import { describe, expect, it } from 'vitest';
import { InputHub } from '../../core/input/InputHub';
import { FixedStepRunner } from '../../core/time/FixedStepRunner';
import type { ActionGestureEvent } from './ActionIntent';
import { ActionButtonMachine } from './ActionButtonMachine';

type ScheduledInput =
  | { readonly atMs: number; readonly kind: 'action'; readonly down: boolean }
  | { readonly atMs: number; readonly kind: 'move'; readonly x: number; readonly z: number }
  | { readonly atMs: number; readonly kind: 'cancel' };

function simulate(renderHz: number, inputs: readonly ScheduledInput[]): ActionGestureEvent[] {
  const runner = new FixedStepRunner();
  const hub = new InputHub();
  const machine = new ActionButtonMachine();
  const resolved: ActionGestureEvent[] = [];
  let queued = 0;

  runner.advance(0, { onTick: () => {} });
  const durationMs = 1_000;
  const frameCount = Math.ceil((durationMs / 1_000) * renderHz);
  for (let frame = 1; frame <= frameCount; frame += 1) {
    const nowMs = (frame * 1_000) / renderHz;
    while (queued < inputs.length && inputs[queued]!.atMs <= nowMs) {
      const event = inputs[queued++]!;
      if (event.kind === 'action') hub.setAction('keyboard', event.down, event.atMs);
      else if (event.kind === 'move')
        hub.setMove('keyboard', { right: event.x, up: event.z }, event.atMs);
      else hub.cancelAction('pause', event.atMs);
    }

    runner.advance(nowMs, {
      onTick: (ticket) => {
        const input = hub.consumeUntil(ticket.inputThroughMs);
        const gesture = machine.step({
          simulationTick: ticket.tick,
          token: 7,
          context: 'attack',
          legal: true,
          compatibleContact: false,
          lockedIllegal: false,
          actionDown: input.actionDown,
          direction: { x: input.screenAxis.right, z: input.screenAxis.up },
          actionEdges: input.actionEdges,
          cancellations: input.cancellations,
        });
        if (gesture) resolved.push(gesture);
      },
    });
  }

  return resolved;
}

describe('ActionButtonMachine no fixed timestep', () => {
  it('produz o mesmo hold, carga, direção e ticks renderizando a 30, 60 ou 120 Hz', () => {
    const inputs: ScheduledInput[] = [
      { atMs: 205, kind: 'action', down: true },
      { atMs: 350, kind: 'move', x: 0.6, z: 0.8 },
      { atMs: 605, kind: 'action', down: false },
    ];

    const at30 = simulate(30, inputs);
    const at60 = simulate(60, inputs);
    const at120 = simulate(120, inputs);

    expect(at30).toEqual(at60);
    expect(at120).toEqual(at60);
    expect(at60).toHaveLength(1);
    expect(at60[0]).toMatchObject({
      gesture: 'hold',
      direction: { x: 0.6, z: 0.8 },
      cause: 'release',
    });
  });

  it('cancelamento do InputHub não vaza carga e permite o próximo gesto', () => {
    const inputs: ScheduledInput[] = [
      { atMs: 105, kind: 'action', down: true },
      { atMs: 305, kind: 'cancel' },
      { atMs: 405, kind: 'action', down: true },
      { atMs: 485, kind: 'action', down: false },
    ];

    const events = simulate(60, inputs);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ gesture: 'tap', charge: 0, cause: 'release' });
  });
});
