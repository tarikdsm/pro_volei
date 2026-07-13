import { COURT, TeamSide } from '../../core/constants';
import type { RandomSource } from '../../core/random';
import { canonicalStrategyOptions, strategyToLocal } from './CourtZones';
import { OpponentBrain } from './OpponentBrain';
import {
  createStrategyMemory,
  recordStrategyChoice,
  recordStrategyOutcome,
  resetStrategyMemory,
} from './StrategyMemory';
import type {
  StrategyDecisionContext,
  StrategyDecisionKind,
  StrategyDifficulty,
  StrategyMemorySnapshot,
  StrategyObservation,
  StrategyOptionId,
  StrategyPoint2,
  StrategyProposal,
} from './StrategyTypes';
import {
  isCanonicalStrategyObservation,
  isPackedStrategyObservation,
  materializePackedStrategyObservation,
  type PackedStrategyObservation,
} from './StrategyObservationAdapter';
import {
  buildOwnContactRead,
  deriveAttackOriginFromExecutedSet,
  type OwnContactRead,
  type OwnContactReadSource,
} from './OwnContactRead';

export const PERCEPTION_RING_CAPACITY = 48;
export const TERMINAL_HISTORY_CAPACITY_PER_SIDE = 48;
export const PERCEPTION_DELAY_TICKS = Object.freeze([30, 15, 6] as const);
export const OPPONENT_STRATEGY_SNAPSHOT_VERSION = 1;

const KNOWN_OPTIONS = new Set<StrategyOptionId>([
  ...canonicalStrategyOptions('serve').map((option) => option.optionId),
  ...canonicalStrategyOptions('set').map((option) => option.optionId),
  ...canonicalStrategyOptions('attack', { attackOriginZ: 0 }).map((option) => option.optionId),
]);

export interface StrategyDecisionRequest {
  readonly matchEpoch: number;
  readonly side: TeamSide;
  readonly kind: StrategyDecisionKind;
  readonly difficulty: StrategyDifficulty;
  readonly decisionTick: number;
  readonly ownership: string;
  readonly setterAthleteId?: number;
  readonly ownContactRead?: OwnContactReadSource;
  readonly attackBasis?: StrategyAttackBasis;
}

export type StrategyAttackBasis =
  | Readonly<{ kind: 'executed-set' }>
  | Readonly<{ kind: 'chained-quick'; parentSetDecisionId: string }>;

export interface StrategySetPlayRequest {
  readonly set: Omit<StrategyDecisionRequest, 'kind' | 'attackBasis'> & Readonly<{ kind: 'set' }>;
  readonly quickAttackOwnership: string;
  readonly quickAllowed: boolean;
  readonly acceptQuickTarget: (target: StrategyPoint2) => boolean;
}

export interface CommittedStrategyDecision {
  readonly decisionId: string;
  readonly matchEpoch: number;
  readonly side: TeamSide;
  readonly sequence: number;
  readonly kind: StrategyDecisionKind;
  readonly decisionTick: number;
  readonly observationTick: number;
  readonly memoryRevision: number;
  readonly ownership: string;
  readonly setterAthleteId?: number;
  readonly attackOriginZ?: number;
  readonly attackBasis?: StrategyAttackBasis;
  readonly proposal: StrategyProposal;
}

export interface StrategyOwnershipRecord {
  readonly matchEpoch: number;
  readonly side: TeamSide;
  readonly kind: StrategyDecisionKind;
  readonly ownership: string;
}

export type StrategyOutcomeStatus = 'pending' | 'resolved' | 'revoked';

export interface StrategyOutcomeRecord {
  readonly decisionId: string;
  readonly status: StrategyOutcomeStatus;
  readonly side: TeamSide;
  readonly kind: StrategyDecisionKind;
  readonly optionId: StrategyOptionId;
  readonly effectiveness?: number;
}

export type StrategyOutboxEvent =
  | Readonly<{ type: 'decision-committed'; decision: CommittedStrategyDecision }>
  | Readonly<{ type: 'outcome-terminal'; outcome: StrategyOutcomeRecord }>;

export interface OpponentStrategySnapshot {
  readonly version: number;
  readonly matchEpoch: number;
  readonly sequences: readonly [number, number];
  readonly perceptionFrames: readonly StrategyObservation[];
  readonly memories: readonly [StrategyMemorySnapshot, StrategyMemorySnapshot];
  readonly ownerships: readonly StrategyOwnershipRecord[];
  readonly decisions: readonly CommittedStrategyDecision[];
  readonly outcomes: readonly StrategyOutcomeRecord[];
  readonly outbox: readonly StrategyOutboxEvent[];
}

export type StrategyPerceptionResult =
  | Readonly<{ status: 'not-ready' }>
  | Readonly<{ status: 'ready'; observation: StrategyObservation }>;

export type StrategyCommitResult =
  | Readonly<{ status: 'invalid-request'; existingDecisionId?: string }>
  | Readonly<{ status: 'not-ready' }>
  | Readonly<{ status: 'committed'; decision: CommittedStrategyDecision }>;

export type StrategySetPlayCommitResult =
  | Readonly<{ status: 'invalid-request' }>
  | Readonly<{ status: 'not-ready' }>
  | Readonly<{ status: 'quick-unavailable' }>
  | Readonly<{
      status: 'committed';
      set: CommittedStrategyDecision;
      quickAttack?: CommittedStrategyDecision;
    }>;

interface StrategyBrainPort {
  decide(context: StrategyDecisionContext): StrategyProposal;
}

interface OpponentStrategySystemOptions {
  readonly streams: Readonly<{ home: RandomSource; away: RandomSource }>;
  readonly brain?: StrategyBrainPort;
  readonly sink?: (event: StrategyOutboxEvent) => void;
}

