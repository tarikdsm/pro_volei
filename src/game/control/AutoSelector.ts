import { AUTO_SELECTOR } from '../../core/constants';
import { estimateArrivalTime } from './kinematics';

const SCORE_EPSILON = 1e-9;

export interface InterceptCandidate<T> {
  readonly id: number;
  readonly value: T;
  readonly distance: number;
  readonly projectedVelocity: number;
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly legal: boolean;
  /** Custos em segundos equivalentes; valores negativos são neutralizados. */
  readonly tacticalCost: number;
  readonly coverageCost: number;
  readonly approachCost: number;
}

export interface InterceptRequest<T> {
  readonly planId: number;
  readonly contactIn: number;
  readonly technicalRadius: number;
  readonly candidates: readonly InterceptCandidate<T>[];
}

export interface ScoredIntercept<T> extends InterceptCandidate<T> {
  readonly eta: number;
  readonly score: number;
  readonly feasible: boolean;
}

export type SelectionStatus =
  'selected' | 'held' | 'switched' | 'locked' | 'locked-illegal' | 'max-switches' | 'no-candidate';

export interface SelectionDecision<T> {
  readonly planId: number;
  readonly selected: ScoredIntercept<T> | null;
  readonly score: number;
  readonly feasible: boolean;
  readonly switches: number;
  readonly locked: boolean;
  readonly status: SelectionStatus;
}

export interface SelectionSnapshot {
  readonly planId: number | null;
  readonly selectedId: number | null;
  readonly score: number;
  readonly feasible: boolean;
  readonly switches: number;
  readonly locked: boolean;
  readonly status: SelectionStatus | 'idle';
}

function compareCandidates<T>(left: ScoredIntercept<T>, right: ScoredIntercept<T>): number {
  if (Math.abs(left.score - right.score) > SCORE_EPSILON) return left.score - right.score;
  return left.id - right.id;
}

/** Seletor stateful por plano; toda geometria chega como DTO neutro e testável. */
export class AutoSelector<T> {
  private planId: number | null = null;
  private selected: ScoredIntercept<T> | null = null;
  private switches = 0;
  private locked = false;
  private status: SelectionStatus | 'idle' = 'idle';

  begin(request: InterceptRequest<T>): SelectionDecision<T> {
    this.planId = request.planId;
    this.switches = 0;
    this.locked = request.contactIn <= AUTO_SELECTOR.lockWindow;
    this.selected = this.rank(request)[0] ?? null;
    this.status = this.selected ? 'selected' : 'no-candidate';
    return this.decision();
  }

  update(request: InterceptRequest<T>): SelectionDecision<T> {
    if (request.planId !== this.planId) return this.begin(request);

    const ranked = this.rank(request);
    this.locked = request.contactIn <= AUTO_SELECTOR.lockWindow;
    const current = ranked.find((candidate) => candidate.id === this.selected?.id) ?? null;

    if (this.locked) {
      if (!current) {
        this.status = this.selected ? 'locked-illegal' : 'no-candidate';
        return this.decision(false);
      }
      this.selected = current;
      this.status = 'locked';
      return this.decision();
    }

    if (ranked.length === 0) {
      this.status = 'no-candidate';
      return this.decision(false);
    }

    const challenger = ranked[0]!;
    if (!current) return this.tryForcedSwitch(challenger);

    this.selected = current;
    if (challenger.id === current.id) {
      this.status = 'held';
      return this.decision();
    }

    const requiredScore = current.score * (1 - AUTO_SELECTOR.switchAdvantage);
    if (challenger.score > requiredScore + SCORE_EPSILON) {
      this.status = 'held';
      return this.decision();
    }
    return this.tryForcedSwitch(challenger);
  }

  release(): void {
    this.planId = null;
    this.selected = null;
    this.switches = 0;
    this.locked = false;
    this.status = 'idle';
  }

  snapshot(): SelectionSnapshot {
    return Object.freeze({
      planId: this.planId,
      selectedId: this.selected?.id ?? null,
      score: this.selected?.score ?? Number.POSITIVE_INFINITY,
      feasible: this.selected?.feasible ?? false,
      switches: this.switches,
      locked: this.locked,
      status: this.status,
    });
  }

  private tryForcedSwitch(challenger: ScoredIntercept<T>): SelectionDecision<T> {
    if (this.switches >= AUTO_SELECTOR.maxSwitches) {
      this.status = 'max-switches';
      return this.decision(this.selected?.feasible ?? false);
    }
    this.selected = challenger;
    this.switches += 1;
    this.status = 'switched';
    return this.decision();
  }

  private rank(request: InterceptRequest<T>): ScoredIntercept<T>[] {
    if (!Number.isFinite(request.contactIn) || !Number.isFinite(request.technicalRadius)) return [];
    const contactIn = Math.max(0, request.contactIn);
    const technicalRadius = Math.max(0, request.technicalRadius);
    const scored: ScoredIntercept<T>[] = [];

    for (const candidate of request.candidates) {
      if (
        !candidate.legal ||
        !Number.isFinite(candidate.id) ||
        !Number.isFinite(candidate.distance) ||
        candidate.distance < 0 ||
        !Number.isFinite(candidate.maxSpeed) ||
        candidate.maxSpeed <= 0 ||
        !Number.isFinite(candidate.acceleration) ||
        candidate.acceleration <= 0 ||
        !Number.isFinite(candidate.tacticalCost) ||
        !Number.isFinite(candidate.coverageCost) ||
        !Number.isFinite(candidate.approachCost)
      ) {
        continue;
      }

      const travelDistance = Math.max(0, candidate.distance - technicalRadius);
      const projectedVelocity = Number.isFinite(candidate.projectedVelocity)
        ? candidate.projectedVelocity
        : 0;
      const eta = estimateArrivalTime(
        travelDistance,
        projectedVelocity,
        candidate.maxSpeed,
        candidate.acceleration,
      );
      const feasible = eta <= contactIn + SCORE_EPSILON;
      const penalties =
        Math.max(0, candidate.tacticalCost) +
        Math.max(0, candidate.coverageCost) +
        Math.max(0, candidate.approachCost);
      const score =
        eta +
        penalties +
        (feasible
          ? 0
          : AUTO_SELECTOR.unreachablePenalty +
            Math.max(0, eta - contactIn) * AUTO_SELECTOR.latenessWeight);
      scored.push(Object.freeze({ ...candidate, eta, score, feasible }));
    }

    return scored.sort(compareCandidates);
  }

  private decision(feasible = this.selected?.feasible ?? false): SelectionDecision<T> {
    return Object.freeze({
      planId: this.planId ?? -1,
      selected: this.selected,
      score: this.selected?.score ?? Number.POSITIVE_INFINITY,
      feasible,
      switches: this.switches,
      locked: this.locked,
      status: this.status === 'idle' ? 'no-candidate' : this.status,
    });
  }
}
