import type { AttackOptionId, StrategyPoint2 } from './StrategyTypes';
import type { OffenseContactRef, SetPlanIdentity } from './StrategicOffenseSystem';

export type StrategicAttackFamily = 'power' | 'placed' | 'tip';
export type StrategicAttackBasis = 'chained-quick' | 'executed-set';
export type StrategicAttackFallbackReason =
  'insufficient-lead' | 'perception-not-ready' | 'fallback-set';

export interface StrategicAttackExecution {
  readonly mode: 'strategic';
  readonly decisionId: string;
  readonly optionId: AttackOptionId;
  readonly family: StrategicAttackFamily;
  readonly target: StrategyPoint2;
  readonly observationTick: number;
}

export interface FallbackAttackExecution {
  readonly mode: 'fallback-placed-seam';
  readonly reason: StrategicAttackFallbackReason;
  readonly optionId: 'attack.placed-seam';
  readonly family: 'placed';
  readonly target: StrategyPoint2;
}

export type AttackExecution = StrategicAttackExecution | FallbackAttackExecution;

export interface AttackDecisionDraft {
  readonly basis: StrategicAttackBasis;
  readonly decisionContact: OffenseContactRef;
  readonly executedSetContact: OffenseContactRef | null;
  readonly originSetDecisionId: string | null;
  readonly originSetPlanId: number | null;
  readonly attackerAthleteId: number;
  readonly leadTicks: number | null;
  readonly deliveryEffectiveness: number | null;
  readonly execution: AttackExecution;
}

export interface BoundAttackCommitment extends SetPlanIdentity {
  readonly draft: AttackDecisionDraft;
  readonly decisionId: string | null;
  readonly observationTick: number | null;
}

export type AttackPrepareResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'unplayable' }>
  | Readonly<{ status: 'prepared'; draft: AttackDecisionDraft }>;

export type AttackBindResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'conflict' }>
  | Readonly<{ status: 'bound'; commitment: BoundAttackCommitment }>;

export type AttackConsumeResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'conflict' }>
  | Readonly<{ status: 'consumed'; execution: AttackExecution }>;
