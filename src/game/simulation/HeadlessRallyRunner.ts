import { DIFFICULTIES, MATCH_FORMATS, TeamSide } from '../../core/constants';
import type { RandomHubSnapshot } from '../../core/random';
import { RandomHub } from '../../core/random';
import { FixedStepRunner, type FixedStepTicket } from '../../core/time/FixedStepRunner';
import type { ControlFrame } from '../control/ControlFrame';
import { Match } from '../Match';
import type { MatchHooks } from '../ports/MatchHooks';
import { createHeadlessCharacter } from './HeadlessCharacter';
import { HeadlessBall } from './HeadlessBall';
import { createHeadlessHooks } from './HeadlessHooks';
import { RallyJournal, type RallyJournalEntry } from './RallyJournal';
import type {
  PointCause,
  SimulationTelemetryEvent,
  SimulationTelemetryPort,
} from './SimulationTelemetry';

export interface HeadlessRunnerOptions {
  readonly seed: number;
  readonly difficulty?: number;
  readonly format?: number;
  readonly externalHz?: 30 | 60 | 120;
  readonly maxTicksPerPoint?: number;
  readonly maxEventsPerRally?: number;
  readonly hooks?: MatchHooks;
}

export interface HeadlessRallySummary {
  readonly winner: TeamSide;
  readonly serving: TeamSide;
  readonly durationTicks: number;
  readonly durationSeconds: number;
  readonly contacts: number;
  readonly blocks: readonly [number, number];
  readonly blockTouches: readonly [number, number];
  readonly attacks: readonly [number, number];
  readonly attackPoints: readonly [number, number];
  readonly errors: readonly [number, number];
  readonly ace: boolean;
  readonly cause: PointCause;
  readonly score: readonly [number, number];
}

export interface HeadlessBatchResult {
  readonly seed: number;
  readonly rallies: readonly Readonly<HeadlessRallySummary>[];
  readonly points: readonly [number, number];
  readonly aces: readonly [number, number];
  readonly blocks: readonly [number, number];
  readonly blockTouches: readonly [number, number];
  readonly attacks: readonly [number, number];
  readonly attackPoints: readonly [number, number];
  readonly errors: readonly [number, number];
  readonly totalTicks: number;
  readonly journal: readonly Readonly<RallyJournalEntry>[];
  readonly serializedJournal: string;
  readonly journalHash: string;
}

export interface HeadlessRallyResult extends HeadlessRallySummary {
  readonly seed: number;
  readonly journal: readonly Readonly<RallyJournalEntry>[];
  readonly serializedJournal: string;
  readonly journalHash: string;
}

export class HeadlessSimulationLimitError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Readonly<Record<string, number | string>>,
  ) {
    super(message);
    this.name = 'HeadlessSimulationLimitError';
  }
}

function neutralFrame(ticket: FixedStepTicket): ControlFrame {
  return {
    simulationTick: ticket.tick,
    sampledAtMs: ticket.tick * (1_000 / 60),
    screenAxis: { right: 0, up: 0 },
    courtAxis: { x: 0, z: 0 },
    actionDown: false,
    actionEdges: [],
    cancellations: [],
  };
}

/** Sessão síncrona AI × AI, sem timers ou dependências de apresentação. */
export class HeadlessRallyRunner {
  private readonly seed: number;
  private readonly difficulty: number;
  private readonly format: number;
  private readonly externalHz: 30 | 60 | 120;
  private readonly maxTicksPerPoint: number;
  private readonly maxEventsPerRally: number;
  private readonly random: RandomHub;
  private readonly journal: RallyJournal;
  private readonly events: Readonly<SimulationTelemetryEvent>[] = [];
  private readonly match: Match;
  private readonly fixed = new FixedStepRunner();
  private frame = 0;
  private logicalTick = 0;
  private pointCount = 0;
  private lastPointTick = 0;
  private eventsInRally = 0;
  private telemetryLimit: HeadlessSimulationLimitError | null = null;

