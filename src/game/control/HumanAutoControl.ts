import { BLOCK, TeamSide } from '../../core/constants';
import type { Athlete } from '../Team';
import type { TouchPlan } from '../RallyState';
import type { MechanicsCtx } from '../mechanics/context';
import type { CourtAxis } from '../../core/input/CameraSpaceMapper';
import { AutoSelectionSession, autoControlKindForTouch } from './AutoSelectionSession';
import { assistedTarget, type PlanarPoint } from './assistance';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Cola AutoSelectionSession ao domínio humano sem misturar timing/ações do botão. */
export class HumanAutoControl {
  private readonly selection = new AutoSelectionSession();
  private readonly manualTarget = { x: 0, z: 0 };
  private blockPlanId: number | null = null;
  private blockPointZ = 0;

  beginReceive(ctx: MechanicsCtx, plan: TouchPlan): Athlete {
    this.selection.release();
    const kind = autoControlKindForTouch(plan.kind);
    const result = kind
      ? this.selection.begin({
          planId: plan.planId,
          kind,
          side: TeamSide.HOME,
          contactPoint: plan.point,
          contactIn: plan.contactIn,
          roster: ctx.teamOf(TeamSide.HOME),
          excluded: ctx.rally.excludedPasser(TeamSide.HOME) ?? null,
        })
      : null;
    const selected = result?.selected ?? plan.athlete;
    plan.athlete = selected;
    this.anchor(selected.pos);
    return selected;
  }

  beginBlock(ctx: MechanicsCtx, fallback: Athlete): Athlete {
    this.selection.release();
    const plan = ctx.rally.plan;
    this.blockPlanId = plan?.planId ?? null;
    this.blockPointZ = plan?.point.z ?? fallback.pos.z;
    const result = plan
      ? this.selection.begin({
          planId: plan.planId,
          kind: 'block',
          side: TeamSide.HOME,
          contactPoint: { x: -BLOCK.netX, z: plan.point.z },
          contactIn: plan.contactIn,
          roster: ctx.teamOf(TeamSide.HOME),
          excluded: null,
        })
      : null;
    const selected = result?.selected ?? fallback;
    this.manualTarget.x = -BLOCK.netX;
    this.manualTarget.z = selected.pos.z;
    return selected;
  }

  refreshReceive(ctx: MechanicsCtx, plan: TouchPlan, current: Athlete): Athlete {
    const kind = autoControlKindForTouch(plan.kind);
    if (!kind) return current;
    const result = this.selection.update({
      planId: plan.planId,
      kind,
      side: TeamSide.HOME,
      contactPoint: plan.point,
      contactIn: plan.contactIn,
      roster: ctx.teamOf(TeamSide.HOME),
      excluded: ctx.rally.excludedPasser(TeamSide.HOME) ?? null,
    });
    const selected = result.selected ?? current;
    if (result.changed) this.anchor(selected.pos);
    plan.athlete = selected;
    return selected;
  }

  refreshBlock(ctx: MechanicsCtx, plan: TouchPlan, current: Athlete): Athlete {
    if (current.isAirborne || plan.planId !== this.blockPlanId || plan.kind !== 'spike') {
      return current;
    }
    const result = this.selection.update({
      planId: plan.planId,
      kind: 'block',
      side: TeamSide.HOME,
      contactPoint: { x: -BLOCK.netX, z: plan.point.z },
      contactIn: plan.contactIn,
      roster: ctx.teamOf(TeamSide.HOME),
      excluded: null,
    });
    const selected = result.selected ?? current;
    if (result.changed) {
      this.manualTarget.x = -BLOCK.netX;
      this.manualTarget.z = selected.pos.z;
    }
    return selected;
  }

  receiveRoute(axis: CourtAxis, plan: TouchPlan, athlete: Athlete): PlanarPoint {
    if (axis.x !== 0 || axis.z !== 0) {
      this.manualTarget.x = athlete.pos.x + axis.x * 1.2;
      this.manualTarget.z = athlete.pos.z + axis.z * 1.2;
    }
    return assistedTarget(this.manualTarget, plan.point, TeamSide.HOME);
  }

  blockRoute(axis: CourtAxis, plan: TouchPlan, athlete: Athlete): PlanarPoint {
    if (axis.z !== 0) {
      this.manualTarget.x = -BLOCK.netX;
      this.manualTarget.z = clamp(athlete.pos.z + axis.z * 1.2, -4.2, 4.2);
    }
    const route = assistedTarget(
      this.manualTarget,
      { x: -BLOCK.netX, z: plan.planId === this.blockPlanId ? this.blockPointZ : athlete.pos.z },
      TeamSide.HOME,
    );
    return { x: -BLOCK.netX, z: clamp(route.z, -4.2, 4.2) };
  }

  release(): void {
    this.selection.release();
    this.blockPlanId = null;
  }

  snapshot() {
    return this.selection.snapshot();
  }

  private anchor(point: PlanarPoint): void {
    this.manualTarget.x = point.x;
    this.manualTarget.z = point.z;
  }
}
