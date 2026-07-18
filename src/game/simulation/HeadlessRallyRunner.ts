import { DIFFICULTIES, MATCH_FORMATS, TeamSide, otherSide } from '../../core/constants';
import { attackZoneIndex, classifyPoint, type PointClass, type RallyTouch } from './BalanceMetrics';
import type { RandomHubSnapshot } from '../../core/random';
import { RandomHub } from '../../core/random';
import { FixedStepRunner, type FixedStepTicket } from '../../core/time/FixedStepRunner';
import type { ControlFrame } from '../control/ControlFrame';
import { Match } from '../Match';
import type { MatchHooks } from '../ports/MatchHooks';
import { setWinner } from '../rules/scoring';
import {
  MATCH_STRATEGY_POINT_CHECKPOINT_VERSION,
  MatchStrategyBridge,
  type MatchStrategyPointCheckpoint,
} from '../strategy/MatchStrategyBridge';
import { StrategyTraceCollector, type StrategyTraceEntry } from '../strategy/StrategyTrace';
import { createHeadlessCharacter } from './HeadlessCharacter';
import { HeadlessBall } from './HeadlessBall';
import { createHeadlessHooks } from './HeadlessHooks';
import { RallyJournal, type RallyJournalEntry } from './RallyJournal';
import type {
  PointCause,
  SimulationTelemetryEvent,
  SimulationTelemetryPort,
} from './SimulationTelemetry';
import {
  TacticalTraceCollector,
  type TacticalTraceEntry,
  type TacticalTraceMetrics,
} from './TacticalTrace';

export interface HeadlessRunnerOptions {
  readonly seed: number;
  readonly difficulty?: number;
  readonly format?: number;
  readonly externalHz?: 30 | 60 | 120;
  readonly maxTicksPerPoint?: number;
  readonly maxEventsPerRally?: number;
  readonly hooks?: MatchHooks;
}

export const HEADLESS_STOCHASTIC_CHECKPOINT_VERSION = 1 as const;

export interface HeadlessStochasticFingerprint {
  readonly matchEpoch: number;
  readonly simulationTick: number;
  readonly pointCount: number;
  readonly difficulty: number;
  readonly format: number;
  readonly score: readonly [number, number];
  readonly sets: readonly [number, number];
  readonly setNumber: number;
  readonly servingSide: TeamSide;
  readonly homeSlots: readonly number[];
  readonly awaySlots: readonly number[];
}

export interface HeadlessStochasticCheckpoint {
  readonly version: typeof HEADLESS_STOCHASTIC_CHECKPOINT_VERSION;
  readonly fingerprint: HeadlessStochasticFingerprint;
  readonly random: Readonly<RandomHubSnapshot>;
  readonly strategy: MatchStrategyPointCheckpoint;
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
  readonly sideOut: boolean; // vencedor foi quem recebia o saque
  readonly pointClass: PointClass;
  /**
   * Ataques do lado [HOME, AWAY] por corredor de destino [esq, centro, dir] na quadra que
   * recebe, no referencial de quem defende (§4.3: "nenhuma zona recebe mais de 45%").
   */
  readonly attackZones: readonly (readonly [number, number, number])[];
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
  readonly sideOuts: readonly [number, number];
  readonly unforcedErrors: readonly [number, number];
  readonly attackZoneTotals: readonly (readonly [number, number, number])[];
  readonly totalTicks: number;
  readonly journal: readonly Readonly<RallyJournalEntry>[];
  readonly serializedJournal: string;
  readonly journalHash: string;
  readonly tacticalTrace: readonly Readonly<TacticalTraceEntry>[];
  readonly serializedTacticalTrace: string;
  readonly tacticalTraceHash: string;
  readonly tacticalMetrics: Readonly<TacticalTraceMetrics>;
  readonly strategyTrace: readonly Readonly<StrategyTraceEntry>[];
  readonly serializedStrategyTrace: string;
  readonly strategyTraceHash: string;
}