const NOT_READY = Object.freeze({ status: 'not-ready' } as const);
const INVALID_REQUEST = Object.freeze({ status: 'invalid-request' } as const);
const QUICK_UNAVAILABLE = Object.freeze({ status: 'quick-unavailable' } as const);

function deepFreezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object' || Object.isFrozen(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      if (typeof child === 'number' && Object.is(child, -0)) {
        (entry as Record<string, unknown>)[key] = 0;
      } else {
        freeze(child);
      }
    }
    Object.freeze(entry);
  };
  freeze(copy);
  return copy;
}

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
}

function validKind(kind: unknown): kind is StrategyDecisionKind {
  return kind === 'serve' || kind === 'set' || kind === 'attack';
}

function kindOf(optionId: string): StrategyDecisionKind | null {
  const prefix = optionId.slice(0, optionId.indexOf('.'));
  return validKind(prefix) ? prefix : null;
}

function finitePoint(point: unknown, includeY: boolean): boolean {
  if (point === null || typeof point !== 'object') return false;
  const candidate = point as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.z === 'number' &&
    Number.isFinite(candidate.z) &&
    (!includeY || (typeof candidate.y === 'number' && Number.isFinite(candidate.y)))
  );
}

function validateObservation(observation: StrategyObservation): void {
  if (!Number.isSafeInteger(observation.tick) || observation.tick < 0) {
    throw new RangeError('tick da observação inválido');
  }
  if (
    observation.score.length !== 2 ||
    observation.score.some((score) => !Number.isSafeInteger(score) || score < 0)
  ) {
    throw new RangeError('placar da observação inválido');
  }
  if (!validSide(observation.servingSide)) throw new RangeError('servingSide inválido');
  if (
    !['idle', 'serve-prep', 'rally', 'point', 'set-end', 'match-end'].includes(observation.phase)
  ) {
    throw new RangeError('phase da observação inválida');
  }
  if (observation.possessionSide !== null && !validSide(observation.possessionSide)) {
    throw new RangeError('possessionSide inválido');
  }
  if (
    !Number.isInteger(observation.possessionTouches) ||
    observation.possessionTouches < 0 ||
    observation.possessionTouches > 3
  ) {
    throw new RangeError('possessionTouches inválido');
  }
  if (
    !finitePoint(observation.ball.position, true) ||
    !finitePoint(observation.ball.velocity, true)
  ) {
    throw new RangeError('bola observada exige valores finitos');
  }
  if (typeof observation.ball.inFlight !== 'boolean') {
    throw new RangeError('inFlight da bola deve ser booleano');
  }
  const contactTick = observation.ball.lastVisibleContactTick;
  if (
    contactTick !== null &&
    (!Number.isSafeInteger(contactTick) || contactTick < 0 || contactTick > observation.tick)
  ) {
    throw new RangeError('lastVisibleContactTick inválido');
  }
  if (observation.athletes.length !== 12) throw new RangeError('observação exige 12 atletas');
  const identities = new Set<string>();
  const slots = [new Set<number>(), new Set<number>()];
  const counts = [0, 0];
  for (const athlete of observation.athletes) {
    if (!validSide(athlete.side)) throw new RangeError('lado de atleta inválido');
    if (!Number.isSafeInteger(athlete.id) || athlete.id < 0) throw new RangeError('id inválido');
    if (!Number.isInteger(athlete.slot) || athlete.slot < 0 || athlete.slot > 5) {
      throw new RangeError('slot inválido');
    }
    const identity = `${athlete.side}:${athlete.id}`;
    if (identities.has(identity)) throw new RangeError('atleta duplicada');
    identities.add(identity);
    counts[athlete.side]++;
    slots[athlete.side].add(athlete.slot);
    if ((athlete.slot <= 2 ? 'back' : 'front') !== athlete.row) {
      throw new RangeError('row incompatível com slot');
    }
    if (!finitePoint(athlete.position, false) || !finitePoint(athlete.velocity, false)) {
      throw new RangeError('atleta exige valores finitos');
    }
    if (typeof athlete.airborne !== 'boolean') throw new RangeError('airborne deve ser booleano');
  }
  if (counts.some((count) => count !== 6) || slots.some((sideSlots) => sideSlots.size !== 6)) {
    throw new RangeError('observação exige roster completo por lado');
  }
}

function validateMemory(memory: StrategyMemorySnapshot): void {
  if (!Number.isSafeInteger(memory.revision) || memory.revision < 0) {
    throw new RangeError('revision de memória inválida');
  }
  const outcomeCounts = new Map<StrategyDecisionKind, number>();
  for (const outcome of memory.outcomes) {
    if (
      !KNOWN_OPTIONS.has(outcome.optionId) ||
      kindOf(outcome.optionId) !== outcome.kind ||
      !Number.isFinite(outcome.effectiveness) ||
      outcome.effectiveness < 0 ||
      outcome.effectiveness > 1
    ) {
      throw new RangeError('outcome de memória inválido');
    }
    const count = (outcomeCounts.get(outcome.kind) ?? 0) + 1;
    if (count > 6) throw new RangeError('cap de outcomes excedido');
    outcomeCounts.set(outcome.kind, count);
  }
  const choiceCounts = new Map<StrategyDecisionKind, number>();
  for (const choice of memory.recentChoices) {
    if (!KNOWN_OPTIONS.has(choice)) throw new RangeError('escolha de memória inválida');
    const kind = kindOf(choice)!;
    const count = (choiceCounts.get(kind) ?? 0) + 1;
    if (count > 3) throw new RangeError('cap de escolhas excedido');
    choiceCounts.set(kind, count);
  }
}

