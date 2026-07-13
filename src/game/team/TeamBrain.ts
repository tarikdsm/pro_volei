import { COURT, TEAM_TACTICS, TeamSide } from '../../core/constants';
import { clampOwnHalf, fromLocalCourt, toLocalCourt } from './CourtFrame';
import type {
  AthleteTacticalSnapshot,
  TacticalAssignment,
  TacticalPoint,
  TacticalRole,
  TeamBrainFrame,
  TeamPlan,
} from './TeamTactics';

interface LocalAthlete extends Omit<AthleteTacticalSnapshot, 'position' | 'velocity' | 'base'> {
  readonly position: TacticalPoint;
  readonly velocity: TacticalPoint;
  readonly base: TacticalPoint;
}

interface LocalAssignment {
  readonly athleteId: number;
  readonly role: TacticalRole;
  readonly target: TacticalPoint;
}

const ADJUSTMENTS: readonly TacticalPoint[] = [
  { x: 0, z: 0 },
  { x: 0, z: -0.7 },
  { x: 0, z: 0.7 },
  { x: -0.7, z: 0 },
  { x: 0.7, z: 0 },
  { x: -0.7, z: -0.7 },
  { x: -0.7, z: 0.7 },
  { x: 0.7, z: -0.7 },
  { x: 0.7, z: 0.7 },
  { x: 0, z: -1.4 },
  { x: 0, z: 1.4 },
];

function distanceSq(a: TacticalPoint, b: TacticalPoint): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function frozenPoint(point: TacticalPoint): TacticalPoint {
  return Object.freeze({ x: point.x, z: point.z });
}

/** Planner coletivo puro. Mechanics continua dona do contato e da trajetória da bola. */
export class TeamBrain {
  plan(frame: TeamBrainFrame): TeamPlan {
    this.validateFrame(frame);
    const athletes = frame.athletes
      .map((athlete): LocalAthlete => ({
        ...athlete,
        position: toLocalCourt(athlete.position, frame.side),
        velocity: toLocalCourt(athlete.velocity, frame.side),
        base: toLocalCourt(athlete.base, frame.side),
      }))
      .sort((a, b) => a.athleteId - b.athleteId);

    let assignments: LocalAssignment[];
    switch (frame.phase) {
      case 'base':
      case 'recompose':
        assignments = athletes.map((athlete) => ({
          athleteId: athlete.athleteId,
          role: 'base',
          target: athlete.base,
        }));
        break;
      case 'reception':
        assignments = this.planReception(frame, athletes);
        break;
      default:
        throw new Error(`Fase tática ainda não implementada: ${frame.phase}`);
    }

    const worldAssignments = assignments
      .map((assignment): TacticalAssignment =>
        Object.freeze({
          athleteId: assignment.athleteId,
          role: assignment.role,
          target: frozenPoint(fromLocalCourt(assignment.target, frame.side)),
        }),
      )
      .sort((a, b) => a.athleteId - b.athleteId);

    return Object.freeze({
      side: frame.side,
      revision: frame.revision,
      planId: frame.planId,
      phase: frame.phase,
      assignments: Object.freeze(worldAssignments),
      block: null,
    });
  }

  private planReception(
    frame: TeamBrainFrame,
    athletes: readonly LocalAthlete[],
  ): LocalAssignment[] {
    if (frame.activeAthleteId === null || frame.contactPoint === null) {
      throw new Error('Recepção exige atleta ativa e ponto de contato');
    }
    const active = athletes.find((athlete) => athlete.athleteId === frame.activeAthleteId);
    if (!active) throw new Error('Atleta ativa não pertence ao time');
    const activeTarget = clampOwnHalf(
      toLocalCourt(frame.contactPoint, frame.side),
      TEAM_TACTICS.courtMargin,
      TEAM_TACTICS.netMargin,
    );

    const setterTarget = clampOwnHalf(
      TEAM_TACTICS.setterRelease,
      TEAM_TACTICS.courtMargin,
      TEAM_TACTICS.netMargin,
    );
    const setter = this.selectSetter(
      frame.setterAthleteId,
      athletes,
      active.athleteId,
      setterTarget,
    );
    const reserved: TacticalPoint[] = [activeTarget];
    const placedSetter = this.separateTarget(setterTarget, reserved);
    reserved.push(placedSetter);

    const remaining = athletes.filter(
      (athlete) => athlete.athleteId !== active.athleteId && athlete.athleteId !== setter.athleteId,
    );
    const assignments: LocalAssignment[] = [
      { athleteId: active.athleteId, role: 'active', target: activeTarget },
      { athleteId: setter.athleteId, role: 'setter', target: placedSetter },
    ];

    for (const formation of TEAM_TACTICS.reception) {
      const target = this.separateTarget(formation.target, reserved);
      reserved.push(target);
      const selected = remaining
        .slice()
        .sort(
          (a, b) =>
            distanceSq(a.position, target) - distanceSq(b.position, target) ||
            a.athleteId - b.athleteId,
        )[0];
      assignments.push({ athleteId: selected.athleteId, role: formation.role, target });
      remaining.splice(
        remaining.findIndex((athlete) => athlete.athleteId === selected.athleteId),
        1,
      );
    }
    return assignments;
  }

