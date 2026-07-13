import { TeamSide, otherSide } from '../../core/constants';
import type { RandomSource } from '../../core/random';
import { OpponentStrategySystem, type StrategyOutboxEvent } from './OpponentStrategySystem';
import {
  serveReceptionEffectiveness,
  type ServeReceptionBallAfter,
  type ServeReceptionPoint2,
} from './ServeReceptionOutcome';
import {
  StrategyObservationPacker,
  type StrategyObservationBallSource,
  type StrategyObservationSource,
} from './StrategyObservationAdapter';
import {
  StrategicServeSystem,
  type ServeCommitmentRef,
  type ServeEpochToken,
  type ServeOutcomeToken,
  type StrategicServeCommitResult,
  type StrategicServeLaunchResult,
  type StrategicServeRealization,
} from './StrategicServeSystem';
import type {
  AttackBindResult,
  AttackConsumeResult,
  AttackDecisionDraft,
  AttackPrepareResult,
  BoundAttackCommitment,
} from './StrategicAttackTypes';
import {
  StrategicOffenseSystem,
  type BoundSetCommitment,
  type ObserveOffenseContactResult,
  type OffenseContactRef,
  type OffenseRallyRef,
  type SetBindResult,
  type SetConsumeResult,
  type SetPlanIdentity,
  type SetPrepareResult,
} from './StrategicOffenseSystem';
import type { OwnContactReadSource } from './OwnContactRead';
import type { StrategyDifficulty, StrategyMemorySnapshot, StrategyPhase } from './StrategyTypes';

export type MatchStrategyTickSource = Omit<StrategyObservationSource, 'ball'> &
  Readonly<{
    ball: Omit<StrategyObservationBallSource, 'lastVisibleContactTick'>;
  }>;

export interface MatchStrategyServeFacts {
  readonly phase: StrategyPhase;
  readonly servingSide: TeamSide;
  readonly serverAthleteId: number;
}

export interface MatchStrategyBallContact {
  readonly matchEpoch: number;
  readonly tick: number;
  readonly outcomeToken: ServeOutcomeToken | null;
  readonly side: TeamSide;
  readonly ballAfter: ServeReceptionBallAfter;
  readonly setterPosition: ServeReceptionPoint2;
}

export interface MatchStrategyPoint {
  readonly outcomeToken: ServeOutcomeToken | null;
  readonly servingSide: TeamSide;
  readonly winner: TeamSide;
  readonly ace: boolean;
}

type ServeGuardStage = 'toss' | 'hit';

/** Fronteira estrutural injetada pelo Match; os sistemas adaptativos permanecem privados. */
export interface MatchStrategyPort {
  readonly matchEpoch: number;
  startMatch(): void;
  startSet(): void;
  captureTick(source: MatchStrategyTickSource): void;
  beginServe(side: TeamSide, serverAthleteId: number): ServeEpochToken;
  commitServe(
    token: ServeEpochToken,
    difficulty: StrategyDifficulty,
    decisionTick: number,
  ): StrategicServeCommitResult;
  guardServe(
    ref: ServeCommitmentRef,
    stage: ServeGuardStage,
    facts: MatchStrategyServeFacts,
  ): boolean;
  markServeLaunched(
    ref: ServeCommitmentRef,
    realization: StrategicServeRealization,
  ): StrategicServeLaunchResult;
  beginOffenseRally(): OffenseRallyRef;
  endOffenseRally(rally: OffenseRallyRef): void;
  observeOffenseContact(
    rally: OffenseRallyRef,
    source: OwnContactReadSource,
    possessionTouches: 1 | 2 | 3,
  ): ObserveOffenseContactResult;
  prepareOffenseSet(contact: OffenseContactRef, difficulty: StrategyDifficulty): SetPrepareResult;
  bindOffenseSet(ref: OffenseContactRef, plan: SetPlanIdentity): SetBindResult;
  consumeOffenseSet(commitment: BoundSetCommitment, plan: SetPlanIdentity): SetConsumeResult;
  prepareOffenseAttack(
    setContact: OffenseContactRef,
    difficulty: StrategyDifficulty,
  ): AttackPrepareResult;
  bindOffenseAttack(draft: AttackDecisionDraft, plan: SetPlanIdentity): AttackBindResult;
  consumeOffenseAttack(
    commitment: BoundAttackCommitment,
    plan: SetPlanIdentity,
  ): AttackConsumeResult;
  resolveOffenseBlock(commitment: BoundAttackCommitment): boolean;
  resolveOffenseDefense(commitment: BoundAttackCommitment, effectiveness: number): boolean;
  resolveOffensePoint(rally: OffenseRallyRef, winner: TeamSide): boolean;
  onBallContact(contact: MatchStrategyBallContact): boolean;
  onPoint(point: MatchStrategyPoint): boolean;
  memory(side: TeamSide): StrategyMemorySnapshot;
  flush(): void;
}