interface ProposalExpectation {
  readonly kind: StrategyDecisionKind;
  readonly side: TeamSide;
  readonly observationTick: number;
  readonly ticket: StrategyProposal['ticket'];
  readonly attackOriginZ?: number;
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function validateProposal(proposal: StrategyProposal, expected: ProposalExpectation): void {
  if (
    proposal.kind !== expected.kind ||
    proposal.side !== expected.side ||
    proposal.observationTick !== expected.observationTick ||
    !isUint32(proposal.ticket.selection) ||
    !isUint32(proposal.ticket.variation) ||
    proposal.ticket.selection !== expected.ticket.selection ||
    proposal.ticket.variation !== expected.ticket.variation ||
    proposal.candidates.length === 0
  ) {
    throw new Error('proposal estratégica incompatível');
  }
  const localAttackOriginZ =
    expected.attackOriginZ === undefined
      ? undefined
      : strategyToLocal({ x: 0, z: expected.attackOriginZ }, expected.side).z;
  const canonical = new Map(
    canonicalStrategyOptions(expected.kind, { attackOriginZ: localAttackOriginZ }).map((option) => [
      option.optionId,
      option,
    ]),
  );
  const ids = new Set<StrategyOptionId>();
  let probabilitySum = 0;
  for (const candidate of proposal.candidates) {
    const canonicalOption = canonical.get(candidate.optionId);
    const localTarget = strategyToLocal(candidate.target, expected.side);
    if (
      candidate.kind !== expected.kind ||
      !KNOWN_OPTIONS.has(candidate.optionId) ||
      kindOf(candidate.optionId) !== candidate.kind ||
      !canonicalOption ||
      candidate.family !== canonicalOption.family ||
      ids.has(candidate.optionId) ||
      !finitePoint(candidate.target, false) ||
      Math.abs(localTarget.x) > COURT.halfLength ||
      Math.abs(localTarget.z) > COURT.halfWidth ||
      Math.abs(localTarget.x - canonicalOption.center.x) > canonicalOption.halfSize.x + 1e-9 ||
      Math.abs(localTarget.z - canonicalOption.center.z) > canonicalOption.halfSize.z + 1e-9 ||
      !Number.isFinite(candidate.score) ||
      candidate.score < 0 ||
      candidate.score > 1 ||
      !Number.isFinite(candidate.probability) ||
      candidate.probability < 0 ||
      candidate.probability > 1 ||
      Object.values(candidate.components).some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1,
      )
    ) {
      throw new Error('proposal contém candidata inválida');
    }
    ids.add(candidate.optionId);
    probabilitySum += candidate.probability;
  }
  if (Math.abs(probabilitySum - 1) > 1e-9 || !ids.has(proposal.chosen.optionId)) {
    throw new Error('proposal possui escolha ou probabilidades inválidas');
  }
  const chosen = proposal.candidates.find(
    (candidate) => candidate.optionId === proposal.chosen.optionId,
  );
  if (!chosen || JSON.stringify(chosen) !== JSON.stringify(proposal.chosen)) {
    throw new Error('proposal chosen não referencia candidata canônica');
  }
}

function validAttackBasis(attackBasis: unknown): attackBasis is StrategyAttackBasis {
  if (attackBasis === null || typeof attackBasis !== 'object') return false;
  const basis = attackBasis as Partial<StrategyAttackBasis>;
  return (
    basis.kind === 'executed-set' ||
    (basis.kind === 'chained-quick' &&
      typeof basis.parentSetDecisionId === 'string' &&
      basis.parentSetDecisionId.trim().length > 0)
  );
}

function validateRequestShape(request: StrategyDecisionRequest): boolean {
  return (
    Number.isSafeInteger(request.matchEpoch) &&
    request.matchEpoch >= 0 &&
    validSide(request.side) &&
    validKind(request.kind) &&
    [0, 1, 2].includes(request.difficulty) &&
    Number.isSafeInteger(request.decisionTick) &&
    request.decisionTick >= 0 &&
    typeof request.ownership === 'string' &&
    request.ownership.trim().length > 0 &&
    (request.kind === 'attack'
      ? validAttackBasis(request.attackBasis)
      : request.attackBasis === undefined)
  );
}

function sideLabel(side: TeamSide): string {
  return side === TeamSide.HOME ? 'home' : 'away';
}

function ownershipKey(
  ownership: Pick<StrategyOwnershipRecord, 'matchEpoch' | 'side' | 'kind' | 'ownership'>,
): string {
  return JSON.stringify([
    ownership.matchEpoch,
    ownership.side,
    ownership.kind,
    ownership.ownership,
  ]);
}

export class OpponentStrategySystem {
  private readonly streams: Readonly<{ home: RandomSource; away: RandomSource }>;
  private readonly brain: StrategyBrainPort;
  private readonly sink?: (event: StrategyOutboxEvent) => void;
  private sinkEnabled = true;
  private currentMatchEpoch = 0;
  private sequences: [number, number] = [0, 0];
  private perceptionFrames: (StrategyObservation | PackedStrategyObservation)[] = [];
  private perceptionStart = 0;
  private perceptionCount = 0;
  private memories: [StrategyMemorySnapshot, StrategyMemorySnapshot] = [
    createStrategyMemory(),
    createStrategyMemory(),
  ];
  private ownerships: StrategyOwnershipRecord[] = [];
  private ownershipKeySet: ReadonlySet<string> = new Set();
  private decisions: CommittedStrategyDecision[] = [];
  private outcomes: StrategyOutcomeRecord[] = [];
  private outbox: StrategyOutboxEvent[] = [];

  constructor(options: OpponentStrategySystemOptions) {
    this.streams = options.streams;
    this.brain = options.brain ?? new OpponentBrain();
    this.sink = options.sink;
  }

  get matchEpoch(): number {
    return this.currentMatchEpoch;
  }

  captureFrame(observation: StrategyObservation): void {
    validateObservation(observation);
    this.captureAcceptedFrame(deepFreezeCopy(observation));
  }

  /** Fast path interno: aceita apenas DTO frozen produzido pelo adaptador whitelisted. */
  captureCanonicalFrame(observation: StrategyObservation): void {
    if (!isCanonicalStrategyObservation(observation)) {
      throw new RangeError('observação não é canônica');
    }
    this.captureAcceptedFrame(observation);
  }

