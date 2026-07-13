import { CONTACT, PLAYER, TeamSide } from '../../core/constants';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import { canonicalStrategyOptions, strategyToWorld } from './CourtZones';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import {
  buildOwnContactRead,
  selectSetterByEta,
  type OwnContactRead,
  type OwnContactReadSource,
  type PossessionRef,
  type SetterEtaSelection,
} from './OwnContactRead';
import type { SetOptionId, StrategyDifficulty, StrategyPoint2 } from './StrategyTypes';

export const STRATEGIC_OFFENSE_TUNING = Object.freeze({
  tickRate: 60,
  minimumSetLeadTicks: 24,
  fallbackAttackWindowSeconds: 2.4,
} as const);

export interface OffenseRallyRef {
  readonly matchEpoch: number;
  readonly rallyEpoch: number;
}

export interface OffenseContactRef extends PossessionRef {
  readonly tick: number;
}

export interface SetPlanIdentity {
  readonly planId: number;
  readonly tacticalRevision: number;
  readonly athleteId: number;
}

export type StrategicSetFamily = 'high' | 'quick' | 'accelerated';
export type StrategicSetFallbackReason = 'insufficient-lead' | 'perception-not-ready';

export interface StrategicSetExecution {
  readonly mode: 'strategic';
  readonly decisionId: string;
  readonly optionId: SetOptionId;
  readonly family: StrategicSetFamily;
  readonly target: StrategyPoint2;
  readonly observationTick: number;
}

export interface FallbackSetExecution {
  readonly mode: 'fallback-high';
  readonly reason: StrategicSetFallbackReason;
  readonly optionId: 'set.high-left' | 'set.high-right';
  readonly family: 'high';
  readonly target: StrategyPoint2;
  readonly attackerAthleteId: number;
}

export interface SafetyFreeballExecution {
  readonly mode: 'safety-freeball';
  readonly reason: StrategicSetFallbackReason;
}

export type SetExecution = StrategicSetExecution | FallbackSetExecution | SafetyFreeballExecution;

export interface SetDecisionDraft {
  readonly ref: OffenseContactRef;
  readonly setterAthleteId: number;
  readonly setterContact: StrategyPoint2;
  readonly leadTicks: number;
  readonly execution: SetExecution;
}

export interface BoundSetCommitment extends SetPlanIdentity {
  readonly ref: OffenseContactRef;
  readonly decisionId: string | null;
  readonly observationTick: number | null;
  readonly draft: SetDecisionDraft;
}

export type ObserveOffenseContactResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'observed'; contact: OffenseContactRef }>;

export type SetPrepareResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'unplayable' }>
  | Readonly<{ status: 'prepared'; draft: SetDecisionDraft }>;

export type SetBindResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'conflict' }>
  | Readonly<{ status: 'bound'; commitment: BoundSetCommitment }>;

export type SetConsumeResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'conflict' }>
  | Readonly<{ status: 'consumed'; execution: SetExecution }>;

type SetLifecycleState = 'prepared' | 'bound' | 'consumed' | 'unplayable' | 'revoked';

interface ActivePossession {
  readonly matchEpoch: number;
  readonly rallyEpoch: number;
  readonly possessionEpoch: number;
  readonly side: TeamSide;
  contactSequence: number;
}

interface ActiveContact {
  readonly ref: OffenseContactRef;
  readonly read: OwnContactRead;
  readonly observed: Extract<ObserveOffenseContactResult, { status: 'observed' }>;
}

interface ActiveSet {
  readonly contact: OffenseContactRef;
  state: SetLifecycleState;
  readonly prepareResult: SetPrepareResult;
  readonly draft?: SetDecisionDraft;
  commitment?: BoundSetCommitment;
  bindResult?: Extract<SetBindResult, { status: 'bound' }>;
}

interface FallbackCandidate {
  readonly optionId: 'set.high-left' | 'set.high-right';
  readonly target: StrategyPoint2;
  readonly attackerAthleteId: number;
  readonly eta: number;
  readonly distance: number;
}