  constructor(options: HeadlessRunnerOptions) {
    this.seed = options.seed;
    this.difficulty = options.difficulty ?? 1;
    this.format = options.format ?? 0;
    this.externalHz = options.externalHz ?? 60;
    this.maxTicksPerPoint = options.maxTicksPerPoint ?? 7_200;
    this.maxEventsPerRally = options.maxEventsPerRally ?? 512;
    this.validateOptions();

    this.random = new RandomHub(this.seed);
    this.journal = new RallyJournal({
      seed: this.seed,
      difficulty: this.difficulty,
      format: this.format,
      simulationHz: 60,
    });
    const telemetry: SimulationTelemetryPort = {
      emit: (event) => this.recordTelemetry(event),
    };
    this.match = new Match(options.hooks ?? createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random: this.random,
      telemetry,
    });
    this.match.startMatch(this.difficulty, this.format);
    this.fixed.advance(0, { onTick: () => undefined });
  }

  run(rallies = 1): HeadlessBatchResult {
    if (!Number.isInteger(rallies) || rallies <= 0) {
      throw new RangeError('rallies deve ser um inteiro positivo');
    }
    const firstPoint = this.pointCount;
    const targetPoints = firstPoint + rallies;
    const firstEvent = this.events.length;
    const firstJournalEntry = this.journal.entries.length;
    const firstTick = this.lastPointTick;

    while (this.pointCount < targetPoints) {
      this.frame += 1;
      const nowMs = (this.frame * 1_000) / this.externalHz;
      this.fixed.advance(nowMs, {
        onTick: (ticket) => this.onTick(ticket, targetPoints),
        onDiscard: (discard) => {
          throw new HeadlessSimulationLimitError('FixedStepRunner descartou tempo', {
            reason: discard.reason,
            tick: this.lastPointTick,
            seed: this.seed,
          });
        },
      });
      if (this.telemetryLimit) throw this.telemetryLimit;
    }

    const runEvents = this.events.slice(firstEvent);
    const summaries = summarizeRallies(runEvents);
    if (summaries.length !== rallies) {
      throw new HeadlessSimulationLimitError('Telemetria incompleta ao fechar o batch', {
        expected: rallies,
        actual: summaries.length,
        seed: this.seed,
      });
    }
    const points: [number, number] = [0, 0];
    const aces: [number, number] = [0, 0];
    const blocks: [number, number] = [0, 0];
    const blockTouches: [number, number] = [0, 0];
    const attacks: [number, number] = [0, 0];
    const attackPoints: [number, number] = [0, 0];
    const errors: [number, number] = [0, 0];
    for (const summary of summaries) {
      points[summary.winner] += 1;
      if (summary.ace) aces[summary.winner] += 1;
      blocks[0] += summary.blocks[0];
      blocks[1] += summary.blocks[1];
      blockTouches[0] += summary.blockTouches[0];
      blockTouches[1] += summary.blockTouches[1];
      attacks[0] += summary.attacks[0];
      attacks[1] += summary.attacks[1];
      attackPoints[0] += summary.attackPoints[0];
      attackPoints[1] += summary.attackPoints[1];
      errors[0] += summary.errors[0];
      errors[1] += summary.errors[1];
    }

    const journalEntries = Object.freeze(this.journal.entries.slice(firstJournalEntry));
    return Object.freeze({
      seed: this.seed,
      rallies: Object.freeze(summaries),
      points: Object.freeze(points),
      aces: Object.freeze(aces),
      blocks: Object.freeze(blocks),
      blockTouches: Object.freeze(blockTouches),
      attacks: Object.freeze(attacks),
      attackPoints: Object.freeze(attackPoints),
      errors: Object.freeze(errors),
      totalTicks: this.lastPointTick - firstTick,
      journal: journalEntries,
      serializedJournal: this.journal.serialize(journalEntries),
      journalHash: this.journal.hash(journalEntries),
    });
  }

  checkpointRandom(): Readonly<RandomHubSnapshot> {
    this.assertPointBoundary();
    return this.random.snapshot();
  }

  restoreRandom(snapshot: RandomHubSnapshot): void {
    this.assertPointBoundary();
    this.random.restore(snapshot);
  }

  private onTick(ticket: FixedStepTicket, targetPoints: number): void {
    if (this.pointCount >= targetPoints) return;
    this.logicalTick += 1;
    const logicalTicket = {
      ...ticket,
      tick: this.logicalTick,
      simulationSeconds: this.logicalTick / 60,
    };
    this.match.update(ticket.dt, neutralFrame(logicalTicket));
    if (this.telemetryLimit) return;

    if (this.logicalTick - this.lastPointTick > this.maxTicksPerPoint) {
      throw new HeadlessSimulationLimitError('Rally excedeu o limite de ticks', {
        seed: this.seed,
        tick: this.logicalTick,
        state: this.match.state,
        points: this.pointCount,
      });
    }

    if (this.match.state === 'matchEnd' && this.pointCount < targetPoints) {
      this.match.startMatch(this.difficulty, this.format);
    }
  }

  private recordTelemetry(event: Readonly<SimulationTelemetryEvent>): void {
    this.events.push(event);
    this.journal.emit(event);
    if (event.type === 'rally-start') this.eventsInRally = 0;
    this.eventsInRally += 1;
    if (this.eventsInRally > this.maxEventsPerRally && !this.telemetryLimit) {
      this.telemetryLimit = new HeadlessSimulationLimitError('Rally excedeu o limite de eventos', {
        seed: this.seed,
        tick: event.tick,
        events: this.eventsInRally,
      });
    }
    if (event.type === 'rally-end') {
      this.pointCount += 1;
      this.lastPointTick = event.tick;
    }
  }

  private assertPointBoundary(): void {
    if (this.events.at(-1)?.type !== 'rally-end' || this.match.state !== 'point') {
      throw new Error('checkpoint de RNG permitido somente na fronteira de ponto');
    }
  }

  private validateOptions(): void {
    if (!Number.isInteger(this.seed) || this.seed < 0 || this.seed > 0xffff_ffff) {
      throw new RangeError('seed deve ser uint32');
    }
    if (!Number.isInteger(this.difficulty) || !DIFFICULTIES[this.difficulty]) {
      throw new RangeError('difficulty inválida');
    }
    if (!Number.isInteger(this.format) || !MATCH_FORMATS[this.format]) {
      throw new RangeError('format inválido');
    }
    if (![30, 60, 120].includes(this.externalHz)) throw new RangeError('externalHz inválido');
    if (!Number.isInteger(this.maxTicksPerPoint) || this.maxTicksPerPoint <= 0) {
      throw new RangeError('maxTicksPerPoint deve ser um inteiro positivo');
    }
    if (!Number.isInteger(this.maxEventsPerRally) || this.maxEventsPerRally <= 0) {
      throw new RangeError('maxEventsPerRally deve ser um inteiro positivo');
    }
  }
}