  /** Fast path compacta autenticada; o DTO público só é materializado quando observado. */
  capturePackedFrame(observation: PackedStrategyObservation): void {
    if (!isPackedStrategyObservation(observation)) {
      throw new RangeError('observação compacta não é canônica');
    }
    this.captureAcceptedFrame(observation);
  }

  private captureAcceptedFrame(observation: StrategyObservation | PackedStrategyObservation): void {
    const latestTick = this.perceptionFrameAt(this.perceptionCount - 1)?.tick;
    if (latestTick !== undefined && observation.tick < latestTick) {
      throw new RangeError('tick regressivo na captura estratégica');
    }
    if (latestTick === observation.tick) return;
    if (this.perceptionCount < PERCEPTION_RING_CAPACITY) {
      const physicalIndex =
        (this.perceptionStart + this.perceptionCount) % PERCEPTION_RING_CAPACITY;
      this.perceptionFrames[physicalIndex] = observation;
      this.perceptionCount++;
      return;
    }
    this.perceptionFrames[this.perceptionStart] = observation;
    this.perceptionStart = (this.perceptionStart + 1) % PERCEPTION_RING_CAPACITY;
  }

  perceive(
    side: TeamSide,
    difficulty: StrategyDifficulty,
    decisionTick: number,
  ): StrategyPerceptionResult {
    if (!validSide(side) || ![0, 1, 2].includes(difficulty)) {
      throw new RangeError('política de percepção inválida');
    }
    if (!Number.isSafeInteger(decisionTick) || decisionTick < 0) {
      throw new RangeError('decisionTick inválido');
    }
    const cutoff = decisionTick - PERCEPTION_DELAY_TICKS[difficulty];
    for (let index = this.perceptionCount - 1; index >= 0; index--) {
      const observation = this.materializedPerceptionFrameAt(index);
      if (observation.tick <= cutoff) {
        return Object.freeze({ status: 'ready', observation });
      }
    }
    return NOT_READY;
  }

  memory(side: TeamSide): StrategyMemorySnapshot {
    if (!validSide(side)) throw new RangeError('side inválido');
    return this.memories[side];
  }

  /** Compromete set e, somente se quick, seu ataque filho numa transação estocástica única. */
  commitSetPlay(request: StrategySetPlayRequest): StrategySetPlayCommitResult {
    if (
      request.set.kind !== 'set' ||
      ('attackBasis' in request.set && request.set.attackBasis !== undefined) ||
      typeof request.quickAttackOwnership !== 'string' ||
      request.quickAttackOwnership.trim().length === 0 ||
      typeof request.quickAllowed !== 'boolean' ||
      typeof request.acceptQuickTarget !== 'function'
    ) {
      return INVALID_REQUEST;
    }
    const homeBefore = this.streams.home.snapshot();
    const awayBefore = this.streams.away.snapshot();
    const systemBefore = this.checkpoint();
    const rollback = (): void => {
      this.streams.home.restore(homeBefore);
      this.streams.away.restore(awayBefore);
      this.restoreCheckpoint(systemBefore);
    };
    try {
      const setResult = this.commitDecision(request.set);
      if (setResult.status === 'invalid-request') return INVALID_REQUEST;
      if (setResult.status === 'not-ready') return NOT_READY;
      if (setResult.decision.proposal.chosen.optionId !== 'set.quick-center') {
        return Object.freeze({ status: 'committed' as const, set: setResult.decision });
      }
      if (
        !request.quickAllowed ||
        !request.acceptQuickTarget(setResult.decision.proposal.chosen.target)
      ) {
        rollback();
        return QUICK_UNAVAILABLE;
      }
      const attackResult = this.commitDecision({
        matchEpoch: request.set.matchEpoch,
        side: request.set.side,
        kind: 'attack',
        difficulty: request.set.difficulty,
        decisionTick: request.set.decisionTick,
        ownership: request.quickAttackOwnership,
        ownContactRead: request.set.ownContactRead,
        attackBasis: {
          kind: 'chained-quick',
          parentSetDecisionId: setResult.decision.decisionId,
        },
      });
      if (attackResult.status !== 'committed') {
        rollback();
        return attackResult.status === 'not-ready' ? NOT_READY : INVALID_REQUEST;
      }
      return Object.freeze({
        status: 'committed' as const,
        set: setResult.decision,
        quickAttack: attackResult.decision,
      });
    } catch (error) {
      rollback();
      throw error;
    }
  }