  private selectSetter(
    requestedId: number | null,
    athletes: readonly LocalAthlete[],
    activeId: number,
    target: TacticalPoint,
  ): LocalAthlete {
    const requested = athletes.find(
      (athlete) => athlete.athleteId === requestedId && athlete.athleteId !== activeId,
    );
    if (requested) return requested;
    const candidates = athletes
      .filter((athlete) => athlete.athleteId !== activeId)
      .sort(
        (a, b) =>
          distanceSq(a.position, target) - distanceSq(b.position, target) ||
          a.athleteId - b.athleteId,
      );
    return candidates[0];
  }

  private separateTarget(
    desired: TacticalPoint,
    occupied: readonly TacticalPoint[],
  ): TacticalPoint {
    const minimumSq = TEAM_TACTICS.targetSeparation ** 2 - 1e-9;
    for (const adjustment of ADJUSTMENTS) {
      const target = clampOwnHalf(
        { x: desired.x + adjustment.x, z: desired.z + adjustment.z },
        TEAM_TACTICS.courtMargin,
        TEAM_TACTICS.netMargin,
      );
      if (occupied.every((other) => distanceSq(target, other) >= minimumSq)) return target;
    }
    throw new Error('Não foi possível separar os targets da formação');
  }

  private validateFrame(frame: TeamBrainFrame): void {
    if (frame.athletes.length !== 6) throw new Error('TeamBrain exige exatamente seis atletas');
    if (new Set(frame.athletes.map((athlete) => athlete.athleteId)).size !== 6) {
      throw new Error('TeamBrain exige IDs únicos');
    }
    if (!Number.isSafeInteger(frame.revision) || frame.revision < 0) {
      throw new Error('Revisão tática inválida');
    }
    if (frame.planId !== null && (!Number.isSafeInteger(frame.planId) || frame.planId === 0)) {
      throw new Error('planId tático inválido');
    }
    const slots = frame.athletes.map((athlete) => athlete.slot);
    if (
      new Set(slots).size !== 6 ||
      slots.some((slot) => !Number.isSafeInteger(slot) || slot < 0 || slot > 5)
    ) {
      throw new Error('TeamBrain exige seis slots únicos entre 0 e 5');
    }
    const knownIds = new Set(frame.athletes.map((athlete) => athlete.athleteId));
    if (frame.activeAthleteId !== null && !knownIds.has(frame.activeAthleteId)) {
      throw new Error('Atleta ativa não pertence ao time');
    }
    if (frame.setterAthleteId !== null && !knownIds.has(frame.setterAthleteId)) {
      throw new Error('Levantadora não pertence ao time');
    }
    if (
      frame.contactPoint !== null &&
      (!Number.isFinite(frame.contactPoint.x) || !Number.isFinite(frame.contactPoint.z))
    ) {
      throw new Error('Ponto de contato tático inválido');
    }
    for (const athlete of frame.athletes) {
      const numbers = [
        athlete.athleteId,
        athlete.slot,
        athlete.position.x,
        athlete.position.z,
        athlete.velocity.x,
        athlete.velocity.z,
        athlete.base.x,
        athlete.base.z,
      ];
      if (!numbers.every(Number.isFinite)) throw new Error('Snapshot tático contém valor inválido');
      const expectedRow = athlete.slot <= 2 ? 'back' : 'front';
      if (athlete.row !== expectedRow) throw new Error('Linha tática incoerente com o slot');
      const localBase = toLocalCourt(athlete.base, frame.side);
      if (
        localBase.x < -COURT.halfLength + TEAM_TACTICS.courtMargin ||
        localBase.x > -TEAM_TACTICS.netMargin ||
        Math.abs(localBase.z) > COURT.halfWidth - TEAM_TACTICS.courtMargin
      ) {
        throw new Error('Base tática fora da meia quadra');
      }
    }
    const minimumSq = TEAM_TACTICS.targetSeparation ** 2 - 1e-9;
    for (let i = 0; i < frame.athletes.length; i++) {
      for (let j = i + 1; j < frame.athletes.length; j++) {
        if (distanceSq(frame.athletes[i].base, frame.athletes[j].base) < minimumSq) {
          throw new Error('Bases táticas sem separação mínima');
        }
      }
    }
    if (frame.side !== TeamSide.HOME && frame.side !== TeamSide.AWAY) {
      throw new Error('Lado tático inválido');
    }
  }
}
