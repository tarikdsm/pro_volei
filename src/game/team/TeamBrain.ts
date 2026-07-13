import { BLOCK, COURT, PLAYER, TEAM_TACTICS, TeamSide } from '../../core/constants';
import { clampOwnHalf, fromLocalCourt, toLocalCourt } from './CourtFrame';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import type {
  AthleteTacticalSnapshot,
  TacticalAssignment,
  BlockPlan,
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
    let block: BlockPlan | null = null;
    switch (frame.phase) {
      case 'base':
      case 'recompose':
        assignments = athletes.map((athlete) => ({
          athleteId: athlete.athleteId,
          role: 'base',
          target: athlete.base,
        }));
        break;
      case 'serve-formation': {
        const serverId = frame.serverAthleteId ?? null;
        const serverPoint = frame.serverPoint ?? null;
        if (serverId === null || serverPoint === null) {
          throw new Error('Formação de saque exige sacadora e posição de saque');
        }
        if (!athletes.some((athlete) => athlete.athleteId === serverId)) {
          throw new Error('Sacadora não pertence ao time');
        }
        const localServerPoint = toLocalCourt(serverPoint, frame.side);
        if (!Number.isFinite(localServerPoint.x) || !Number.isFinite(localServerPoint.z)) {
          throw new Error('Posição de saque inválida');
        }
        assignments = athletes.map((athlete) => ({
          athleteId: athlete.athleteId,
          role: athlete.athleteId === serverId ? 'server' : 'base',
          target: athlete.athleteId === serverId ? localServerPoint : athlete.base,
        }));
        break;
      }
      case 'hold':
        assignments = athletes.map((athlete) => ({
          athleteId: athlete.athleteId,
          role: 'base',
          target: athlete.position,
        }));
        break;
      case 'reception':
        assignments = this.planReception(frame, athletes);
        break;
      case 'offense-transition':
        assignments = this.planOffenseTransition(frame, athletes);
        break;
      case 'attack-coverage':
        assignments = this.planAttackCoverage(frame, athletes);
        break;
      case 'block-defense': {
        const defense = this.planBlockDefense(frame, athletes);
        assignments = defense.assignments;
        block = defense.block;
        break;
      }
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
      block: block ? Object.freeze({ ...block }) : null,
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

  private planOffenseTransition(
    frame: TeamBrainFrame,
    athletes: readonly LocalAthlete[],
  ): LocalAssignment[] {
    const { active, target } = this.activeContact(frame, athletes, 'Transição ofensiva');
    const remaining = athletes.filter((athlete) => athlete.athleteId !== active.athleteId);
    return [
      { athleteId: active.athleteId, role: 'active', target },
      ...this.assignFormation(remaining, TEAM_TACTICS.offenseTransition, [target]),
    ];
  }

  private planAttackCoverage(
    frame: TeamBrainFrame,
    athletes: readonly LocalAthlete[],
  ): LocalAssignment[] {
    const { active, target: activeTarget } = this.activeContact(
      frame,
      athletes,
      'Cobertura de ataque',
    );
    const setterId = frame.setterAthleteId;
    const setter = athletes.find(
      (athlete) => athlete.athleteId === setterId && athlete.athleteId !== active.athleteId,
    );
    if (!setter) {
      throw new Error(
        `Cobertura de ataque exige levantadora diferente da atacante (setter=${String(setterId)}, active=${active.athleteId})`,
      );
    }
    const localContact = toLocalCourt(frame.contactPoint!, frame.side);
    const lateralDirection = localContact.z >= 0 ? -1 : 1;
    const setterTarget = this.separateTarget(
      {
        x: TEAM_TACTICS.attackCoverage.setterDepth,
        z: localContact.z + lateralDirection * TEAM_TACTICS.attackCoverage.setterLateralOffset,
      },
      [activeTarget],
    );
    const remaining = athletes.filter(
      (athlete) => athlete.athleteId !== active.athleteId && athlete.athleteId !== setter.athleteId,
    );
    const specs = [
      {
        role: 'cover-short-left' as const,
        target: {
          x: TEAM_TACTICS.attackCoverage.shortDepth,
          z: localContact.z - TEAM_TACTICS.attackCoverage.shortLateralOffset,
        },
      },
      {
        role: 'cover-short-right' as const,
        target: {
          x: TEAM_TACTICS.attackCoverage.shortDepth,
          z: localContact.z + TEAM_TACTICS.attackCoverage.shortLateralOffset,
        },
      },
      {
        role: 'cover-deep' as const,
        target: { x: TEAM_TACTICS.attackCoverage.deepDepth, z: localContact.z * 0.4 },
      },
      {
        role: 'attacker' as const,
        target: {
          x: -2.1,
          z:
            localContact.z >= 0
              ? -TEAM_TACTICS.attackCoverage.oppositeAttackZ
              : TEAM_TACTICS.attackCoverage.oppositeAttackZ,
        },
      },
    ];
    return [
      { athleteId: active.athleteId, role: 'active', target: activeTarget },
      { athleteId: setter.athleteId, role: 'setter', target: setterTarget },
      ...this.assignFormation(remaining, specs, [activeTarget, setterTarget]),
    ];
  }

  private planBlockDefense(
    frame: TeamBrainFrame,
    athletes: readonly LocalAthlete[],
  ): { assignments: LocalAssignment[]; block: BlockPlan } {
    if (frame.contactPoint === null || frame.contactIn === null || frame.contactIn === undefined) {
      throw new Error('Defesa de bloqueio exige ponto e tempo de contato');
    }
    if (!Number.isFinite(frame.contactIn) || frame.contactIn < 0) {
      throw new Error('Tempo de bloqueio inválido');
    }
    const localContact = toLocalCourt(frame.contactPoint, frame.side);
    const crossZ = clampOwnHalf(
      { x: -BLOCK.netX, z: localContact.z },
      TEAM_TACTICS.courtMargin,
      TEAM_TACTICS.netMargin,
    ).z;
    const front = athletes.filter((athlete) => athlete.row === 'front');
    const requestedPrimary = front.find((athlete) => athlete.athleteId === frame.activeAthleteId);
    const primaryTarget = { x: -BLOCK.netX, z: crossZ };
    const primary =
      requestedPrimary ??
      front
        .map((athlete) => ({
          athlete,
          eta: this.arrivalTime(athlete, primaryTarget),
          distanceSq: distanceSq(athlete.position, primaryTarget),
        }))
        .sort(
          (a, b) =>
            a.eta - b.eta ||
            a.distanceSq - b.distanceSq ||
            a.athlete.athleteId - b.athlete.athleteId,
        )[0]?.athlete;
    if (!primary) throw new Error('Defesa de bloqueio exige uma atleta de rede');

    const assistCandidates = front
      .filter(
        (athlete) =>
          athlete.athleteId !== primary.athleteId && Math.abs(athlete.slot - primary.slot) === 1,
      )
      .flatMap((athlete) =>
        [-1, 1].flatMap((direction) => {
          const target = clampOwnHalf(
            {
              x: -BLOCK.netX,
              z: crossZ + direction * TEAM_TACTICS.blockDefense.blockGap,
            },
            TEAM_TACTICS.courtMargin,
            TEAM_TACTICS.netMargin,
          );
          if (distanceSq(target, primaryTarget) < TEAM_TACTICS.targetSeparation ** 2 - 1e-9) {
            return [];
          }
          return [{ athlete, target, eta: this.arrivalTime(athlete, target) }];
        }),
      )
      .sort((a, b) => a.eta - b.eta || a.athlete.athleteId - b.athlete.athleteId);
    const bestAssist = assistCandidates[0];
    const assist = bestAssist && bestAssist.eta <= frame.contactIn + 1e-9 ? bestAssist : null;

    const occupied = [primaryTarget];
    const assignments: LocalAssignment[] = [
      { athleteId: primary.athleteId, role: 'block-primary', target: primaryTarget },
    ];
    if (assist) {
      occupied.push(assist.target);
      assignments.push({
        athleteId: assist.athlete.athleteId,
        role: 'block-assist',
        target: assist.target,
      });
    }
    const remaining = athletes.filter(
      (athlete) =>
        athlete.athleteId !== primary.athleteId && athlete.athleteId !== assist?.athlete.athleteId,
    );
    assignments.push(
      ...this.assignFormation(
        remaining,
        TEAM_TACTICS.blockDefense.lanes.slice(0, remaining.length),
        occupied,
      ),
    );
    const worldCross = fromLocalCourt({ x: 0, z: crossZ }, frame.side);
    return {
      assignments,
      block: {
        primaryAthleteId: primary.athleteId,
        assistAthleteId: assist?.athlete.athleteId ?? null,
        crossZ: worldCross.z,
        contactIn: frame.contactIn,
      },
    };
  }

  private arrivalTime(athlete: LocalAthlete, target: TacticalPoint): number {
    const deltaX = target.x - athlete.position.x;
    const deltaZ = target.z - athlete.position.z;
    const distance = Math.hypot(deltaX, deltaZ);
    if (distance <= TEAM_TACTICS.blockDefense.arrivalRadius) return 0;
    if (athlete.airborne || distance <= 1e-9) return Infinity;
    const directionX = deltaX / distance;
    const directionZ = deltaZ / distance;
    const projectedVelocity = athlete.velocity.x * directionX + athlete.velocity.z * directionZ;
    const lateralVelocity = athlete.velocity.x * -directionZ + athlete.velocity.z * directionX;
    return estimatePlanarArrivalTime(
      distance,
      projectedVelocity,
      lateralVelocity,
      PLAYER.aiSpeed,
      PLAYER.acceleration,
      PLAYER.deceleration,
      TEAM_TACTICS.blockDefense.arrivalRadius,
    );
  }

  private activeContact(
    frame: TeamBrainFrame,
    athletes: readonly LocalAthlete[],
    label: string,
  ): { active: LocalAthlete; target: TacticalPoint } {
    if (frame.activeAthleteId === null || frame.contactPoint === null) {
      throw new Error(`${label} exige atleta ativa e ponto de contato`);
    }
    const active = athletes.find((athlete) => athlete.athleteId === frame.activeAthleteId);
    if (!active) throw new Error('Atleta ativa não pertence ao time');
    return {
      active,
      target: clampOwnHalf(
        toLocalCourt(frame.contactPoint, frame.side),
        TEAM_TACTICS.courtMargin,
        TEAM_TACTICS.netMargin,
      ),
    };
  }

  private assignFormation(
    source: readonly LocalAthlete[],
    specs: readonly { readonly role: TacticalRole; readonly target: TacticalPoint }[],
    occupied: TacticalPoint[],
  ): LocalAssignment[] {
    const remaining = [...source];
    const assignments: LocalAssignment[] = [];
    for (const spec of specs) {
      const target = this.separateTarget(spec.target, occupied);
      occupied.push(target);
      const selected = remaining
        .slice()
        .sort(
          (a, b) =>
            distanceSq(a.position, target) - distanceSq(b.position, target) ||
            a.athleteId - b.athleteId,
        )[0];
      if (!selected) throw new Error('Formação possui mais papéis do que atletas disponíveis');
      assignments.push({ athleteId: selected.athleteId, role: spec.role, target });
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