  commitDecision(request: StrategyDecisionRequest): StrategyCommitResult {
    if (!validateRequestShape(request) || request.matchEpoch !== this.currentMatchEpoch) {
      return INVALID_REQUEST;
    }
    if (this.ownershipKeySet.has(ownershipKey(request))) {
      const existing = this.decisions.find(
        (decision) =>
          decision.matchEpoch === request.matchEpoch &&
          decision.side === request.side &&
          decision.kind === request.kind &&
          decision.ownership === request.ownership,
      );
      return existing
        ? Object.freeze({
            status: 'invalid-request' as const,
            existingDecisionId: existing.decisionId,
          })
        : INVALID_REQUEST;
    }
    let ownContactRead: OwnContactRead | undefined;
    let attackOriginZ: number | undefined;
    if (request.kind === 'serve') {
      if (request.ownContactRead !== undefined) return INVALID_REQUEST;
    } else {
      if (!request.ownContactRead) return INVALID_REQUEST;
      try {
        ownContactRead = buildOwnContactRead(request.ownContactRead);
      } catch {
        return INVALID_REQUEST;
      }
      if (
        ownContactRead.side !== request.side ||
        ownContactRead.tick !== request.decisionTick ||
        (request.kind === 'set' && ownContactRead.kind !== 'pass' && ownContactRead.kind !== 'dig')
      ) {
        return INVALID_REQUEST;
      }
    }
    if (
      request.kind === 'set' &&
      (!Number.isSafeInteger(request.setterAthleteId) ||
        request.setterAthleteId! < 0 ||
        !ownContactRead!.ownAthletes.some((athlete) => athlete.id === request.setterAthleteId))
    ) {
      return INVALID_REQUEST;
    }
    let chainedQuickObservationTick: number | undefined;
    if (request.kind === 'attack') {
      const basis = request.attackBasis!;
      if (basis.kind === 'executed-set') {
        if (ownContactRead!.kind !== 'set') return INVALID_REQUEST;
        const origin = deriveAttackOriginFromExecutedSet(ownContactRead!);
        if (!origin) return INVALID_REQUEST;
        attackOriginZ = origin.position.z;
      } else {
        if (ownContactRead!.kind !== 'pass' && ownContactRead!.kind !== 'dig') {
          return INVALID_REQUEST;
        }
        const parent = this.decisions.find(
          (decision) => decision.decisionId === basis.parentSetDecisionId,
        );
        const parentOutcome = this.outcomes.find(
          (outcome) => outcome.decisionId === basis.parentSetDecisionId,
        );
        if (
          !parent ||
          !parentOutcome ||
          parent.matchEpoch !== request.matchEpoch ||
          parent.side !== request.side ||
          parent.kind !== 'set' ||
          parent.decisionTick !== request.decisionTick ||
          parentOutcome.status !== 'pending' ||
          parent.proposal.chosen.optionId !== 'set.quick-center' ||
          parent.proposal.chosen.family !== 'quick'
        ) {
          return INVALID_REQUEST;
        }
        chainedQuickObservationTick = parent.observationTick;
        if (
          this.decisions.some(
            (decision) =>
              decision.kind === 'attack' &&
              decision.attackBasis?.kind === 'chained-quick' &&
              decision.attackBasis.parentSetDecisionId === basis.parentSetDecisionId,
          )
        ) {
          return INVALID_REQUEST;
        }
        attackOriginZ = parent.proposal.chosen.target.z;
      }
    }
    const perception = this.perceive(request.side, request.difficulty, request.decisionTick);
    if (perception.status === 'not-ready') return NOT_READY;
    if (
      chainedQuickObservationTick !== undefined &&
      perception.observation.tick !== chainedQuickObservationTick
    ) {
      return INVALID_REQUEST;
    }

    const stream = request.side === TeamSide.HOME ? this.streams.home : this.streams.away;
    const streamBefore = stream.snapshot();
    const systemBefore = this.checkpoint();
    try {
      const ticket = Object.freeze({
        selection: stream.nextUint32(),
        variation: stream.nextUint32(),
      });
      const memory = this.memories[request.side];
      const context: StrategyDecisionContext = {
        side: request.side,
        kind: request.kind,
        difficulty: request.difficulty,
        decisionTick: request.decisionTick,
        observation: perception.observation,
        memory,
        ticket,
        ownContactRead,
        setterAthleteId: request.setterAthleteId,
        attackOriginZ,
      };
      const proposal = this.brain.decide(context);
      validateProposal(proposal, {
        kind: context.kind,
        side: context.side,
        observationTick: context.observation.tick,
        ticket: context.ticket,
        attackOriginZ,
      });

      const sequence = this.sequences[request.side] + 1;
      const decisionId = `${this.currentMatchEpoch}:${sideLabel(request.side)}:${sequence}`;
      const decision = deepFreezeCopy<CommittedStrategyDecision>({
        decisionId,
        matchEpoch: this.currentMatchEpoch,
        side: request.side,
        sequence,
        kind: request.kind,
        decisionTick: request.decisionTick,
        observationTick: perception.observation.tick,
        memoryRevision: memory.revision,
        ownership: request.ownership,
        setterAthleteId: request.setterAthleteId,
        attackOriginZ,
        attackBasis: request.attackBasis,
        proposal,
      });
      this.sequences[request.side] = sequence;
      this.decisions = [...this.decisions, decision];
      const ownership = Object.freeze({
        matchEpoch: request.matchEpoch,
        side: request.side,
        kind: request.kind,
        ownership: request.ownership,
      });
      this.ownerships = [...this.ownerships, ownership];
      this.ownershipKeySet = new Set([...this.ownershipKeySet, ownershipKey(ownership)]);
      this.outcomes = [
        ...this.outcomes,
        Object.freeze({
          decisionId,
          status: 'pending',
          side: request.side,
          kind: request.kind,
          optionId: proposal.chosen.optionId,
        }),
      ];
      this.enqueueOutbox(Object.freeze({ type: 'decision-committed', decision }));
      return Object.freeze({ status: 'committed', decision });
    } catch (error) {
      stream.restore(streamBefore);
      this.restoreCheckpoint(systemBefore);
      throw error;
    }
  }

  outcomeState(decisionId: string): StrategyOutcomeStatus {
    const outcome = this.outcomes.find((entry) => entry.decisionId === decisionId);
    if (!outcome) throw new Error(`outcome desconhecido: ${decisionId}`);
    return outcome.status;
  }

  resolveOutcome(decisionId: string, effectiveness: number): void {
    if (!Number.isFinite(effectiveness) || effectiveness < 0 || effectiveness > 1) {
      throw new RangeError('effectiveness terminal deve estar em [0,1]');
    }
    const index = this.pendingOutcomeIndex(decisionId);
    const current = this.outcomes[index];
    const withChoice = recordStrategyChoice(this.memories[current.side], current.optionId);
    const learned = recordStrategyOutcome(withChoice, {
      kind: current.kind,
      optionId: current.optionId,
      effectiveness,
    });
    const terminal = Object.freeze({ ...current, status: 'resolved' as const, effectiveness });
    this.outcomes = this.outcomes.map((outcome, outcomeIndex) =>
      outcomeIndex === index ? terminal : outcome,
    );
    this.memories =
      current.side === TeamSide.HOME
        ? [learned, this.memories[TeamSide.AWAY]]
        : [this.memories[TeamSide.HOME], learned];
    this.enqueueOutbox(Object.freeze({ type: 'outcome-terminal', outcome: terminal }));
    this.pruneTerminalHistory();
  }