const STALE = Object.freeze({ status: 'stale' } as const);
const INVALID = Object.freeze({ status: 'invalid' } as const);
const UNPLAYABLE = Object.freeze({ status: 'unplayable' } as const);
const CONFLICT = Object.freeze({ status: 'conflict' } as const);

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
}

function safeIncrement(value: number, label: string): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next)) throw new RangeError(`${label} excedeu o limite`);
  return next;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function sameRally(left: OffenseRallyRef, right: OffenseRallyRef): boolean {
  return left.matchEpoch === right.matchEpoch && left.rallyEpoch === right.rallyEpoch;
}

function samePlan(left: SetPlanIdentity, right: SetPlanIdentity): boolean {
  return (
    left.planId === right.planId &&
    left.tacticalRevision === right.tacticalRevision &&
    left.athleteId === right.athleteId
  );
}

function sameRead(left: OwnContactRead, right: OwnContactRead): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validPlan(plan: SetPlanIdentity, setterAthleteId: number): boolean {
  return (
    Number.isSafeInteger(plan.planId) &&
    plan.planId > 0 &&
    Number.isSafeInteger(plan.tacticalRevision) &&
    plan.tacticalRevision >= 0 &&
    Number.isSafeInteger(plan.athleteId) &&
    plan.athleteId === setterAthleteId
  );
}

function setFamily(value: string): value is StrategicSetFamily {
  return value === 'high' || value === 'quick' || value === 'accelerated';
}

function fallbackEta(
  athlete: OwnContactRead['ownAthletes'][number],
  target: StrategyPoint2,
): { eta: number; distance: number } {
  const dx = target.x - athlete.position.x;
  const dz = target.z - athlete.position.z;
  const distance = Math.hypot(dx, dz);
  const directionX = distance > 1e-9 ? dx / distance : 1;
  const directionZ = distance > 1e-9 ? dz / distance : 0;
  const projectedVelocity = athlete.velocity.x * directionX + athlete.velocity.z * directionZ;
  const lateralVelocity = -athlete.velocity.x * directionZ + athlete.velocity.z * directionX;
  return {
    eta: estimatePlanarArrivalTime(
      distance,
      projectedVelocity,
      lateralVelocity,
      PLAYER.aiSpeed,
      PLAYER.acceleration,
      PLAYER.deceleration,
      CONTACT.reach,
    ),
    distance,
  };
}

function fallbackExecution(
  read: OwnContactRead,
  setterAthleteId: number,
  ref: OffenseContactRef,
  reason: StrategicSetFallbackReason,
): FallbackSetExecution | SafetyFreeballExecution {
  const attackers = read.ownAthletes.filter(
    (athlete) =>
      athlete.row === 'front' &&
      athlete.id !== setterAthleteId &&
      athlete.id !== read.athleteId &&
      !athlete.airborne,
  );
  const options = canonicalStrategyOptions('set').filter(
    (
      option,
    ): option is typeof option & {
      readonly optionId: 'set.high-left' | 'set.high-right';
    } => option.optionId === 'set.high-left' || option.optionId === 'set.high-right',
  );
  const candidates: FallbackCandidate[] = [];
  for (const option of options) {
    const target = strategyToWorld(option.center, read.side);
    for (const attacker of attackers) {
      const estimate = fallbackEta(attacker, target);
      if (estimate.eta > STRATEGIC_OFFENSE_TUNING.fallbackAttackWindowSeconds) continue;
      candidates.push({
        optionId: option.optionId,
        target,
        attackerAthleteId: attacker.id,
        eta: estimate.eta,
        distance: estimate.distance,
      });
    }
  }
  if (candidates.length === 0) {
    return Object.freeze({ mode: 'safety-freeball' as const, reason });
  }
  const preferLeft = (ref.possessionEpoch + ref.contactSequence) % 2 === 0;
  candidates.sort(
    (left, right) =>
      left.eta - right.eta ||
      left.distance - right.distance ||
      Number((left.optionId === 'set.high-left') !== preferLeft) -
        Number((right.optionId === 'set.high-left') !== preferLeft) ||
      left.attackerAthleteId - right.attackerAthleteId,
  );
  const chosen = candidates[0];
  return Object.freeze({
    mode: 'fallback-high' as const,
    reason,
    optionId: chosen.optionId,
    family: 'high' as const,
    target: Object.freeze({
      x: canonicalNumber(chosen.target.x),
      z: canonicalNumber(chosen.target.z),
    }),
    attackerAthleteId: chosen.attackerAthleteId,
  });
}

