import {
  AUTO_SELECTOR,
  BLOCK,
  CONTACT,
  PLAYER,
  TeamSide,
  type TouchKind,
} from '../../core/constants';
import type { Athlete } from '../Team';
import {
  AutoSelector,
  type InterceptCandidate,
  type SelectionDecision,
  type SelectionSnapshot,
} from './AutoSelector';
import type { PlanarPoint } from './assistance';

export type AutoControlKind = 'receive' | 'block';

export interface SelectionRoster {
  readonly athletes: readonly Athlete[];
  frontRow(): Athlete[];
  slotIndexOf(athlete: Athlete): number;
  basePositionOf(athlete: Athlete): PlanarPoint | null;
}

export interface AutoControlAssignment {
  readonly planId: number;
  readonly kind: AutoControlKind;
  readonly side: TeamSide;
  readonly contactPoint: PlanarPoint;
  readonly contactIn: number;
  readonly roster: SelectionRoster;
  readonly excluded: Athlete | null;
}

export interface AutoSelectionResult {
  readonly selected: Athlete | null;
  readonly previous: Athlete | null;
  readonly changed: boolean;
  readonly decision: SelectionDecision<Athlete>;
}

/** Adapta Athlete/Team ao seletor neutro e gerencia transferência de uma atribuição. */
export class AutoSelectionSession {
  private readonly selector = new AutoSelector<Athlete>();
  private selected: Athlete | null = null;

  begin(assignment: AutoControlAssignment): AutoSelectionResult {
    const previous = this.selected;
    const decision = this.selector.begin(this.request(assignment));
    this.selected = decision.selected?.value ?? null;
    return this.result(previous, decision);
  }

  update(assignment: AutoControlAssignment): AutoSelectionResult {
    const previous = this.selected;
    const decision = this.selector.update(this.request(assignment));
    const next = decision.selected?.value ?? previous;
    if (next !== previous && previous) previous.moveTo(previous.pos.x, previous.pos.z);
    this.selected = next;
    return this.result(previous, decision);
  }

  release(): void {
    this.selector.release();
    this.selected = null;
  }

  snapshot(): SelectionSnapshot {
    return this.selector.snapshot();
  }

  private request(assignment: AutoControlAssignment) {
    const pool =
      assignment.kind === 'block' ? assignment.roster.frontRow() : assignment.roster.athletes;
    const candidates = pool.map((athlete) => this.candidate(athlete, assignment));
    return {
      planId: assignment.planId,
      contactIn: assignment.contactIn,
      technicalRadius: assignment.kind === 'block' ? BLOCK.zReach : CONTACT.reach,
      candidates,
    };
  }

  private candidate(
    athlete: Athlete,
    assignment: AutoControlAssignment,
  ): InterceptCandidate<Athlete> {
    const dx = assignment.contactPoint.x - athlete.pos.x;
    const dz = assignment.contactPoint.z - athlete.pos.z;
    const distance = Math.hypot(dx, dz);
    const directionX = distance > 1e-9 ? dx / distance : 0;
    const directionZ = distance > 1e-9 ? dz / distance : 0;
    const projectedVelocity = athlete.velocity.x * directionX + athlete.velocity.z * directionZ;
    const lateralVelocity = Math.sqrt(
      Math.max(0, athlete.velocity.lengthSq() - projectedVelocity * projectedVelocity),
    );
    const slot = assignment.roster.slotIndexOf(athlete);
    const base = assignment.roster.basePositionOf(athlete);
    const baseDistance = base ? Math.hypot(athlete.pos.x - base.x, athlete.pos.z - base.z) : 0;
    const movementScale = athlete.speedMul * (athlete.isAirborne ? 0.25 : 1);

    return {
      id: athlete.index,
      value: athlete,
      distance,
      projectedVelocity,
      lateralVelocity,
      maxSpeed: PLAYER.speed * movementScale,
      acceleration: PLAYER.acceleration * movementScale,
      deceleration: PLAYER.deceleration * movementScale,
      legal:
        athlete !== assignment.excluded &&
        (assignment.kind === 'block' || !athlete.isAirborne) &&
        athlete.side === assignment.side,
      tacticalCost: assignment.kind === 'receive' && slot >= 3 ? AUTO_SELECTOR.frontRowCost : 0,
      coverageCost: baseDistance * AUTO_SELECTOR.coverageCostPerMeter,
      approachCost: projectedVelocity < -0.1 ? AUTO_SELECTOR.movingAwayCost : 0,
    };
  }

  private result(
    previous: Athlete | null,
    decision: SelectionDecision<Athlete>,
  ): AutoSelectionResult {
    return Object.freeze({
      selected: this.selected,
      previous,
      changed: this.selected !== previous,
      decision,
    });
  }
}

/** Contextos cobertos nesta fase; útil para guards exaustivos na integração. */
export function autoControlKindForTouch(kind: TouchKind): AutoControlKind | null {
  return kind === 'pass' || kind === 'dig' || kind === 'freeball' ? 'receive' : null;
}