  revokeDecision(decisionId: string): void {
    const index = this.pendingOutcomeIndex(decisionId);
    const current = this.outcomes[index];
    const terminal = Object.freeze({ ...current, status: 'revoked' as const });
    this.outcomes = this.outcomes.map((outcome, outcomeIndex) =>
      outcomeIndex === index ? terminal : outcome,
    );
    this.enqueueOutbox(Object.freeze({ type: 'outcome-terminal', outcome: terminal }));
    this.pruneTerminalHistory();
  }

  startSet(): void {
    // A memória é deliberadamente persistente durante toda a partida.
  }

  startMatch(): void {
    const pending = this.outcomes.filter((outcome) => outcome.status === 'pending');
    this.outcomes = this.outcomes.map((outcome) =>
      outcome.status === 'pending'
        ? Object.freeze({ ...outcome, status: 'revoked' as const })
        : outcome,
    );
    for (const outcome of pending) {
      const terminal = this.outcomes.find((entry) => entry.decisionId === outcome.decisionId)!;
      this.enqueueOutbox(
        Object.freeze({
          type: 'outcome-terminal',
          outcome: terminal,
        }),
      );
    }
    this.currentMatchEpoch++;
    this.memories = [resetStrategyMemory(this.memories[0]), resetStrategyMemory(this.memories[1])];
    this.ownerships = [];
    this.ownershipKeySet = new Set();
    this.perceptionFrames = [];
    this.perceptionStart = 0;
    this.perceptionCount = 0;
    this.pruneTerminalHistory();
  }

  flushOutbox(): void {
    if (!this.sink || !this.sinkEnabled || this.outbox.length === 0) return;
    const pending = this.outbox;
    this.outbox = [];
    try {
      for (const event of pending) this.sink(event);
    } catch {
      this.sinkEnabled = false;
    }
    this.pruneTerminalHistory();
  }

  snapshot(): OpponentStrategySnapshot {
    return deepFreezeCopy({
      version: OPPONENT_STRATEGY_SNAPSHOT_VERSION,
      matchEpoch: this.currentMatchEpoch,
      sequences: [this.sequences[0], this.sequences[1]] as const,
      perceptionFrames: this.perceptionFramesInOrder(),
      memories: [this.memories[0], this.memories[1]] as const,
      ownerships: this.ownerships,
      decisions: this.decisions,
      outcomes: this.outcomes,
      outbox: this.outbox,
    });
  }

  restore(snapshot: OpponentStrategySnapshot): void {
    validateSnapshot(snapshot);
    this.applySnapshot(deepFreezeCopy(snapshot));
  }

  private pendingOutcomeIndex(decisionId: string): number {
    const index = this.outcomes.findIndex((entry) => entry.decisionId === decisionId);
    if (index < 0) throw new Error(`outcome desconhecido: ${decisionId}`);
    if (this.outcomes[index].status !== 'pending') {
      throw new Error(`outcome já recebeu estado terminal: ${decisionId}`);
    }
    return index;
  }

  private enqueueOutbox(event: StrategyOutboxEvent): void {
    if (!this.sink || !this.sinkEnabled) return;
    this.outbox = [...this.outbox, event];
  }

  private pruneTerminalHistory(): void {
    const protectedIds = new Set(
      this.outbox.map((event) =>
        event.type === 'decision-committed' ? event.decision.decisionId : event.outcome.decisionId,
      ),
    );
    const removeIds = new Set<string>();
    for (const side of [TeamSide.HOME, TeamSide.AWAY] as const) {
      const removable = this.outcomes.filter(
        (outcome) =>
          outcome.side === side &&
          outcome.status !== 'pending' &&
          !protectedIds.has(outcome.decisionId),
      );
      const excess = removable.length - TERMINAL_HISTORY_CAPACITY_PER_SIDE;
      for (let index = 0; index < excess; index++) removeIds.add(removable[index].decisionId);
    }
    if (removeIds.size === 0) return;
    this.outcomes = this.outcomes.filter((outcome) => !removeIds.has(outcome.decisionId));
    this.decisions = this.decisions.filter((decision) => !removeIds.has(decision.decisionId));
  }

  private checkpoint(): {
    readonly matchEpoch: number;
    readonly sequences: readonly [number, number];
    readonly perceptionFrames: (StrategyObservation | PackedStrategyObservation)[];
    readonly perceptionStart: number;
    readonly perceptionCount: number;
    readonly memories: [StrategyMemorySnapshot, StrategyMemorySnapshot];
    readonly ownerships: StrategyOwnershipRecord[];
    readonly ownershipKeySet: ReadonlySet<string>;
    readonly decisions: CommittedStrategyDecision[];
    readonly outcomes: StrategyOutcomeRecord[];
    readonly outbox: StrategyOutboxEvent[];
    readonly sinkEnabled: boolean;
  } {
    return {
      matchEpoch: this.currentMatchEpoch,
      sequences: [this.sequences[0], this.sequences[1]],
      perceptionFrames: [...this.perceptionFrames],
      perceptionStart: this.perceptionStart,
      perceptionCount: this.perceptionCount,
      memories: this.memories,
      ownerships: this.ownerships,
      ownershipKeySet: this.ownershipKeySet,
      decisions: this.decisions,
      outcomes: this.outcomes,
      outbox: this.outbox,
      sinkEnabled: this.sinkEnabled,
    };
  }