/** Lifecycle puro do ataque organizado; este corte compromete somente o levantamento. */
export class StrategicOffenseSystem {
  private observedMatchEpoch: number;
  private rallyEpoch = 0;
  private possessionEpoch = 0;
  private activeRally?: OffenseRallyRef;
  private activePossession?: ActivePossession;
  private activeContact?: ActiveContact;
  private activeSet?: ActiveSet;

  constructor(private readonly strategy: OpponentStrategySystem) {
    this.observedMatchEpoch = strategy.matchEpoch;
  }

  /** Sincroniza o domínio especializado sem avançar o epoch do core compartilhado. */
  resetForMatch(matchEpoch: number): void {
    if (!Number.isSafeInteger(matchEpoch) || matchEpoch < 0) {
      throw new RangeError('matchEpoch ofensivo inválido');
    }
    if (matchEpoch !== this.strategy.matchEpoch) {
      throw new RangeError('matchEpoch ofensivo diverge do core estratégico');
    }
    if (matchEpoch === this.observedMatchEpoch) return;
    this.observedMatchEpoch = matchEpoch;
    this.activeRally = undefined;
    this.activePossession = undefined;
    this.activeContact = undefined;
    this.activeSet = undefined;
  }

  beginRally(): OffenseRallyRef {
    this.synchronizeMatch();
    this.closeActiveSet();
    this.rallyEpoch = safeIncrement(this.rallyEpoch, 'rallyEpoch');
    const rally = Object.freeze({
      matchEpoch: this.observedMatchEpoch,
      rallyEpoch: this.rallyEpoch,
    });
    this.activeRally = rally;
    this.activePossession = undefined;
    this.activeContact = undefined;
    return rally;
  }

  observeContact(
    rally: OffenseRallyRef,
    source: OwnContactReadSource,
    possessionTouches: 1 | 2 | 3,
  ): ObserveOffenseContactResult {
    this.synchronizeMatch();
    if (
      !this.activeRally ||
      rally !== this.activeRally ||
      !sameRally(rally, this.activeRally) ||
      rally.matchEpoch !== this.observedMatchEpoch
    ) {
      return STALE;
    }
    if (possessionTouches !== 1 && possessionTouches !== 2 && possessionTouches !== 3) {
      return INVALID;
    }
    let read: OwnContactRead;
    try {
      read = buildOwnContactRead(source);
    } catch {
      return INVALID;
    }
    if (!validSide(read.side)) return INVALID;

    if (
      this.activeContact &&
      this.activeContact.ref.side === read.side &&
      this.activeContact.ref.tick === read.tick &&
      this.activeContact.ref.contactSequence === possessionTouches &&
      this.activeContact.read.kind === read.kind &&
      this.activeContact.read.athleteId === read.athleteId
    ) {
      return sameRead(this.activeContact.read, read) ? this.activeContact.observed : INVALID;
    }
    if (this.activeContact && read.tick <= this.activeContact.ref.tick) return INVALID;

    if (possessionTouches === 1) {
      this.closeActiveSet();
      this.possessionEpoch = safeIncrement(this.possessionEpoch, 'possessionEpoch');
      this.activePossession = {
        matchEpoch: rally.matchEpoch,
        rallyEpoch: rally.rallyEpoch,
        possessionEpoch: this.possessionEpoch,
        side: read.side,
        contactSequence: 1,
      };
    } else {
      const possession = this.activePossession;
      if (
        !possession ||
        possession.side !== read.side ||
        possession.contactSequence + 1 !== possessionTouches
      ) {
        return INVALID;
      }
      if (this.activeSet && this.activeSet.state !== 'consumed') this.closeActiveSet();
      possession.contactSequence = possessionTouches;
    }
    const possession = this.activePossession!;
    const ref = Object.freeze({
      matchEpoch: possession.matchEpoch,
      rallyEpoch: possession.rallyEpoch,
      possessionEpoch: possession.possessionEpoch,
      contactSequence: possession.contactSequence,
      side: possession.side,
      tick: read.tick,
    });
    const observed = Object.freeze({ status: 'observed' as const, contact: ref });
    this.activeContact = { ref, read, observed };
    return observed;
  }

