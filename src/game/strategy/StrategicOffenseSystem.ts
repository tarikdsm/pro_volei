import { CONTACT, PLAYER, TeamSide } from '../../core/constants';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import { canonicalStrategyOptions, strategyToWorld } from './CourtZones';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import {
  buildOwnContactRead,
  deriveAttackOriginFromExecutedSet,
  selectSetterByEta,
  type OwnContactRead,
  type OwnContactReadSource,
  type PossessionRef,
  type SetterEtaSelection,
} from './OwnContactRead';
import {
  fallbackPlacedSeam,
  selectAttackerByEta,
  setDeliveryEffectiveness,
  STRATEGIC_ATTACK_TUNING,
} from './StrategicAttackSelection';
import type {
  AttackBindResult,
  AttackConsumeResult,
  AttackDecisionDraft,
  AttackExecution,
  AttackPrepareResult,
  BoundAttackCommitment,
  StrategicAttackExecution,
} from './StrategicAttackTypes';
import type {
  AttackOptionId,
  SetOptionId,
  StrategyDifficulty,
  StrategyPoint2,
} from './StrategyTypes';

export type {
  AttackBindResult,
  AttackConsumeResult,
  AttackDecisionDraft,
  AttackPrepareResult,
  BoundAttackCommitment,
} from './StrategicAttackTypes';

export const STRATEGIC_OFFENSE_TUNING = Object.freeze({
  tickRate: 60,
  minimumSetLeadTicks: 24,
  fallbackAttackWindowSeconds: 2.4,
} as const);

export const STRATEGIC_OFFENSE_BOUNDARY_VERSION = 1 as const;

export interface StrategicOffenseBoundarySnapshot {
  readonly version: typeof STRATEGIC_OFFENSE_BOUNDARY_VERSION;
  readonly matchEpoch: number;
  readonly rallyEpoch: number;
  readonly possessionEpoch: number;
}

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
export type StrategicSetFallbackReason =
  'insufficient-lead' | 'perception-not-ready' | 'no-attacker' | 'quick-unavailable';

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
  readonly plannedAttackerAthleteId: number | null;
  readonly plannedAttack: AttackDecisionDraft | null;
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
type AttackLifecycleState =
  'awaiting-set' | 'prepared' | 'bound' | 'consumed' | 'resolved' | 'revoked';

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
  draft?: SetDecisionDraft;
  commitment?: BoundSetCommitment;
  bindResult?: Extract<SetBindResult, { status: 'bound' }>;
}

interface ActiveAttack {
  state: AttackLifecycleState;
  draft: AttackDecisionDraft;
  originSetPlanId: number | null;
  prepareResult?: Extract<AttackPrepareResult, { status: 'prepared' }>;
  commitment?: BoundAttackCommitment;
  bindResult?: Extract<AttackBindResult, { status: 'bound' }>;
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

function attackFamily(value: string): value is StrategicAttackExecution['family'] {
  return value === 'power' || value === 'placed' || value === 'tip';
}

function freezeStrategicAttack(
  decision: Readonly<{
    decisionId: string;
    observationTick: number;
    proposal: Readonly<{
      chosen: Readonly<{
        optionId: string;
        family: string;
        target: StrategyPoint2;
      }>;
    }>;
  }>,
): StrategicAttackExecution {
  const chosen = decision.proposal.chosen;
  if (!chosen.optionId.startsWith('attack.') || !attackFamily(chosen.family)) {
    throw new Error('decisão de ataque incompatível com o domínio ofensivo');
  }
  return Object.freeze({
    mode: 'strategic' as const,
    decisionId: decision.decisionId,
    optionId: chosen.optionId as AttackOptionId,
    family: chosen.family,
    target: Object.freeze({
      x: canonicalNumber(chosen.target.x),
      z: canonicalNumber(chosen.target.z),
    }),
    observationTick: decision.observationTick,
  });
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
  private activeAttack?: ActiveAttack;

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
    this.activeAttack = undefined;
  }

  checkpointBoundary(): StrategicOffenseBoundarySnapshot {
    this.assertBoundary();
    return Object.freeze({
      version: STRATEGIC_OFFENSE_BOUNDARY_VERSION,
      matchEpoch: this.observedMatchEpoch,
      rallyEpoch: this.rallyEpoch,
      possessionEpoch: this.possessionEpoch,
    });
  }

