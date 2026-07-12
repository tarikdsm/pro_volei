import { SIMULATION_TIMING, type SimulationTiming } from '../constants';
import { SlowMotionClock } from './SlowMotionClock';

const EPSILON_SECONDS = 1e-12;

export interface FixedStepTicket {
  tick: number;
  dt: number;
  simulationSeconds: number;
  inputThroughMs: number;
}

export type FixedStepDiscardReason = 'wall-cap' | 'step-cap';

export interface FixedStepDiscard {
  reason: FixedStepDiscardReason;
  fromMs: number;
  toMs: number;
  wallSeconds: number;
  simulationSeconds: number;
}

export interface FixedStepDiagnostics {
  discardCount: number;
  discardedWallSeconds: number;
  discardedSimulationSeconds: number;
}

export interface FixedStepAdvanceOptions {
  paused?: boolean;
  onTick(ticket: FixedStepTicket): void;
  onDiscard?(discard: FixedStepDiscard): void;
}

export interface FixedStepFrame {
  steps: number;
  alpha: number;
  tick: number;
  simulationSeconds: number;
  inputThroughMs: number;
  discardedWallSeconds: number;
  discardedSimulationSeconds: number;
  diagnostics: FixedStepDiagnostics;
}

/** Converte o relógio real do rAF em passos determinísticos de simulação. */
export class FixedStepRunner {
  private readonly dt: number;
  private lastNowMs: number | undefined;
  private latestInputThroughMs = 0;
  private accumulatorSeconds = 0;
  private tick = 0;
  private simulationSeconds = 0;
  private discardCount = 0;
  private totalDiscardedWallSeconds = 0;
  private totalDiscardedSimulationSeconds = 0;

  constructor(
    private readonly slowMotion = new SlowMotionClock(),
    private readonly timing: SimulationTiming = SIMULATION_TIMING,
  ) {
    this.validateTiming(timing);
    this.dt = 1 / timing.hz;
  }

  advance(nowMs: number, options: FixedStepAdvanceOptions): FixedStepFrame {
    if (!Number.isFinite(nowMs)) throw new RangeError('O timestamp do frame deve ser finito.');

    if (this.lastNowMs === undefined) {
      this.lastNowMs = nowMs;
      this.latestInputThroughMs = nowMs;
      return this.frameResult(0, 0, 0);
    }

    if (nowMs < this.lastNowMs) return this.frameResult(0, 0, 0);

    const frameStartMs = this.lastNowMs;
    this.lastNowMs = nowMs;

    if (options.paused) {
      this.accumulatorSeconds = 0;
      this.latestInputThroughMs = nowMs;
      return this.frameResult(0, 0, 0);
    }

    let cursorMs = frameStartMs;
    let remainingRealSeconds = (nowMs - frameStartMs) / 1000;
    let frameDiscardedWallSeconds = 0;
    let frameDiscardedSimulationSeconds = 0;

    if (remainingRealSeconds > this.timing.maxRealFrame) {
      const discard = this.discard('wall-cap', cursorMs, nowMs - this.timing.maxRealFrame * 1000);
      options.onDiscard?.(discard);
      cursorMs = discard.toMs;
      remainingRealSeconds = this.timing.maxRealFrame;
      frameDiscardedWallSeconds += discard.wallSeconds;
      frameDiscardedSimulationSeconds += discard.simulationSeconds;
    }

    let steps = 0;
    while (remainingRealSeconds > EPSILON_SECONDS) {
      if (steps === this.timing.maxStepsPerFrame) {
        const discard = this.discard('step-cap', cursorMs, nowMs);
        options.onDiscard?.(discard);
        frameDiscardedWallSeconds += discard.wallSeconds;
        frameDiscardedSimulationSeconds += discard.simulationSeconds;
        cursorMs = discard.toMs;
        this.accumulatorSeconds = 0;
        break;
      }

      const realUntilTick = (this.dt - this.accumulatorSeconds) / this.slowMotion.scale;
      const realChunk = Math.min(
        remainingRealSeconds,
        realUntilTick,
        this.slowMotion.secondsUntilBoundary,
      );

      this.accumulatorSeconds += realChunk * this.slowMotion.scale;
      this.slowMotion.advanceActiveReal(realChunk);
      cursorMs += realChunk * 1000;
      remainingRealSeconds -= realChunk;

      if (this.accumulatorSeconds + EPSILON_SECONDS < this.dt) continue;

      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - this.dt);
      if (this.accumulatorSeconds < EPSILON_SECONDS) this.accumulatorSeconds = 0;
      this.tick += 1;
      this.simulationSeconds = this.tick * this.dt;
      steps += 1;
      options.onTick({
        tick: this.tick,
        dt: this.dt,
        simulationSeconds: this.simulationSeconds,
        inputThroughMs: cursorMs,
      });
    }

    this.latestInputThroughMs = Math.max(this.latestInputThroughMs, cursorMs);
    return this.frameResult(steps, frameDiscardedWallSeconds, frameDiscardedSimulationSeconds);
  }

  private discard(reason: FixedStepDiscardReason, fromMs: number, toMs: number): FixedStepDiscard {
    const wallSeconds = (toMs - fromMs) / 1000;
    const simulationSeconds = this.advanceClockWithoutSimulation(wallSeconds);
    const discard: FixedStepDiscard = {
      reason,
      fromMs,
      toMs,
      wallSeconds,
      simulationSeconds,
    };
    this.discardCount += 1;
    this.totalDiscardedWallSeconds += wallSeconds;
    this.totalDiscardedSimulationSeconds += simulationSeconds;
    return discard;
  }

  private advanceClockWithoutSimulation(wallSeconds: number): number {
    let remaining = wallSeconds;
    let scaled = 0;
    while (remaining > EPSILON_SECONDS) {
      const chunk = Math.min(remaining, this.slowMotion.secondsUntilBoundary);
      scaled += chunk * this.slowMotion.scale;
      this.slowMotion.advanceActiveReal(chunk);
      remaining -= chunk;
    }
    return scaled;
  }

  private frameResult(
    steps: number,
    discardedWallSeconds: number,
    discardedSimulationSeconds: number,
  ): FixedStepFrame {
    return {
      steps,
      alpha: this.accumulatorSeconds / this.dt,
      tick: this.tick,
      simulationSeconds: this.simulationSeconds,
      inputThroughMs: this.latestInputThroughMs,
      discardedWallSeconds,
      discardedSimulationSeconds,
      diagnostics: {
        discardCount: this.discardCount,
        discardedWallSeconds: this.totalDiscardedWallSeconds,
        discardedSimulationSeconds: this.totalDiscardedSimulationSeconds,
      },
    };
  }

  private validateTiming(timing: SimulationTiming): void {
    if (!Number.isFinite(timing.hz) || timing.hz <= 0) {
      throw new RangeError('A frequência fixa deve ser positiva e finita.');
    }
    if (!Number.isFinite(timing.maxRealFrame) || timing.maxRealFrame <= 0) {
      throw new RangeError('O limite real por frame deve ser positivo e finito.');
    }
    if (!Number.isInteger(timing.maxStepsPerFrame) || timing.maxStepsPerFrame <= 0) {
      throw new RangeError('O limite de passos deve ser um inteiro positivo.');
    }
  }
}