  prepareSet(contact: OffenseContactRef, difficulty: StrategyDifficulty): SetPrepareResult {
    this.synchronizeMatch();
    const activeContact = this.activeContact;
    if (
      !activeContact ||
      activeContact.ref !== contact ||
      contact.matchEpoch !== this.observedMatchEpoch ||
      !this.activeRally ||
      contact.rallyEpoch !== this.activeRally.rallyEpoch
    ) {
      return STALE;
    }
    if (this.activeSet?.contact === contact) return this.activeSet.prepareResult;
    if (![0, 1, 2].includes(difficulty)) return INVALID;
    const read = activeContact.read;
    if (read.kind !== 'pass' && read.kind !== 'dig') return INVALID;

    const setter = selectSetterByEta(read);
    if (!setter) {
      this.activeSet = {
        contact,
        state: 'unplayable',
        prepareResult: UNPLAYABLE,
      };
      return UNPLAYABLE;
    }
    const leadTicks = Math.floor(setter.contactIn * STRATEGIC_OFFENSE_TUNING.tickRate + 1e-9);
    if (leadTicks < STRATEGIC_OFFENSE_TUNING.minimumSetLeadTicks) {
      return this.storeFallback(contact, read, setter, leadTicks, 'insufficient-lead');
    }

    const result = this.strategy.commitDecision({
      matchEpoch: contact.matchEpoch,
      side: contact.side,
      kind: 'set',
      difficulty,
      decisionTick: contact.tick,
      ownership: `set:${contact.matchEpoch}:${contact.rallyEpoch}:${contact.possessionEpoch}:${contact.contactSequence}:${contact.side}`,
      setterAthleteId: setter.athleteId,
      ownContactRead: read,
    });
    if (result.status === 'not-ready') {
      return this.storeFallback(contact, read, setter, leadTicks, 'perception-not-ready');
    }
    if (result.status === 'invalid-request') return INVALID;
    const chosen = result.decision.proposal.chosen;
    if (!chosen.optionId.startsWith('set.') || !setFamily(chosen.family)) {
      this.strategy.revokeDecision(result.decision.decisionId);
      throw new Error('decisão de set incompatível com o domínio ofensivo');
    }
    const execution = Object.freeze({
      mode: 'strategic' as const,
      decisionId: result.decision.decisionId,
      optionId: chosen.optionId as SetOptionId,
      family: chosen.family,
      target: Object.freeze({
        x: canonicalNumber(chosen.target.x),
        z: canonicalNumber(chosen.target.z),
      }),
      observationTick: result.decision.observationTick,
    });
    return this.storeDraft(contact, setter, leadTicks, execution);
  }

