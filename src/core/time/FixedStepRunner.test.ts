import { describe, expect, it, vi } from 'vitest';
import { SIMULATION_TIMING } from '../constants';
import { FixedStepRunner, type FixedStepDiscard, type FixedStepTicket } from './FixedStepRunner';
import { SlowMotionClock } from './SlowMotionClock';

const STEP = 1 / SIMULATION_TIMING.hz;

function runSchedule(hz: number): FixedStepTicket[] {
  const runner = new FixedStepRunner();
  const tickets: FixedStepTicket[] = [];
  runner.advance(0, { onTick: (ticket) => tickets.push(ticket) });
  for (let frame = 1; frame <= hz; frame++) {
    runner.advance((frame * 1000) / hz, {
      onTick: (ticket) => tickets.push(ticket),
    });
  }
  return tickets;
}

describe('FixedStepRunner', () => {
  it.each([30, 60, 120])('executa exatamente 60 ticks em um segundo renderizado a %i Hz', (hz) => {
    const tickets = runSchedule(hz);

    expect(tickets).toHaveLength(60);
    expect(tickets.every((ticket) => ticket.dt === STEP)).toBe(true);
    expect(tickets.at(-1)?.simulationSeconds).toBeCloseTo(1, 12);
  });

  it('não simula na primeira frame e ancora seu cutoff real', () => {
    const runner = new FixedStepRunner();
    const onTick = vi.fn();

    const frame = runner.advance(1250, { onTick });

    expect(onTick).not.toHaveBeenCalled();
    expect(frame).toMatchObject({ steps: 0, alpha: 0, tick: 0, inputThroughMs: 1250 });
  });

  it('expõe alpha do backlog fracionário sem executar passo parcial', () => {
    const runner = new FixedStepRunner();
    runner.advance(0, { onTick: vi.fn() });

    const half = runner.advance((STEP * 1000) / 2, { onTick: vi.fn() });
    const full = runner.advance(STEP * 1000, { onTick: vi.fn() });

    expect(half.steps).toBe(0);
    expect(half.alpha).toBeCloseTo(0.5, 12);
    expect(full.steps).toBe(1);
    expect(full.alpha).toBeCloseTo(0, 12);
  });

  it('ignora timestamp regressivo sem regredir cutoff nem inventar tempo', () => {
    const runner = new FixedStepRunner();
    const cutoffs: number[] = [];
    const collect = (ticket: FixedStepTicket): void => {
      cutoffs.push(ticket.inputThroughMs);
    };
    runner.advance(100, { onTick: collect });
    runner.advance(100 + STEP * 1000, { onTick: collect });

    const regressive = runner.advance(90, { onTick: collect });
    runner.advance(100 + STEP * 2000, { onTick: collect });

    expect(regressive.steps).toBe(0);
    expect(regressive.inputThroughMs).toBeCloseTo(100 + STEP * 1000, 12);
    expect(cutoffs).toHaveLength(2);
    expect(cutoffs[1]).toBeGreaterThanOrEqual(cutoffs[0]);
  });

  it('pausa sem ticks, zera o backlog e drena cutoff sem avançar slow motion', () => {
    const clock = new SlowMotionClock();
    clock.trigger(0.5, 1);
    const runner = new FixedStepRunner(clock);
    const onTick = vi.fn();
    runner.advance(0, { onTick });
    const partial = runner.advance(10, { onTick });

    const paused = runner.advance(1010, { paused: true, onTick });
    const stillPaused = runner.advance(2010, { paused: true, onTick });
    const resumed = runner.advance(2010 + STEP * 2000, { onTick });

    expect(partial.alpha).toBeCloseTo(0.3, 12);
    expect(paused).toMatchObject({ steps: 0, alpha: 0, inputThroughMs: 1010 });
    expect(stillPaused).toMatchObject({ steps: 0, alpha: 0, inputThroughMs: 2010 });
    expect(resumed.steps).toBe(1);
    expect(clock.secondsUntilBoundary).toBeCloseTo(1 - 10 / 1000 - STEP * 2, 12);
  });

  it('observa no restante do mesmo frame a slow motion acionada pelo callback de tick', () => {
    const clock = new SlowMotionClock();
    const runner = new FixedStepRunner(clock);
    const cutoffs: number[] = [];
    runner.advance(0, { onTick: vi.fn() });

    const frame = runner.advance(50, {
      onTick: (ticket) => {
        cutoffs.push(ticket.inputThroughMs);
        if (ticket.tick === 1) clock.trigger(0.5, 1);
      },
    });

    expect(frame.steps).toBe(2);
    expect(cutoffs[0]).toBeCloseTo(STEP * 1000, 9);
    expect(cutoffs[1]).toBeCloseTo(50, 9);
    expect(frame.alpha).toBeCloseTo(0, 9);
  });

  it('segmenta uma fronteira de slow motion no meio do frame', () => {
    const clock = new SlowMotionClock();
    clock.trigger(0.5, 0.02);
    const runner = new FixedStepRunner(clock);
    const cutoffs: number[] = [];
    runner.advance(0, { onTick: vi.fn() });

    const frame = runner.advance(50, {
      onTick: (ticket) => cutoffs.push(ticket.inputThroughMs),
    });

    expect(frame.steps).toBe(2);
    expect(cutoffs).toEqual([expect.closeTo(26.6666666667, 8), expect.closeTo(43.3333333333, 8)]);
    expect(frame.alpha).toBeCloseTo(0.4, 9);
    expect(clock.scale).toBe(1);
  });

  it('descarta o prefixo acima de 250 ms e o restante depois de cinco ticks', () => {
    const runner = new FixedStepRunner();
    const discards: FixedStepDiscard[] = [];
    const cutoffs: number[] = [];
    runner.advance(0, { onTick: vi.fn() });

    const frame = runner.advance(1000, {
      onTick: (ticket) => cutoffs.push(ticket.inputThroughMs),
      onDiscard: (discard) => discards.push(discard),
    });

    expect(frame.steps).toBe(5);
    expect(cutoffs[0]).toBeCloseTo(750 + STEP * 1000, 8);
    expect(cutoffs.at(-1)).toBeCloseTo(750 + STEP * 5000, 8);
    expect(discards).toHaveLength(2);
    expect(discards[0]).toMatchObject({ reason: 'wall-cap', fromMs: 0, toMs: 750 });
    expect(discards[0].wallSeconds).toBeCloseTo(0.75, 12);
    expect(discards[0].simulationSeconds).toBeCloseTo(0.75, 12);
    expect(discards[1].reason).toBe('step-cap');
    expect(discards[1].fromMs).toBeCloseTo(750 + STEP * 5000, 8);
    expect(discards[1].toMs).toBe(1000);
    expect(frame.discardedWallSeconds).toBeCloseTo(1 - STEP * 5, 12);
    expect(frame.discardedSimulationSeconds).toBeCloseTo(1 - STEP * 5, 12);
    expect(frame.diagnostics).toEqual({
      discardCount: 2,
      discardedWallSeconds: expect.closeTo(1 - STEP * 5, 12),
      discardedSimulationSeconds: expect.closeTo(1 - STEP * 5, 12),
    });
    expect(frame.alpha).toBe(0);
  });

  it('emite descarte de backlog mesmo sem ultrapassar o limite de frame', () => {
    const runner = new FixedStepRunner();
    const discards: FixedStepDiscard[] = [];
    runner.advance(0, { onTick: vi.fn() });

    const frame = runner.advance(100, {
      onTick: vi.fn(),
      onDiscard: (discard) => discards.push(discard),
    });

    expect(frame.steps).toBe(5);
    expect(discards).toHaveLength(1);
    expect(discards[0].reason).toBe('step-cap');
    expect(discards[0].wallSeconds).toBeCloseTo(0.1 - STEP * 5, 12);
    expect(frame.alpha).toBe(0);
  });

  it('mantém cutoffs de input monotônicos entre frames e descartes', () => {
    const runner = new FixedStepRunner();
    const cutoffs: number[] = [];
    runner.advance(10, { onTick: vi.fn() });
    for (const now of [27, 61, 1061, 1078]) {
      runner.advance(now, {
        onTick: (ticket) => cutoffs.push(ticket.inputThroughMs),
      });
    }

    expect(cutoffs.length).toBeGreaterThan(0);
    expect(cutoffs.every((cutoff, index) => index === 0 || cutoff >= cutoffs[index - 1])).toBe(
      true,
    );
  });
});