  private restoreCheckpoint(checkpoint: ReturnType<OpponentStrategySystem['checkpoint']>): void {
    this.currentMatchEpoch = checkpoint.matchEpoch;
    this.sequences = [checkpoint.sequences[0], checkpoint.sequences[1]];
    this.perceptionFrames = checkpoint.perceptionFrames;
    this.perceptionStart = checkpoint.perceptionStart;
    this.perceptionCount = checkpoint.perceptionCount;
    this.memories = checkpoint.memories;
    this.ownerships = checkpoint.ownerships;
    this.ownershipKeySet = checkpoint.ownershipKeySet;
    this.decisions = checkpoint.decisions;
    this.outcomes = checkpoint.outcomes;
    this.outbox = checkpoint.outbox;
    this.sinkEnabled = checkpoint.sinkEnabled;
  }

  private applySnapshot(snapshot: OpponentStrategySnapshot): void {
    const frozen = deepFreezeCopy(snapshot);
    this.currentMatchEpoch = frozen.matchEpoch;
    this.sequences = [frozen.sequences[0], frozen.sequences[1]];
    this.perceptionFrames = [...frozen.perceptionFrames];
    this.perceptionStart = 0;
    this.perceptionCount = frozen.perceptionFrames.length;
    this.memories = [frozen.memories[0], frozen.memories[1]];
    this.ownerships = [...frozen.ownerships];
    this.ownershipKeySet = new Set(frozen.ownerships.map(ownershipKey));
    this.decisions = [...frozen.decisions];
    this.outcomes = [...frozen.outcomes];
    this.outbox = [...frozen.outbox];
  }

  private perceptionFrameAt(
    index: number,
  ): StrategyObservation | PackedStrategyObservation | undefined {
    if (index < 0 || index >= this.perceptionCount) return undefined;
    return this.perceptionFrames[(this.perceptionStart + index) % PERCEPTION_RING_CAPACITY];
  }

  private perceptionFramesInOrder(): StrategyObservation[] {
    return Array.from({ length: this.perceptionCount }, (_, index) =>
      this.materializedPerceptionFrameAt(index),
    );
  }

  private materializedPerceptionFrameAt(index: number): StrategyObservation {
    const frame = this.perceptionFrameAt(index);
    if (!frame) throw new RangeError('índice do ring de percepção inválido');
    if (!isPackedStrategyObservation(frame)) return frame;
    const materialized = materializePackedStrategyObservation(frame);
    const physicalIndex = (this.perceptionStart + index) % PERCEPTION_RING_CAPACITY;
    this.perceptionFrames[physicalIndex] = materialized;
    return materialized;
  }
}