  restoreBoundary(snapshot: StrategicOffenseBoundarySnapshot): void {
    this.assertBoundary();
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      snapshot.version !== STRATEGIC_OFFENSE_BOUNDARY_VERSION ||
      snapshot.matchEpoch !== this.strategy.matchEpoch ||
      !Number.isSafeInteger(snapshot.rallyEpoch) ||
      snapshot.rallyEpoch < 0 ||
      !Number.isSafeInteger(snapshot.possessionEpoch) ||
      snapshot.possessionEpoch < 0
    ) {
      throw new RangeError('checkpoint de fronteira ofensivo inválido');
    }
    this.observedMatchEpoch = snapshot.matchEpoch;
    this.rallyEpoch = snapshot.rallyEpoch;
    this.possessionEpoch = snapshot.possessionEpoch;
    this.activeRally = undefined;
    this.activePossession = undefined;
    this.activeContact = undefined;
    this.activeSet = undefined;
    this.activeAttack = undefined;
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
    if (possessionTouches === 1 && this.activeAttack?.state === 'consumed') return INVALID;
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

    const availableFront = read.ownAthletes.some(
      (athlete) => athlete.row === 'front' && athlete.id !== setter.athleteId && !athlete.airborne,
    );
    if (!availableFront) {
      return this.storeFallback(contact, read, setter, leadTicks, 'no-attacker');
    }
    const quickTarget = strategyToWorld(
      canonicalStrategyOptions('set').find((option) => option.optionId === 'set.quick-center')!
        .center,
      contact.side,
    );
    const quickPreliminary = selectAttackerByEta({
      read,
      setterAthleteId: setter.athleteId,
      target: quickTarget,
      availableIn: setter.contactIn + 1 / 60,
      preferredAthleteId: read.ownAthletes.find((athlete) => athlete.slot === 4)?.id,
    });