interface ActiveOutcome {
  readonly token: ServeOutcomeToken;
  readonly servingSide: TeamSide;
}

const STALE = Object.freeze({ status: 'stale' } as const);

function sameServeToken(left: ServeEpochToken, right: ServeEpochToken): boolean {
  return (
    left.matchEpoch === right.matchEpoch &&
    left.serveEpoch === right.serveEpoch &&
    left.side === right.side &&
    left.serverAthleteId === right.serverAthleteId
  );
}

function sameOutcomeToken(left: ServeOutcomeToken, right: ServeOutcomeToken): boolean {
  return left.matchEpoch === right.matchEpoch && left.serveEpoch === right.serveEpoch;
}

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
}

function contactTick(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError('tick de contato deve ser inteiro seguro não negativo');
  }
  return Object.is(tick, -0) ? 0 : tick;
}

export class MatchStrategyBridge implements MatchStrategyPort {
  readonly #strategy: OpponentStrategySystem;
  readonly #serves: StrategicServeSystem;
  readonly #offense: StrategicOffenseSystem;
  readonly #observationPacker = new StrategyObservationPacker();
  #currentMatchEpoch = 0;
  #latestCapturedTick: number | null = null;
  #lastVisibleContactTick: number | null = null;
  #currentServe?: ServeEpochToken;
  #currentServeOpen = false;
  #activeOutcome?: ActiveOutcome;

  constructor(
    streams: Readonly<{ home: RandomSource; away: RandomSource }>,
    sink?: (event: StrategyOutboxEvent) => void,
  ) {
    this.#strategy = new OpponentStrategySystem({ streams, sink });
    this.#serves = new StrategicServeSystem(this.#strategy);
    this.#offense = new StrategicOffenseSystem(this.#strategy);
  }

  get matchEpoch(): number {
    return this.#currentMatchEpoch;
  }

  startMatch(): void {
    const nextEpoch = this.#currentMatchEpoch + 1;
    if (!Number.isSafeInteger(nextEpoch)) throw new RangeError('matchEpoch excedeu o limite');
    this.#serves.startMatch();
    this.#currentMatchEpoch = nextEpoch;
    this.#offense.resetForMatch(nextEpoch);
    this.#latestCapturedTick = null;
    this.#lastVisibleContactTick = null;
    this.#currentServe = undefined;
    this.#currentServeOpen = false;
    this.#activeOutcome = undefined;
  }

  startSet(): void {
    this.#strategy.startSet();
  }