function validateSnapshot(snapshot: OpponentStrategySnapshot): void {
  if (snapshot === null || typeof snapshot !== 'object') throw new RangeError('snapshot inválido');
  if (snapshot.version !== OPPONENT_STRATEGY_SNAPSHOT_VERSION) {
    throw new RangeError('version de snapshot incompatível');
  }
  if (!Number.isSafeInteger(snapshot.matchEpoch) || snapshot.matchEpoch < 0) {
    throw new RangeError('matchEpoch inválido');
  }
  if (
    snapshot.sequences.length !== 2 ||
    snapshot.sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 0)
  ) {
    throw new RangeError('sequences inválidas');
  }
  if (snapshot.perceptionFrames.length > PERCEPTION_RING_CAPACITY) {
    throw new RangeError('cap do ring de percepção excedido');
  }
  let previousTick = -1;
  for (const frame of snapshot.perceptionFrames) {
    validateObservation(frame);
    if (frame.tick <= previousTick)
      throw new RangeError('ticks do ring não são estritamente monotônicos');
    previousTick = frame.tick;
  }
  if (snapshot.memories.length !== 2) throw new RangeError('snapshot exige duas memórias');
  snapshot.memories.forEach(validateMemory);

  const ownershipKeys = new Set<string>();
  for (const ownership of snapshot.ownerships) {
    const key = ownershipKey(ownership);
    if (
      ownership.matchEpoch !== snapshot.matchEpoch ||
      !validSide(ownership.side) ||
      !validKind(ownership.kind) ||
      typeof ownership.ownership !== 'string' ||
      ownership.ownership.trim().length === 0 ||
      ownershipKeys.has(key)
    ) {
      throw new RangeError('ownership estratégico inválido');
    }
    ownershipKeys.add(key);
  }

  const decisionById = new Map<string, CommittedStrategyDecision>();
  const maximumSequence = [0, 0];
  const previousSequence = [0, 0];
  for (const decision of snapshot.decisions) {
    if (
      typeof decision.decisionId !== 'string' ||
      decision.decisionId.length === 0 ||
      decision.decisionId !==
        `${decision.matchEpoch}:${sideLabel(decision.side)}:${decision.sequence}` ||
      decisionById.has(decision.decisionId) ||
      !validSide(decision.side) ||
      !validKind(decision.kind) ||
      !Number.isSafeInteger(decision.sequence) ||
      decision.sequence <= 0 ||
      decision.sequence > snapshot.sequences[decision.side] ||
      !Number.isSafeInteger(decision.matchEpoch) ||
      decision.matchEpoch < 0 ||
      decision.matchEpoch > snapshot.matchEpoch ||
      !Number.isSafeInteger(decision.decisionTick) ||
      !Number.isSafeInteger(decision.observationTick) ||
      decision.observationTick > decision.decisionTick ||
      !Number.isSafeInteger(decision.memoryRevision) ||
      decision.memoryRevision < 0 ||
      typeof decision.ownership !== 'string' ||
      decision.ownership.trim().length === 0 ||
      (decision.kind === 'set' &&
        (!Number.isSafeInteger(decision.setterAthleteId) || decision.setterAthleteId! < 0)) ||
      (decision.kind === 'attack' &&
        (!Number.isFinite(decision.attackOriginZ) ||
          Math.abs(decision.attackOriginZ!) > 4.5 ||
          !validAttackBasis(decision.attackBasis))) ||
      (decision.kind !== 'attack' && decision.attackBasis !== undefined)
    ) {
      throw new RangeError('decisão comprometida inválida');
    }
    if (decision.sequence <= previousSequence[decision.side]) {
      throw new RangeError('sequência por lado não é monotônica');
    }
    previousSequence[decision.side] = decision.sequence;
    validateProposal(decision.proposal, {
      kind: decision.kind,
      side: decision.side,
      observationTick: decision.observationTick,
      ticket: decision.proposal.ticket,
      attackOriginZ: decision.attackOriginZ,
    });
    if (decision.matchEpoch === snapshot.matchEpoch && !ownershipKeys.has(ownershipKey(decision))) {
      throw new RangeError('decisão atual sem ownership registrado');
    }
    decisionById.set(decision.decisionId, decision);
    maximumSequence[decision.side] = Math.max(maximumSequence[decision.side], decision.sequence);
  }
  const quickParentIds = new Set<string>();
  for (const decision of snapshot.decisions) {
    if (decision.attackBasis?.kind !== 'chained-quick') continue;
    const parentId = decision.attackBasis.parentSetDecisionId;
    const parent = decisionById.get(parentId);
    if (
      !parent ||
      quickParentIds.has(parentId) ||
      parent.matchEpoch !== decision.matchEpoch ||
      parent.side !== decision.side ||
      parent.kind !== 'set' ||
      parent.decisionTick !== decision.decisionTick ||
      parent.observationTick !== decision.observationTick ||
      parent.proposal.chosen.optionId !== 'set.quick-center' ||
      parent.proposal.chosen.family !== 'quick'
    ) {
      throw new RangeError('encadeamento quick inválido');
    }
    quickParentIds.add(parentId);
  }
  if (
    maximumSequence[TeamSide.HOME] !== snapshot.sequences[TeamSide.HOME] ||
    maximumSequence[TeamSide.AWAY] !== snapshot.sequences[TeamSide.AWAY]
  ) {
    throw new RangeError('sequences não correspondem às decisões comprometidas');
  }

  const outcomeIds = new Set<string>();
  for (let index = 0; index < snapshot.outcomes.length; index++) {
    const outcome = snapshot.outcomes[index];
    const decision = decisionById.get(outcome.decisionId);
    if (
      !decision ||
      snapshot.decisions[index]?.decisionId !== outcome.decisionId ||
      outcomeIds.has(outcome.decisionId) ||
      outcome.side !== decision.side ||
      outcome.kind !== decision.kind ||
      outcome.optionId !== decision.proposal.chosen.optionId ||
      (outcome.status === 'pending' && decision.matchEpoch !== snapshot.matchEpoch) ||
      !['pending', 'resolved', 'revoked'].includes(outcome.status) ||
      (outcome.status === 'resolved' &&
        (!Number.isFinite(outcome.effectiveness) ||
          outcome.effectiveness! < 0 ||
          outcome.effectiveness! > 1)) ||
      (outcome.status !== 'resolved' && outcome.effectiveness !== undefined)
    ) {
      throw new RangeError('referência de outcome inválida');
    }
    outcomeIds.add(outcome.decisionId);
  }
  if (outcomeIds.size !== decisionById.size) throw new RangeError('decisão sem outcome interno');
  const outboxState = new Map<string, { committed: boolean; terminal: boolean }>();
  const protectedDecisionIds = new Set<string>();
  for (const event of snapshot.outbox) {
    if (event.type === 'decision-committed') {
      const decision = decisionById.get(event.decision.decisionId);
      if (!decision || JSON.stringify(decision) !== JSON.stringify(event.decision)) {
        throw new RangeError('referência de decisão no outbox inválida');
      }
      const state = outboxState.get(event.decision.decisionId) ?? {
        committed: false,
        terminal: false,
      };
      if (state.committed || state.terminal) {
        throw new RangeError('evento decision-committed duplicado ou após terminal no outbox');
      }
      state.committed = true;
      outboxState.set(event.decision.decisionId, state);
      protectedDecisionIds.add(event.decision.decisionId);
      continue;
    }
    if (event.type === 'outcome-terminal') {
      const outcome = snapshot.outcomes.find(
        (entry) => entry.decisionId === event.outcome.decisionId,
      );
      if (
        !outcome ||
        event.outcome.status === 'pending' ||
        JSON.stringify(outcome) !== JSON.stringify(event.outcome)
      ) {
        throw new RangeError('referência de outcome no outbox inválida');
      }
      const state = outboxState.get(event.outcome.decisionId) ?? {
        committed: false,
        terminal: false,
      };
      if (state.terminal) throw new RangeError('evento outcome-terminal duplicado no outbox');
      state.terminal = true;
      outboxState.set(event.outcome.decisionId, state);
      protectedDecisionIds.add(event.outcome.decisionId);
      continue;
    }
    {
      throw new RangeError('referência de outbox inválida');
    }
  }
  for (const [decisionId, state] of outboxState) {
    const outcome = snapshot.outcomes.find((entry) => entry.decisionId === decisionId)!;
    if (state.committed && !state.terminal && outcome.status !== 'pending') {
      throw new RangeError('outbox com commit de outcome terminal exige evento terminal no lote');
    }
  }
  for (const side of [TeamSide.HOME, TeamSide.AWAY] as const) {
    const unprotectedTerminalCount = snapshot.outcomes.filter(
      (outcome) =>
        outcome.side === side &&
        outcome.status !== 'pending' &&
        !protectedDecisionIds.has(outcome.decisionId),
    ).length;
    if (unprotectedTerminalCount > TERMINAL_HISTORY_CAPACITY_PER_SIDE) {
      throw new RangeError('cap do histórico terminal desprotegido excedido');
    }
  }
}