export interface HeadlessRallyResult extends HeadlessRallySummary {
  readonly seed: number;
  readonly journal: readonly Readonly<RallyJournalEntry>[];
  readonly serializedJournal: string;
  readonly journalHash: string;
  readonly tacticalTrace: readonly Readonly<TacticalTraceEntry>[];
  readonly serializedTacticalTrace: string;
  readonly tacticalTraceHash: string;
  readonly tacticalMetrics: Readonly<TacticalTraceMetrics>;
  readonly strategyTrace: readonly Readonly<StrategyTraceEntry>[];
  readonly serializedStrategyTrace: string;
  readonly strategyTraceHash: string;
}

export interface HeadlessMatchSummary {
  readonly winner: TeamSide;
  readonly sets: readonly [number, number];
  readonly setScores: readonly (readonly [number, number])[];
  readonly points: readonly [number, number];
  readonly rallies: number;
  readonly durationTicks: number;
  readonly durationSeconds: number;
}

export interface HeadlessMatchBatchResult {
  readonly seed: number;
  readonly matches: readonly Readonly<HeadlessMatchSummary>[];
  readonly totalTicks: number;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
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
  private readonly tacticalTrace = new TacticalTraceCollector();
  private readonly strategyTrace = new StrategyTraceCollector();
  private readonly events: Readonly<SimulationTelemetryEvent>[] = [];
  private readonly match: Match;
  private readonly strategy: MatchStrategyBridge;
  private readonly fixed = new FixedStepRunner();
  private frame = 0;
  private logicalTick = 0;
  private pointCount = 0;
  private lastPointTick = 0;
  private eventsInRally = 0;
  private traceRally = 0;
  private telemetryLimit: HeadlessSimulationLimitError | null = null;
  private matchStartTick = 0;
  private matchStartPoint = 0;
  private readonly matchBoundaries: {
    tick: number;
    point: number;
    startTick: number;
    startPoint: number;
  }[] = [];

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
    this.strategy = new MatchStrategyBridge(
      {
        home: this.random.stream('strategy.home'),
        away: this.random.stream('strategy.away'),
      },
      (event) => this.strategyTrace.record(event, this.pointCount),
    );
    this.match = new Match(options.hooks ?? createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random: this.random,
      telemetry,
      strategy: this.strategy,
    });
    this.match.startMatch(this.difficulty, this.format);
    this.fixed.advance(0, { onTick: () => undefined });
  }

  run(rallies = 1): HeadlessBatchResult {
    if (!Number.isInteger(rallies) || rallies <= 0) {
      throw new RangeError('rallies deve ser um inteiro positivo');
    }
    const firstPoint = this.pointCount;
    this.traceRally = firstPoint;
    const targetPoints = firstPoint + rallies;
    const firstEvent = this.events.length;
    const firstJournalEntry = this.journal.entries.length;
    this.tacticalTrace.flush();
    const firstTacticalEntry = this.tacticalTrace.length;
    const firstStrategyEntry = this.strategyTrace.length;
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
    const sideOuts: [number, number] = [0, 0];
    const unforcedErrors: [number, number] = [0, 0];
    const attackZoneTotals: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 0],
    ];
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
      if (summary.sideOut) sideOuts[summary.winner] += 1;
      if (summary.pointClass === 'unforced') unforcedErrors[otherSide(summary.winner)] += 1;
      for (const side of [0, 1] as const) {
        for (let zone = 0; zone < 3; zone += 1) {
          attackZoneTotals[side][zone] += summary.attackZones[side][zone];
        }
      }
    }

    const journalEntries = Object.freeze(this.journal.entries.slice(firstJournalEntry));
    this.tacticalTrace.flush();
    const tacticalEntries = Object.freeze(
      this.tacticalTrace
        .sliceFrom(firstTacticalEntry)
        .filter((entry) => entry.rally >= firstPoint && entry.rally < targetPoints),
    );
    const strategyEntries = Object.freeze(
      this.strategyTrace
        .sliceFrom(firstStrategyEntry)
        .filter((entry) => entry.rally >= firstPoint && entry.rally < targetPoints),
    );
    const pendingStrategy = strategyEntries.find((entry) => entry.outcome === null);
    if (pendingStrategy) {
      throw new Error(
        `trace estratégico pendente na fronteira do ponto: ${pendingStrategy.decisionId}`,
      );
    }
    this.validateStochasticCheckpoint(this.checkpointStochastic());
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
      sideOuts: Object.freeze(sideOuts),
      unforcedErrors: Object.freeze(unforcedErrors),
      attackZoneTotals: Object.freeze(
        attackZoneTotals.map(
          (zones) => Object.freeze([...zones]) as unknown as readonly [number, number, number],
        ),
      ),
      totalTicks: this.lastPointTick - firstTick,
      journal: journalEntries,
      serializedJournal: this.journal.serialize(journalEntries),
      journalHash: this.journal.hash(journalEntries),
      tacticalTrace: tacticalEntries,
      serializedTacticalTrace: this.tacticalTrace.serialize(tacticalEntries),
      tacticalTraceHash: this.tacticalTrace.hash(tacticalEntries),
      tacticalMetrics: this.tacticalTrace.metrics(tacticalEntries),
      strategyTrace: strategyEntries,
      serializedStrategyTrace: this.strategyTrace.serialize(strategyEntries),
      strategyTraceHash: this.strategyTrace.hash(strategyEntries),
    });
  }

  /** Roda partidas completas AI×AI no formato configurado; exige fronteira de partida. */
  runMatches(matches: number): HeadlessMatchBatchResult {
    if (!Number.isInteger(matches) || matches <= 0) {
      throw new RangeError('matches deve ser um inteiro positivo');
    }
    if (this.pointCount !== (this.matchBoundaries.at(-1)?.point ?? 0)) {
      throw new Error('runMatches exige fronteira de partida (não misture com run() no meio)');
    }
    const firstBoundary = this.matchBoundaries.length;
    const targetMatches = firstBoundary + matches;
    const firstEvent = this.events.length;
    const firstPoint = this.pointCount;
    while (this.matchBoundaries.length < targetMatches) {
      this.frame += 1;
      const nowMs = (this.frame * 1_000) / this.externalHz;
      this.fixed.advance(nowMs, {
        onTick: (ticket) => this.onTick(ticket, Number.POSITIVE_INFINITY, targetMatches),
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
    const summaries = summarizeRallies(this.events.slice(firstEvent));
    const boundaries = this.matchBoundaries.slice(firstBoundary);
    const matchesOut = boundaries.map((boundary) => {
      const rallies = summaries.slice(
        boundary.startPoint - firstPoint,
        boundary.point - firstPoint,
      );
      return summarizeMatch(rallies, boundary.tick - boundary.startTick);
    });
    return Object.freeze({
      seed: this.seed,
      matches: Object.freeze(matchesOut),
      totalTicks: boundaries.at(-1)!.tick - boundaries[0].startTick,
    });
  }

  checkpointStochastic(): Readonly<HeadlessStochasticCheckpoint> {
    this.assertPointBoundary();
    return Object.freeze({
      version: HEADLESS_STOCHASTIC_CHECKPOINT_VERSION,
      fingerprint: this.stochasticFingerprint(),
      random: this.random.snapshot(),
      strategy: this.strategy.checkpointPoint(),
    });
  }

  restoreStochastic(checkpoint: HeadlessStochasticCheckpoint): void {
    this.assertPointBoundary();
    this.validateStochasticCheckpoint(checkpoint);
    const before = this.checkpointStochastic();
    try {
      this.random.restore(checkpoint.random);
      this.strategy.restorePoint(checkpoint.strategy);
    } catch (error) {
      this.random.restore(before.random);
      this.strategy.restorePoint(before.strategy);
      throw error;
    }
  }

  private onTick(
    ticket: FixedStepTicket,
    targetPoints: number,
    targetMatches = Number.POSITIVE_INFINITY,
  ): void {
    if (this.pointCount >= targetPoints) return;
    this.logicalTick += 1;
    const logicalTicket = {
      ...ticket,
      tick: this.logicalTick,
      simulationSeconds: this.logicalTick / 60,
    };
    this.match.update(ticket.dt, neutralFrame(logicalTicket));
    const homePlan = this.match.teamTacticsSnapshot(TeamSide.HOME);
    const awayPlan = this.match.teamTacticsSnapshot(TeamSide.AWAY);
    const homeRally =
      this.match.state === 'point' && homePlan?.phase === 'hold'
        ? Math.max(0, this.traceRally - 1)
        : this.traceRally;
    const awayRally =
      this.match.state === 'point' && awayPlan?.phase === 'hold'
        ? Math.max(0, this.traceRally - 1)
        : this.traceRally;
    this.tacticalTrace.record(
      this.logicalTick,
      homeRally,
      TeamSide.HOME,
      homePlan,
      this.match.teamTacticsAthletesSnapshot(TeamSide.HOME),
    );
    this.tacticalTrace.record(
      this.logicalTick,
      awayRally,
      TeamSide.AWAY,
      awayPlan,
      this.match.teamTacticsAthletesSnapshot(TeamSide.AWAY),
    );
    if (this.telemetryLimit) return;

    if (this.logicalTick - this.lastPointTick > this.maxTicksPerPoint) {
      throw new HeadlessSimulationLimitError('Rally excedeu o limite de ticks', {
        seed: this.seed,
        tick: this.logicalTick,
        state: this.match.state,
        points: this.pointCount,
      });
    }

    if (this.match.state === 'matchEnd') {
      // Fronteira de partida: registra uma vez por época e reinicia se ainda há trabalho.
      if (this.matchBoundaries.at(-1)?.point !== this.pointCount) {
        this.matchBoundaries.push({
          tick: this.logicalTick,
          point: this.pointCount,
          startTick: this.matchStartTick,
          startPoint: this.matchStartPoint,
        });
      }
      const needMore =
        (Number.isFinite(targetPoints) && this.pointCount < targetPoints) ||
        (Number.isFinite(targetMatches) && this.matchBoundaries.length < targetMatches);
      if (needMore) {
        this.match.startMatch(this.difficulty, this.format);
        this.matchStartTick = this.logicalTick;
        this.matchStartPoint = this.pointCount;
      }
    }
  }

  private recordTelemetry(event: Readonly<SimulationTelemetryEvent>): void {
    if (event.type === 'block') this.tacticalTrace.recordBlockContact(event.tick, event.side);
    this.events.push(event);
    this.journal.emit(event);
    if (event.type === 'rally-start') {
      this.eventsInRally = 0;
      this.traceRally = this.pointCount;
    }
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
      this.traceRally = this.pointCount;
    }
  }

  private assertPointBoundary(): void {
    if (this.events.at(-1)?.type !== 'rally-end' || this.match.state !== 'point') {
      throw new Error('checkpoint de RNG permitido somente na fronteira de ponto');
    }
  }

  private stochasticFingerprint(): HeadlessStochasticFingerprint {
    const tuple = (values: readonly [number, number]): readonly [number, number] =>
      Object.freeze([values[0], values[1]]) as readonly [number, number];
    return Object.freeze({
      matchEpoch: this.strategy.matchEpoch,
      simulationTick: this.lastPointTick,
      pointCount: this.pointCount,
      difficulty: this.difficulty,
      format: this.format,
      score: tuple(this.match.score),
      sets: tuple(this.match.sets),
      setNumber: this.match.setNumber,
      servingSide: this.match.servingTeam,
      homeSlots: Object.freeze([...this.match.home.slots]),
      awaySlots: Object.freeze([...this.match.away.slots]),
    });
  }

  private validateStochasticCheckpoint(checkpoint: HeadlessStochasticCheckpoint): void {
    const random = checkpoint?.random as unknown;
    const strategy = checkpoint?.strategy as unknown;
    const core = isRecord(strategy) ? strategy.core : undefined;
    if (
      checkpoint === null ||
      typeof checkpoint !== 'object' ||
      checkpoint.version !== HEADLESS_STOCHASTIC_CHECKPOINT_VERSION ||
      !isRecord(random) ||
      !Array.isArray(random.streams) ||
      !random.streams.every(
        (entry) => isRecord(entry) && typeof entry.name === 'string' && isRecord(entry.random),
      ) ||
      !isRecord(strategy) ||
      strategy.version !== MATCH_STRATEGY_POINT_CHECKPOINT_VERSION ||
      !isRecord(core) ||
      !Array.isArray(core.sequences) ||
      core.sequences.length !== 2 ||
      !core.sequences.every((sequence) => Number.isSafeInteger(sequence) && sequence >= 0) ||
      !Array.isArray(core.perceptionFrames) ||
      !Array.isArray(core.memories) ||
      !Array.isArray(core.ownerships) ||
      !Array.isArray(core.decisions) ||
      !Array.isArray(core.outcomes) ||
      !Array.isArray(core.outbox) ||
      !isRecord(strategy.serve) ||
      !isRecord(strategy.offense)
    ) {
      throw new RangeError('checkpoint estocástico inválido');
    }
    const currentFingerprint = this.stochasticFingerprint();
    if (JSON.stringify(checkpoint.fingerprint) !== JSON.stringify(currentFingerprint)) {
      throw new Error('fingerprint do checkpoint estocástico diverge do estado físico');
    }
    const currentRandom = this.random.snapshot();
    const currentNames = currentRandom.streams.map((entry) => entry.name);
    const savedNames = checkpoint.random.streams.map((entry) => entry.name);
    if (JSON.stringify(savedNames) !== JSON.stringify(currentNames)) {
      throw new RangeError('streams do checkpoint estocástico divergem dos handles ativos');
    }
    const probe = new RandomHub(this.seed);
    try {
      probe.restore(checkpoint.random);
    } catch (error) {
      throw new RangeError('checkpoint estocástico contém estado de RNG inválido', {
        cause: error,
      });
    }
    const drawCount = (name: string): number => {
      const entry = checkpoint.random.streams.find((stream) => stream.name === name);
      if (!entry) throw new RangeError(`stream ausente no checkpoint: ${name}`);
      return entry.random.draws;
    };
    if (
      drawCount('strategy.home') !== checkpoint.strategy.core.sequences[TeamSide.HOME] * 2 ||
      drawCount('strategy.away') !== checkpoint.strategy.core.sequences[TeamSide.AWAY] * 2
    ) {
      throw new RangeError('draws estratégicos divergem das sequências comprometidas');
    }
    const committedDecisions =
      checkpoint.strategy.core.sequences[TeamSide.HOME] +
      checkpoint.strategy.core.sequences[TeamSide.AWAY];
    if (this.strategyTrace.length !== committedDecisions) {
      throw new Error('trace estratégico incompleto para as sequências comprometidas');
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
  let touches: RallyTouch[] = [];
  let attackZones: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  let point: Extract<SimulationTelemetryEvent, { type: 'point' }> | null = null;

  for (const event of events) {
    if (event.type === 'rally-start') {
      rallyStart = event;
      contacts = 0;
      blocks = [0, 0];
      blockTouches = [0, 0];
      attacks = [0, 0];
      touches = [];
      attackZones = [
        [0, 0, 0],
        [0, 0, 0],
      ];
      point = null;
    } else if (event.type === 'contact') {
      contacts += 1;
      touches.push({ side: event.side, kind: event.kind });
      if (event.kind === 'spike') {
        attacks[event.side] += 1;
        // Zona que RECEBE o ataque (§4.3): corredor do alvo na quadra defendida,
        // classificado na perspectiva de quem defende.
        attackZones[event.side][attackZoneIndex(otherSide(event.side), event.target.z)] += 1;
      }
    } else if (event.type === 'block') {
      blockTouches[event.side] += 1;
      if (event.outcome === 'stuff') blocks[event.side] += 1;
      touches.push({ side: event.side, kind: 'block-touch' });
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
      const pointClass = classifyPoint({
        cause: point.cause,
        ace: point.ace,
        winner: point.winner,
        lastTouchSide: point.lastTouchSide,
        lastKind: point.lastKind,
        touches,
      });
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
          sideOut: event.winner !== rallyStart.serving,
          pointClass,
          attackZones: Object.freeze([
            Object.freeze([...attackZones[0]]) as unknown as readonly [number, number, number],
            Object.freeze([...attackZones[1]]) as unknown as readonly [number, number, number],
          ]),
        }),
      );
      rallyStart = null;
      point = null;
    }
  }
  return summaries;
}