  captureTick(source: MatchStrategyTickSource): void {
    const observation = this.#observationPacker.pack({
      ...source,
      ball: {
        ...source.ball,
        lastVisibleContactTick: this.#lastVisibleContactTick,
      },
    });
    this.#strategy.capturePackedFrame(observation);
    this.#latestCapturedTick = observation.tick;
  }

  beginServe(side: TeamSide, serverAthleteId: number): ServeEpochToken {
    const token = this.#serves.beginServe(side, serverAthleteId);
    this.#currentServe = token;
    this.#currentServeOpen = true;
    this.#activeOutcome = undefined;
    return token;
  }

  commitServe(
    token: ServeEpochToken,
    difficulty: StrategyDifficulty,
    decisionTick: number,
  ): StrategicServeCommitResult {
    if (
      !this.#currentServe ||
      !this.#currentServeOpen ||
      !sameServeToken(this.#currentServe, token)
    ) {
      return STALE;
    }
    return this.#serves.commit(token, difficulty, decisionTick);
  }

  guardServe(
    ref: ServeCommitmentRef,
    stage: ServeGuardStage,
    facts: MatchStrategyServeFacts,
  ): boolean {
    if (
      !this.#currentServe ||
      !this.#currentServeOpen ||
      !sameServeToken(this.#currentServe, ref) ||
      !this.#serves.isActive(ref, 'committed')
    ) {
      return false;
    }
    const matches =
      (stage === 'toss' || stage === 'hit') &&
      facts.phase === 'serve-prep' &&
      facts.servingSide === ref.side &&
      facts.serverAthleteId === ref.serverAthleteId;
    if (matches) return true;
    this.#serves.revoke(ref);
    this.#currentServeOpen = false;
    this.#activeOutcome = undefined;
    return false;
  }

  markServeLaunched(
    ref: ServeCommitmentRef,
    realization: StrategicServeRealization,
  ): StrategicServeLaunchResult {
    if (
      !this.#currentServe ||
      !this.#currentServeOpen ||
      !sameServeToken(this.#currentServe, ref) ||
      (!this.#serves.isActive(ref, 'committed') && !this.#serves.isActive(ref, 'in-flight'))
    ) {
      return STALE;
    }
    const result = this.#serves.markLaunched(ref, realization);
    if (result.status === 'launched') {
      this.#activeOutcome = Object.freeze({
        token: result.serve.outcomeToken,
        servingSide: result.serve.ref.side,
      });
    }
    return result;
  }

  beginOffenseRally(): OffenseRallyRef {
    return this.#offense.beginRally();
  }

  endOffenseRally(rally: OffenseRallyRef): void {
    this.#offense.endRally(rally);
  }

  observeOffenseContact(
    rally: OffenseRallyRef,
    source: OwnContactReadSource,
    possessionTouches: 1 | 2 | 3,
  ): ObserveOffenseContactResult {
    return this.#offense.observeContact(rally, source, possessionTouches);
  }

  prepareOffenseSet(contact: OffenseContactRef, difficulty: StrategyDifficulty): SetPrepareResult {
    return this.#offense.prepareSet(contact, difficulty);
  }

  bindOffenseSet(ref: OffenseContactRef, plan: SetPlanIdentity): SetBindResult {
    return this.#offense.bindSet(ref, plan);
  }

  consumeOffenseSet(commitment: BoundSetCommitment, plan: SetPlanIdentity): SetConsumeResult {
    return this.#offense.consumeSet(commitment, plan);
  }

  prepareOffenseAttack(
    setContact: OffenseContactRef,
    difficulty: StrategyDifficulty,
  ): AttackPrepareResult {
    return this.#offense.prepareAttack(setContact, difficulty);
  }

  bindOffenseAttack(draft: AttackDecisionDraft, plan: SetPlanIdentity): AttackBindResult {
    return this.#offense.bindAttack(draft, plan);
  }

  consumeOffenseAttack(
    commitment: BoundAttackCommitment,
    plan: SetPlanIdentity,
  ): AttackConsumeResult {
    return this.#offense.consumeAttack(commitment, plan);
  }

  resolveOffenseBlock(commitment: BoundAttackCommitment): boolean {
    return this.#offense.resolveAttackBlock(commitment);
  }

  resolveOffenseDefense(commitment: BoundAttackCommitment, effectiveness: number): boolean {
    return this.#offense.resolveAttackDefense(commitment, effectiveness);
  }

  resolveOffensePoint(rally: OffenseRallyRef, winner: TeamSide): boolean {
    return this.#offense.resolveOffensePoint(rally, winner);
  }

  onBallContact(contact: MatchStrategyBallContact): boolean {
    if (contact.matchEpoch !== this.#currentMatchEpoch) return false;
    const token = contact.outcomeToken;
    const active = this.#activeOutcome;
    if (token && (!active || !sameOutcomeToken(active.token, token))) return false;
    if (this.#latestCapturedTick === null || contact.tick > this.#latestCapturedTick) return false;
    const tick = contactTick(contact.tick);
    this.#lastVisibleContactTick = Math.max(this.#lastVisibleContactTick ?? tick, tick);
    if (!token || !active) return false;
    if (!validSide(contact.side)) throw new RangeError('lado do contato inválido');
    if (contact.side !== otherSide(active.servingSide)) return false;
    const effectiveness = serveReceptionEffectiveness({
      ballAfter: contact.ballAfter,
      setterPosition: contact.setterPosition,
    });
    const resolved = this.#serves.resolveReception(token, contact.side, effectiveness);
    if (resolved) {
      this.#activeOutcome = undefined;
      this.#currentServeOpen = false;
    }
    return resolved;
  }

  onPoint(point: MatchStrategyPoint): boolean {
    const token = point.outcomeToken;
    const active = this.#activeOutcome;
    if (!token || !active || !sameOutcomeToken(active.token, token)) return false;
    const resolved = this.#serves.resolvePoint(token, point);
    if (resolved) {
      this.#activeOutcome = undefined;
      this.#currentServeOpen = false;
    }
    return resolved;
  }

  memory(side: TeamSide): StrategyMemorySnapshot {
    return this.#strategy.memory(side);
  }

  flush(): void {
    this.#strategy.flushOutbox();
  }
}