function summarizeRallies(
  events: readonly Readonly<SimulationTelemetryEvent>[],
): Readonly<HeadlessRallySummary>[] {
  const summaries: HeadlessRallySummary[] = [];
  let rallyStart: Extract<SimulationTelemetryEvent, { type: 'rally-start' }> | null = null;
  let contacts = 0;
  let blocks: [number, number] = [0, 0];
  let blockTouches: [number, number] = [0, 0];
  let attacks: [number, number] = [0, 0];
  let point: Extract<SimulationTelemetryEvent, { type: 'point' }> | null = null;

  for (const event of events) {
    if (event.type === 'rally-start') {
      rallyStart = event;
      contacts = 0;
      blocks = [0, 0];
      blockTouches = [0, 0];
      attacks = [0, 0];
      point = null;
    } else if (event.type === 'contact') {
      contacts += 1;
      if (event.kind === 'spike') attacks[event.side] += 1;
    } else if (event.type === 'block') {
      blockTouches[event.side] += 1;
      if (event.outcome === 'stuff') blocks[event.side] += 1;
    } else if (event.type === 'point') {
      point = event;
    } else if (event.type === 'rally-end' && rallyStart && point) {
      const durationTicks = event.tick - rallyStart.tick;
      const attackPoints: [number, number] = [0, 0];
      const errors: [number, number] = [0, 0];
      if (
        point.lastKind === 'spike' &&
        point.lastTouchSide === point.winner &&
        point.cause === 'floor-in'
      ) {
        attackPoints[point.winner] = 1;
      }
      const errorSide =
        point.cause === 'serve-net'
          ? rallyStart.serving
          : point.cause === 'floor-out' || point.cause === 'antenna'
            ? point.lastTouchSide
            : point.cause === 'floor-in' && point.lastTouchSide !== point.winner
              ? point.lastTouchSide
              : null;
      if (errorSide !== null) errors[errorSide] = 1;
      summaries.push(
        Object.freeze({
          winner: event.winner,
          serving: rallyStart.serving,
          durationTicks,
          durationSeconds: durationTicks / 60,
          contacts,
          blocks: Object.freeze([...blocks]) as unknown as readonly [number, number],
          blockTouches: Object.freeze([...blockTouches]) as unknown as readonly [number, number],
          attacks: Object.freeze([...attacks]) as unknown as readonly [number, number],
          attackPoints: Object.freeze(attackPoints),
          errors: Object.freeze(errors),
          ace: point.ace,
          cause: point.cause,
          score: Object.freeze([...point.score]) as unknown as readonly [number, number],
        }),
      );
      rallyStart = null;
      point = null;
    }
  }
  return summaries;
}

export function runHeadlessRally(options: HeadlessRunnerOptions): HeadlessRallyResult {
  const batch = new HeadlessRallyRunner(options).run(1);
  return Object.freeze({
    ...batch.rallies[0],
    seed: batch.seed,
    journal: batch.journal,
    serializedJournal: batch.serializedJournal,
    journalHash: batch.journalHash,
  });
}

export function runHeadlessBatch(
  options: HeadlessRunnerOptions & { readonly rallies: number },
): HeadlessBatchResult {
  return new HeadlessRallyRunner(options).run(options.rallies);
}