/** Resume uma partida a partir dos rallies dela: sets detectados pelo reset do placar. */
function summarizeMatch(
  rallies: readonly Readonly<HeadlessRallySummary>[],
  durationTicks: number,
): Readonly<HeadlessMatchSummary> {
  const setScores: [number, number][] = [];
  let last: readonly [number, number] | null = null;
  for (const rally of rallies) {
    if (last && rally.score[0] + rally.score[1] <= last[0] + last[1]) {
      setScores.push([last[0], last[1]]);
    }
    last = rally.score;
  }
  if (last) setScores.push([last[0], last[1]]);
  const sets: [number, number] = [0, 0];
  for (const [h, a] of setScores) sets[setWinner(h, a)] += 1;
  const points: [number, number] = [0, 0];
  for (const rally of rallies) points[rally.winner] += 1;
  return Object.freeze({
    winner: sets[0] > sets[1] ? TeamSide.HOME : TeamSide.AWAY,
    sets: Object.freeze(sets) as unknown as readonly [number, number],
    setScores: Object.freeze(
      setScores.map((score) => Object.freeze([...score]) as unknown as readonly [number, number]),
    ),
    points: Object.freeze(points) as unknown as readonly [number, number],
    rallies: rallies.length,
    durationTicks,
    durationSeconds: durationTicks / 60,
  });
}

export function runHeadlessMatches(
  options: HeadlessRunnerOptions & { readonly matches: number },
): HeadlessMatchBatchResult {
  return new HeadlessRallyRunner(options).runMatches(options.matches);
}

export function runHeadlessRally(options: HeadlessRunnerOptions): HeadlessRallyResult {
  const batch = new HeadlessRallyRunner(options).run(1);
  return Object.freeze({
    ...batch.rallies[0],
    seed: batch.seed,
    journal: batch.journal,
    serializedJournal: batch.serializedJournal,
    journalHash: batch.journalHash,
    tacticalTrace: batch.tacticalTrace,
    serializedTacticalTrace: batch.serializedTacticalTrace,
    tacticalTraceHash: batch.tacticalTraceHash,
    tacticalMetrics: batch.tacticalMetrics,
    strategyTrace: batch.strategyTrace,
    serializedStrategyTrace: batch.serializedStrategyTrace,
    strategyTraceHash: batch.strategyTraceHash,
  });
}

export function runHeadlessBatch(
  options: HeadlessRunnerOptions & { readonly rallies: number },
): HeadlessBatchResult {
  return new HeadlessRallyRunner(options).run(options.rallies);
}