  bindSet(ref: OffenseContactRef, plan: SetPlanIdentity): SetBindResult {
    this.synchronizeMatch();
    const active = this.activeSet;
    if (!active || active.contact !== ref || active.state === 'revoked') return STALE;
    if (!active.draft || active.state === 'unplayable' || active.state === 'consumed') return STALE;
    if (active.state === 'bound' && active.commitment && active.bindResult) {
      if (samePlan(active.commitment, plan)) return active.bindResult;
      this.revokeActiveSet(active);
      return CONFLICT;
    }
    if (active.state !== 'prepared' || !validPlan(plan, active.draft.setterAthleteId)) {
      this.revokeActiveSet(active);
      return CONFLICT;
    }
    const strategic =
      active.draft.execution.mode === 'strategic' ? active.draft.execution : undefined;
    const commitment = Object.freeze({
      ref: active.draft.ref,
      planId: plan.planId,
      tacticalRevision: plan.tacticalRevision,
      athleteId: plan.athleteId,
      decisionId: strategic?.decisionId ?? null,
      observationTick: strategic?.observationTick ?? null,
      draft: active.draft,
    });
    const bound = Object.freeze({ status: 'bound' as const, commitment });
    active.commitment = commitment;
    active.bindResult = bound;
    active.state = 'bound';
    return bound;
  }

  consumeSet(commitment: BoundSetCommitment, plan: SetPlanIdentity): SetConsumeResult {
    this.synchronizeMatch();
    const active = this.activeSet;
    if (
      !active ||
      active.state !== 'bound' ||
      !active.commitment ||
      active.commitment !== commitment
    ) {
      return STALE;
    }
    if (!samePlan(commitment, plan)) {
      this.revokeActiveSet(active);
      return CONFLICT;
    }
    active.state = 'consumed';
    return Object.freeze({ status: 'consumed' as const, execution: commitment.draft.execution });
  }

  revokeSet(ref: OffenseContactRef): boolean {
    this.synchronizeMatch();
    const active = this.activeSet;
    if (!active || active.contact !== ref || active.state === 'revoked') return false;
    if (active.state === 'consumed') return false;
    this.revokeActiveSet(active);
    return true;
  }

  endRally(rally: OffenseRallyRef): void {
    this.synchronizeMatch();
    if (!this.activeRally || rally !== this.activeRally) return;
    this.closeActiveSet();
    this.activeRally = undefined;
    this.activePossession = undefined;
    this.activeContact = undefined;
  }

  private storeFallback(
    contact: OffenseContactRef,
    read: OwnContactRead,
    setter: SetterEtaSelection,
    leadTicks: number,
    reason: StrategicSetFallbackReason,
  ): SetPrepareResult {
    return this.storeDraft(
      contact,
      setter,
      leadTicks,
      fallbackExecution(read, setter.athleteId, contact, reason),
    );
  }

  private storeDraft(
    contact: OffenseContactRef,
    setter: SetterEtaSelection,
    leadTicks: number,
    execution: SetExecution,
  ): SetPrepareResult {
    const draft = Object.freeze({
      ref: contact,
      setterAthleteId: setter.athleteId,
      setterContact: Object.freeze({
        x: canonicalNumber(setter.target.x),
        z: canonicalNumber(setter.target.z),
      }),
      leadTicks,
      execution,
    });
    const prepared = Object.freeze({ status: 'prepared' as const, draft });
    this.activeSet = {
      contact,
      state: 'prepared',
      prepareResult: prepared,
      draft,
    };
    return prepared;
  }

  private closeActiveSet(): void {
    const active = this.activeSet;
    if (!active) return;
    if (
      active.state !== 'consumed' &&
      active.state !== 'unplayable' &&
      active.state !== 'revoked'
    ) {
      this.revokeActiveSet(active);
    }
    this.activeSet = undefined;
  }

  private revokeActiveSet(active: ActiveSet): void {
    if (active.state === 'revoked') return;
    if (active.draft?.execution.mode === 'strategic') {
      this.strategy.revokeDecision(active.draft.execution.decisionId);
    }
    active.state = 'revoked';
  }

  private synchronizeMatch(): void {
    if (this.strategy.matchEpoch === this.observedMatchEpoch) return;
    this.observedMatchEpoch = this.strategy.matchEpoch;
    this.activeRally = undefined;
    this.activePossession = undefined;
    this.activeContact = undefined;
    this.activeSet = undefined;
  }
}
