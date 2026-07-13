import type { TeamSide } from '../../core/constants';
import { TeamBrain } from './TeamBrain';
import type { TacticalPoint, TeamBrainFrame, TeamPlan, TeamTacticsPhase } from './TeamTactics';

export interface TacticalAthletePort {
  readonly index: number;
  readonly pos: TacticalPoint;
  readonly velocity: TacticalPoint;
  readonly target: TacticalPoint;
  readonly isAirborne: boolean;
  moveTo(x: number, z: number): void;
}

export interface TacticalTeamPort {
  readonly side: TeamSide;
  readonly athletes: readonly TacticalAthletePort[];
  readonly slots: readonly number[];
  slotPos(slot: number): TacticalPoint;
}

export interface TeamCoordinationRequest {
  readonly team: TacticalTeamPort;
  readonly phase: TeamTacticsPhase;
  readonly planId?: number | null;
  readonly activeAthleteId?: number | null;
  readonly contactPoint?: TacticalPoint | null;
  readonly setterAthleteId?: number | null;
  readonly reservedAthleteIds?: readonly number[];
}

/** Adapta o planner puro aos targets mutáveis das atletas e centraliza o ownership coletivo. */
export class TeamTacticsSystem {
  private readonly brains = [new TeamBrain(), new TeamBrain()] as const;
  private readonly revisions = [0, 0];
  private readonly plans: [TeamPlan | null, TeamPlan | null] = [null, null];
  private readonly keys: [string | null, string | null] = [null, null];

  coordinate(request: TeamCoordinationRequest): TeamPlan {
    const { team } = request;
    const knownIds = new Set(team.athletes.map((athlete) => athlete.index));
    for (const reservedId of request.reservedAthleteIds ?? []) {
      if (!knownIds.has(reservedId)) throw new Error(`Reserva tática ${reservedId} ausente`);
    }
    const key = this.keyFor(request);
    const previousPlan = this.plans[team.side];
    if (previousPlan && this.keys[team.side] === key) return previousPlan;

    const revision = this.revisions[team.side] + 1;
    const frame: TeamBrainFrame = {
      side: team.side,
      revision,
      planId: request.planId ?? null,
      phase: request.phase,
      athletes: team.slots.map((athleteId, slot) => {
        const athlete = this.athleteById(team, athleteId);
        return {
          athleteId,
          slot,
          row: slot <= 2 ? 'back' : 'front',
          position: { x: athlete.pos.x, z: athlete.pos.z },
          velocity: { x: athlete.velocity.x, z: athlete.velocity.z },
          base: team.slotPos(slot),
          airborne: athlete.isAirborne,
        };
      }),
      activeAthleteId: request.activeAthleteId ?? null,
      contactPoint: request.contactPoint ?? null,
      setterAthleteId: request.setterAthleteId ?? null,
    };
    const plan = this.brains[team.side].plan(frame);
    const reserved = new Set(request.reservedAthleteIds ?? []);
    if (frame.activeAthleteId !== null) reserved.add(frame.activeAthleteId);
    const commands = plan.assignments
      .filter((assignment) => !reserved.has(assignment.athleteId))
      .map((assignment) => {
        const athlete = this.athleteById(team, assignment.athleteId);
        return {
          athlete,
          target: assignment.target,
          previous: { x: athlete.target.x, z: athlete.target.z },
        };
      });
    let applied = 0;
    try {
      for (const command of commands) {
        command.athlete.moveTo(command.target.x, command.target.z);
        applied++;
      }
    } catch (error) {
      for (let index = applied - 1; index >= 0; index--) {
        const command = commands[index];
        try {
          command.athlete.moveTo(command.previous.x, command.previous.z);
        } catch {
          // Best-effort: tenta restaurar todas e preserva o erro original do writer.
        }
      }
      throw error;
    }
    this.revisions[team.side] = revision;
    this.plans[team.side] = plan;
    this.keys[team.side] = key;
    return plan;
  }

  hold(team: TacticalTeamPort): TeamPlan {
    return this.coordinate({ team, phase: 'hold' });
  }

  snapshot(side: TeamSide): TeamPlan | null {
    return this.plans[side];
  }

  reset(side?: TeamSide): void {
    if (side === undefined) {
      this.revisions[0] = 0;
      this.revisions[1] = 0;
      this.plans[0] = null;
      this.plans[1] = null;
      this.keys[0] = null;
      this.keys[1] = null;
      return;
    }
    this.revisions[side] = 0;
    this.plans[side] = null;
    this.keys[side] = null;
  }

  private keyFor(request: TeamCoordinationRequest): string {
    const reserved = [...(request.reservedAthleteIds ?? [])].sort((a, b) => a - b);
    const point = request.contactPoint;
    const holdPositions =
      request.phase === 'hold'
        ? request.team.athletes.map((athlete) => [athlete.index, athlete.pos.x, athlete.pos.z])
        : [];
    return JSON.stringify([
      request.phase,
      request.planId ?? null,
      request.activeAthleteId ?? null,
      request.setterAthleteId ?? null,
      point?.x ?? null,
      point?.z ?? null,
      request.team.slots,
      reserved,
      holdPositions,
    ]);
  }

  private athleteById(team: TacticalTeamPort, athleteId: number): TacticalAthletePort {
    const athlete = team.athletes.find((candidate) => candidate.index === athleteId);
    if (!athlete) throw new Error(`Atleta tática ${athleteId} ausente`);
    return athlete;
  }
}