    const ownership = `set:${contact.matchEpoch}:${contact.rallyEpoch}:${contact.possessionEpoch}:${contact.contactSequence}:${contact.side}`;
    let committedQuickAttacker: ReturnType<typeof selectAttackerByEta> = null;
    const result = this.strategy.commitSetPlay({
      set: {
        matchEpoch: contact.matchEpoch,
        side: contact.side,
        kind: 'set',
        difficulty,
        decisionTick: contact.tick,
        ownership,
        setterAthleteId: setter.athleteId,
        ownContactRead: read,
      },
      quickAttackOwnership: `attack:quick:${contact.matchEpoch}:${contact.rallyEpoch}:${contact.possessionEpoch}:${contact.contactSequence}:${contact.side}`,
      quickAllowed: quickPreliminary !== null,
      acceptQuickTarget: (target) => {
        committedQuickAttacker = selectAttackerByEta({
          read,
          setterAthleteId: setter.athleteId,
          target,
          availableIn: setter.contactIn + 1 / 60,
          preferredAthleteId: quickPreliminary?.athleteId,
        });
        return committedQuickAttacker !== null;
      },
    });
    if (result.status === 'not-ready') {
      return this.storeFallback(contact, read, setter, leadTicks, 'perception-not-ready');
    }
    if (result.status === 'quick-unavailable') {
      return this.storeFallback(contact, read, setter, leadTicks, 'quick-unavailable');
    }
    if (result.status === 'invalid-request') return INVALID;
    const chosen = result.set.proposal.chosen;
    if (!chosen.optionId.startsWith('set.') || !setFamily(chosen.family)) {
      this.strategy.revokeDecision(result.set.decisionId);
      if (result.quickAttack) this.strategy.revokeDecision(result.quickAttack.decisionId);
      throw new Error('decisão de set incompatível com o domínio ofensivo');
    }
    const execution = Object.freeze({
      mode: 'strategic' as const,
      decisionId: result.set.decisionId,
      optionId: chosen.optionId as SetOptionId,
      family: chosen.family,
      target: Object.freeze({
        x: canonicalNumber(chosen.target.x),
        z: canonicalNumber(chosen.target.z),
      }),
      observationTick: result.set.observationTick,
    });
    const committedPreliminary =
      chosen.family === 'quick'
        ? null
        : selectAttackerByEta({
            read,
            setterAthleteId: setter.athleteId,
            target: execution.target,
            availableIn: Number.MAX_VALUE,
          });
    const preliminary = chosen.family === 'quick' ? committedQuickAttacker : committedPreliminary;
    let plannedAttack: AttackDecisionDraft | null = null;
    if (chosen.family === 'quick') {
      if (!result.quickAttack || !preliminary) {
        this.revokePending(result.quickAttack?.decisionId);
        this.revokePending(result.set.decisionId);
        throw new Error('quick comprometido sem ataque filho ou central legal');
      }
      plannedAttack = Object.freeze({
        basis: 'chained-quick' as const,
        decisionContact: contact,
        executedSetContact: null,
        originSetDecisionId: result.set.decisionId,
        originSetPlanId: null,
        attackerAthleteId: preliminary.athleteId,
        leadTicks: null,
        deliveryEffectiveness: null,
        execution: freezeStrategicAttack(result.quickAttack),
      });
      this.activeAttack = {
        state: 'awaiting-set',
        draft: plannedAttack,
        originSetPlanId: null,
      };
    }
    return this.storeDraft(
      contact,
      setter,
      leadTicks,
      execution,
      preliminary?.athleteId ?? null,
      plannedAttack,
    );
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
    let boundDraft = active.draft;
    if (
      this.activeAttack?.state === 'awaiting-set' &&
      this.activeAttack.draft.originSetDecisionId === strategic?.decisionId
    ) {
      const boundAttackDraft = Object.freeze({
        ...this.activeAttack.draft,
        originSetPlanId: plan.planId,
      });
      this.activeAttack.draft = boundAttackDraft;
      this.activeAttack.originSetPlanId = plan.planId;
      boundDraft = Object.freeze({ ...boundDraft, plannedAttack: boundAttackDraft });
      active.draft = boundDraft;
    }
    const commitment = Object.freeze({
      ref: boundDraft.ref,
      planId: plan.planId,
      tacticalRevision: plan.tacticalRevision,
      athleteId: plan.athleteId,
      decisionId: strategic?.decisionId ?? null,
      observationTick: strategic?.observationTick ?? null,
      draft: boundDraft,
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

  prepareAttack(
    setContact: OffenseContactRef,
    difficulty: StrategyDifficulty,
  ): AttackPrepareResult {
    this.synchronizeMatch();
    const contact = this.activeContact;
    const set = this.activeSet;
    if (
      !contact ||
      contact.ref !== setContact ||
      !set ||
      !set.draft ||
      !set.commitment ||
      set.state !== 'consumed' ||
      setContact.matchEpoch !== this.observedMatchEpoch ||
      setContact.rallyEpoch !== set.contact.rallyEpoch ||
      setContact.possessionEpoch !== set.contact.possessionEpoch ||
      setContact.side !== set.contact.side ||
      setContact.contactSequence !== set.contact.contactSequence + 1 ||
      contact.read.kind !== 'set' ||
      contact.read.athleteId !== set.draft.setterAthleteId
    ) {
      return STALE;
    }
    if (
      this.activeAttack?.prepareResult &&
      this.activeAttack.draft.executedSetContact === setContact
    ) {
      return this.activeAttack.prepareResult;
    }
    const origin = deriveAttackOriginFromExecutedSet(contact.read);
    if (!origin) {
      this.failAttackBeforeConsume();
      return UNPLAYABLE;
    }

    const quick =
      set.draft.execution.mode === 'strategic' && set.draft.execution.family === 'quick';
    if (!quick && ![0, 1, 2].includes(difficulty)) return INVALID;
    const attacker = selectAttackerByEta({
      read: contact.read,
      setterAthleteId: set.draft.setterAthleteId,
      target: origin.position,
      availableIn: origin.contactIn,
      preferredAthleteId: set.draft.plannedAttackerAthleteId ?? undefined,
    });
    if (!attacker) {
      this.failAttackBeforeConsume();
      return UNPLAYABLE;
    }
    const deliveryEffectiveness = setDeliveryEffectiveness(
      set.draft.execution.mode === 'safety-freeball'
        ? set.draft.setterContact
        : set.draft.execution.target,
      origin.position,
    );

    if (quick) {
      const active = this.activeAttack;
      if (!active || active.state !== 'awaiting-set') return STALE;
      const draft = Object.freeze({
        ...active.draft,
        executedSetContact: setContact,
        originSetPlanId: active.originSetPlanId,
        attackerAthleteId: attacker.athleteId,
        deliveryEffectiveness,
      });
      return this.storeAttackDraft(active, draft);
    }

    const leadTicks = Math.floor(origin.contactIn * STRATEGIC_OFFENSE_TUNING.tickRate + 1e-9);
    let execution: AttackExecution;
    const originSetDecisionId =
      set.draft.execution.mode === 'strategic' ? set.draft.execution.decisionId : null;
    if (set.draft.execution.mode !== 'strategic') {
      execution = fallbackPlacedSeam(setContact.side, origin.position.z, 'fallback-set');
    } else if (leadTicks < STRATEGIC_ATTACK_TUNING.minimumLeadTicks) {
      execution = fallbackPlacedSeam(setContact.side, origin.position.z, 'insufficient-lead');
    } else {
      const result = this.strategy.commitDecision({
        matchEpoch: setContact.matchEpoch,
        side: setContact.side,
        kind: 'attack',
        difficulty,
        decisionTick: setContact.tick,
        ownership: `attack:set:${setContact.matchEpoch}:${setContact.rallyEpoch}:${setContact.possessionEpoch}:${setContact.contactSequence}:${setContact.side}`,
        ownContactRead: contact.read,
        attackBasis: { kind: 'executed-set' },
      });
      if (result.status === 'invalid-request') return INVALID;
      execution =
        result.status === 'not-ready'
          ? fallbackPlacedSeam(setContact.side, origin.position.z, 'perception-not-ready')
          : freezeStrategicAttack(result.decision);
    }
    const draft = Object.freeze({
      basis: 'executed-set' as const,
      decisionContact: setContact,
      executedSetContact: setContact,
      originSetDecisionId,
      originSetPlanId: set.commitment.planId,
      attackerAthleteId: attacker.athleteId,
      leadTicks,
      deliveryEffectiveness,
      execution,
    });
    const active: ActiveAttack = {
      state: 'prepared',
      draft,
      originSetPlanId: set.commitment.planId,
    };
    this.activeAttack = active;
    return this.storeAttackDraft(active, draft);
  }

  bindAttack(draft: AttackDecisionDraft, plan: SetPlanIdentity): AttackBindResult {
    this.synchronizeMatch();
    const active = this.activeAttack;
    if (!active || active.draft !== draft || active.state === 'revoked') return STALE;
    if (active.state === 'bound' && active.commitment && active.bindResult) {
      if (samePlan(active.commitment, plan)) return active.bindResult;
      this.failAttackBeforeConsume();
      return CONFLICT;
    }
    if (
      active.state !== 'prepared' ||
      !validPlan(plan, draft.attackerAthleteId) ||
      !this.activeSet?.commitment ||
      draft.originSetPlanId !== this.activeSet.commitment.planId
    ) {
      this.failAttackBeforeConsume();
      return CONFLICT;
    }
    const strategic = draft.execution.mode === 'strategic' ? draft.execution : undefined;
    const commitment = Object.freeze({
      planId: plan.planId,
      tacticalRevision: plan.tacticalRevision,
      athleteId: plan.athleteId,
      draft,
      decisionId: strategic?.decisionId ?? null,
      observationTick: strategic?.observationTick ?? null,
    });
    const bound = Object.freeze({ status: 'bound' as const, commitment });
    active.commitment = commitment;
    active.bindResult = bound;
    active.state = 'bound';
    return bound;
  }

  consumeAttack(commitment: BoundAttackCommitment, plan: SetPlanIdentity): AttackConsumeResult {
    this.synchronizeMatch();
    const active = this.activeAttack;
    if (!active || active.state !== 'bound' || active.commitment !== commitment) {
      return STALE;
    }
    if (!samePlan(commitment, plan)) {
      this.failAttackBeforeConsume();
      return CONFLICT;
    }
    active.state = 'consumed';
    this.resolveSetDelivery(commitment.draft.deliveryEffectiveness ?? 0);
    return Object.freeze({ status: 'consumed' as const, execution: commitment.draft.execution });
  }

  resolveAttackBlock(commitment: BoundAttackCommitment): boolean {
    return this.resolveAttackTerminal(commitment, 0);
  }

  resolveAttackDefense(commitment: BoundAttackCommitment, effectiveness: number): boolean {
    this.synchronizeMatch();
    if (
      !this.activeAttack ||
      this.activeAttack.state !== 'consumed' ||
      this.activeAttack.commitment !== commitment
    ) {
      return false;
    }
    if (!Number.isFinite(effectiveness) || effectiveness < 0 || effectiveness > 1) {
      throw new RangeError('effectiveness da defesa deve estar em [0,1]');
    }
    return this.resolveAttackTerminal(commitment, effectiveness);
  }

  resolveOffensePoint(rally: OffenseRallyRef, winner: TeamSide): boolean {
    this.synchronizeMatch();
    if (!this.activeRally || rally !== this.activeRally) return false;
    const active = this.activeAttack;
    if (!active?.commitment || active.state !== 'consumed') return false;
    if (!validSide(winner)) throw new RangeError('vencedor ofensivo inválido');
    return this.resolveAttackTerminal(
      active.commitment,
      winner === active.draft.decisionContact.side ? 1 : 0,
    );
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

  private storeAttackDraft(active: ActiveAttack, draft: AttackDecisionDraft): AttackPrepareResult {
    const prepared = Object.freeze({ status: 'prepared' as const, draft });
    active.draft = draft;
    active.prepareResult = prepared;
    active.state = 'prepared';
    this.activeAttack = active;
    return prepared;
  }

  private resolveSetDelivery(effectiveness: number): void {
    const execution = this.activeSet?.draft?.execution;
    if (execution?.mode !== 'strategic') return;
    if (this.strategy.outcomeState(execution.decisionId) !== 'pending') return;
    this.strategy.resolveOutcome(execution.decisionId, effectiveness);
  }

  private resolveAttackTerminal(commitment: BoundAttackCommitment, effectiveness: number): boolean {
    this.synchronizeMatch();
    const active = this.activeAttack;
    if (!active || active.state !== 'consumed' || active.commitment !== commitment) {
      return false;
    }
    if (commitment.draft.execution.mode === 'strategic') {
      if (this.strategy.outcomeState(commitment.draft.execution.decisionId) !== 'pending') {
        return false;
      }
      this.strategy.resolveOutcome(commitment.draft.execution.decisionId, effectiveness);
    }
    active.state = 'resolved';
    return true;
  }

  private failAttackBeforeConsume(): void {
    const active = this.activeAttack;
    if (active && active.state !== 'resolved' && active.state !== 'revoked') {
      this.revokePending(
        active.draft.execution.mode === 'strategic' ? active.draft.execution.decisionId : undefined,
      );
      active.state = 'revoked';
    }
    if (this.activeSet?.state === 'consumed') this.resolveSetDelivery(0);
  }

  private revokePending(decisionId: string | undefined): void {
    if (!decisionId) return;
    if (this.strategy.outcomeState(decisionId) === 'pending') {
      this.strategy.revokeDecision(decisionId);
    }
  }

  private storeFallback(
    contact: OffenseContactRef,
    read: OwnContactRead,
    setter: SetterEtaSelection,
    leadTicks: number,
    reason: StrategicSetFallbackReason,
  ): SetPrepareResult {
    const execution = fallbackExecution(read, setter.athleteId, contact, reason);
    return this.storeDraft(
      contact,
      setter,
      leadTicks,
      execution,
      execution.mode === 'fallback-high' ? execution.attackerAthleteId : null,
      null,
    );
  }

  private storeDraft(
    contact: OffenseContactRef,
    setter: SetterEtaSelection,
    leadTicks: number,
    execution: SetExecution,
    plannedAttackerAthleteId: number | null,
    plannedAttack: AttackDecisionDraft | null,
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
      plannedAttackerAthleteId,
      plannedAttack,
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
    if (this.activeAttack?.state === 'consumed' && this.activeAttack.commitment) {
      this.resolveAttackTerminal(this.activeAttack.commitment, 0);
    } else if (
      this.activeAttack &&
      this.activeAttack.state !== 'resolved' &&
      this.activeAttack.state !== 'revoked'
    ) {
      this.failAttackBeforeConsume();
    }
    if (active.state === 'consumed') this.resolveSetDelivery(0);
    if (
      active.state !== 'consumed' &&
      active.state !== 'unplayable' &&
      active.state !== 'revoked'
    ) {
      this.revokeActiveSet(active);
    }
    this.activeSet = undefined;
    this.activeAttack = undefined;
  }

  private revokeActiveSet(active: ActiveSet): void {
    if (active.state === 'revoked') return;
    if (this.activeAttack) {
      this.revokePending(
        this.activeAttack.draft.execution.mode === 'strategic'
          ? this.activeAttack.draft.execution.decisionId
          : undefined,
      );
      this.activeAttack.state = 'revoked';
    }
    if (active.draft?.execution.mode === 'strategic') {
      this.revokePending(active.draft.execution.decisionId);
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
    this.activeAttack = undefined;
  }

  private assertBoundary(): void {
    if (
      this.activeRally ||
      this.activePossession ||
      this.activeContact ||
      this.activeSet ||
      this.activeAttack
    ) {
      throw new Error('checkpoint ofensivo permitido somente na fronteira de ponto');
    }
  }
}
