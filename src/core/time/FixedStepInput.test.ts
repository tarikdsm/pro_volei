import { describe, expect, it } from 'vitest';
import { InputHub } from '../input/InputHub';
import { FixedStepRunner } from './FixedStepRunner';

type ScheduledInput =
  | { atMs: number; kind: 'move'; right: number; up: number }
  | { atMs: number; kind: 'action'; down: boolean };

const INPUTS: ScheduledInput[] = [
  { atMs: 100, kind: 'move', right: 1, up: 0 },
  { atMs: 205, kind: 'action', down: true },
  { atMs: 240, kind: 'action', down: false },
  { atMs: 350, kind: 'move', right: 0, up: 1 },
  { atMs: 600, kind: 'move', right: 0, up: 0 },
];

function simulate(renderHz: number) {
  const runner = new FixedStepRunner();
  const input = new InputHub();
  let queued = 0;
  let x = 0;
  let z = 0;
  const actionTicks: Array<[number, string]> = [];

  runner.advance(0, { onTick: () => {} });
  for (let frame = 1; frame <= renderHz; frame++) {
    const nowMs = (frame * 1000) / renderHz;
    while (queued < INPUTS.length && INPUTS[queued]!.atMs <= nowMs) {
      const event = INPUTS[queued++]!;
      if (event.kind === 'move') {
        input.setMove('keyboard', { right: event.right, up: event.up }, event.atMs);
      } else {
        input.setAction('keyboard', event.down, event.atMs);
      }
    }

    runner.advance(nowMs, {
      onTick: (ticket) => {
        const frameInput = input.consumeUntil(ticket.inputThroughMs);
        x += frameInput.screenAxis.right * ticket.dt;
        z += frameInput.screenAxis.up * ticket.dt;
        for (const edge of frameInput.actionEdges) actionTicks.push([ticket.tick, edge.kind]);
      },
    });
  }

  return { x, z, actionTicks };
}

describe('FixedStepRunner + InputHub', () => {
  it('produz o mesmo estado e ticks de ação renderizando a 30, 60 ou 120 Hz', () => {
    const at30 = simulate(30);
    const at60 = simulate(60);
    const at120 = simulate(120);

    expect(at30.x).toBeCloseTo(at60.x, 12);
    expect(at30.z).toBeCloseTo(at60.z, 12);
    expect(at120.x).toBeCloseTo(at60.x, 12);
    expect(at120.z).toBeCloseTo(at60.z, 12);
    expect(at30.actionTicks).toEqual(at60.actionTicks);
    expect(at120.actionTicks).toEqual(at60.actionTicks);
  });
});
