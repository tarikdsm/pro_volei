import { describe, expect, it } from 'vitest';
import { BASE_SLOTS, TeamSide } from '../../core/constants';
import { fromLocalCourt } from './CourtFrame';
import {
  TeamTacticsSystem,
  type TacticalAthletePort,
  type TacticalTeamPort,
} from './TeamTacticsSystem';

class FakeAthlete implements TacticalAthletePort {
  readonly velocity = { x: 0, z: 0 };
  target = { x: 99, z: 99 };
  isAirborne = false;
  moveCalls = 0;
  moveAttempts = 0;
  failNextMove = false;
  readonly failOnAttempts = new Set<number>();

  constructor(
    readonly index: number,
    readonly pos: { x: number; z: number },
  ) {}

  moveTo(x: number, z: number): void {
    this.moveAttempts++;
    if (this.failNextMove || this.failOnAttempts.has(this.moveAttempts)) {
      this.failNextMove = false;
      throw new Error(`falha moveTo ${this.index}`);
    }
    this.target = { x, z };
    this.moveCalls++;
  }
}

interface FakeTeam extends TacticalTeamPort {
  readonly athletes: FakeAthlete[];
}

function fakeTeam(side = TeamSide.HOME): FakeTeam {
  const athletes = BASE_SLOTS.map(
    (base, index) => new FakeAthlete(index, { ...fromLocalCourt(base, side) }),
  );
  return {
    side,
    slots: [0, 1, 2, 3, 4, 5],
    athletes,
    slotPos: (slot) => fromLocalCourt(BASE_SLOTS[slot], side),
  };
}

describe('TeamTacticsSystem', () => {
  it('aplica a formação somente às cinco atletas off-ball', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();
    const plan = system.coordinate({
      team,
      phase: 'reception',
      planId: 10,
      activeAthleteId: 1,
      contactPoint: { x: -5.8, z: 1.2 },
    });

    expect(plan.revision).toBe(1);
    expect(team.athletes[1].moveCalls).toBe(0);
    expect(team.athletes.filter((athlete) => athlete.moveCalls === 1)).toHaveLength(5);
  });

  it('reconcilia no mesmo planId a atleta liberada e a nova controlada', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();
    system.coordinate({
      team,
      phase: 'reception',
      planId: 11,
      activeAthleteId: 1,
      contactPoint: { x: -5.8, z: 1.2 },
    });
    const oldCalls = team.athletes[1].moveCalls;
    const newCalls = team.athletes[2].moveCalls;

    const revised = system.coordinate({
      team,
      phase: 'reception',
      planId: 11,
      activeAthleteId: 2,
      contactPoint: { x: -5.8, z: 1.2 },
    });

    expect(revised.revision).toBe(2);
    expect(team.athletes[1].moveCalls).toBe(oldCalls + 1);
    expect(team.athletes[2].moveCalls).toBe(newCalls);
    expect(revised.assignments.find((assignment) => assignment.role === 'active')?.athleteId).toBe(
      2,
    );
  });

  it('respeita reservas adicionais de writers de prioridade maior', () => {
    const team = fakeTeam();
    new TeamTacticsSystem().coordinate({
      team,
      phase: 'reception',
      planId: 12,
      activeAthleteId: 1,
      contactPoint: { x: -5.8, z: 1.2 },
      reservedAthleteIds: [3, 4],
    });

    expect(team.athletes[1].moveCalls).toBe(0);
    expect(team.athletes[3].moveCalls).toBe(0);
    expect(team.athletes[4].moveCalls).toBe(0);
    expect(team.athletes.filter((athlete) => athlete.moveCalls === 1)).toHaveLength(3);
  });

  it('segura todas na posição atual ao encerrar o ponto e expõe snapshot congelado', () => {
    const team = fakeTeam();
    team.athletes[0].pos.x += 0.75;
    const system = new TeamTacticsSystem();
    const held = system.hold(team);

    expect(held.phase).toBe('hold');
    expect(team.athletes.every((athlete) => athlete.target.x === athlete.pos.x)).toBe(true);
    expect(team.athletes.every((athlete) => athlete.target.z === athlete.pos.z)).toBe(true);
    expect(system.snapshot(TeamSide.HOME)).toBe(held);
    expect(Object.isFrozen(held)).toBe(true);
    expect(Object.isFrozen(held.assignments)).toBe(true);
  });

  it('mantém revisões independentes por lado e reinicia explicitamente', () => {
    const home = fakeTeam(TeamSide.HOME);
    const away = fakeTeam(TeamSide.AWAY);
    const system = new TeamTacticsSystem();

    expect(system.coordinate({ team: home, phase: 'base' }).revision).toBe(1);
    expect(system.coordinate({ team: home, phase: 'recompose' }).revision).toBe(2);
    expect(system.coordinate({ team: away, phase: 'base' }).revision).toBe(1);
    system.reset();
    expect(system.snapshot(TeamSide.HOME)).toBeNull();
    expect(system.coordinate({ team: home, phase: 'base' }).revision).toBe(1);
  });

  it('não consome revisão quando o planner rejeita a solicitação', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();

    expect(() => system.coordinate({ team, phase: 'offense-transition' })).toThrow(
      /não implementada/i,
    );
    expect(system.coordinate({ team, phase: 'base' }).revision).toBe(1);
  });

  it('é idempotente para o mesmo evento tático', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();
    const request = {
      team,
      phase: 'reception' as const,
      planId: 20,
      activeAthleteId: 1,
      contactPoint: { x: -5.8, z: 0.8 },
    };
    const first = system.coordinate(request);
    const calls = team.athletes.map((athlete) => athlete.moveCalls);
    const repeated = system.coordinate(request);

    expect(repeated).toBe(first);
    expect(repeated.revision).toBe(1);
    expect(team.athletes.map((athlete) => athlete.moveCalls)).toEqual(calls);
  });

  it('rejeita reserva desconhecida antes de qualquer aplicação', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();

    expect(() => system.coordinate({ team, phase: 'base', reservedAthleteIds: [99] })).toThrow(
      /reserva tática 99 ausente/i,
    );
    expect(team.athletes.every((athlete) => athlete.moveCalls === 0)).toBe(true);
    expect(system.snapshot(TeamSide.HOME)).toBeNull();
  });

  it('reverte targets e não publica revisão se um writer falha', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();
    const previous = team.athletes.map((athlete) => ({ ...athlete.target }));
    team.athletes[2].failNextMove = true;

    expect(() => system.coordinate({ team, phase: 'base' })).toThrow(/falha moveTo 2/i);
    expect(team.athletes.map((athlete) => athlete.target)).toEqual(previous);
    expect(system.snapshot(TeamSide.HOME)).toBeNull();
    expect(system.coordinate({ team, phase: 'base' }).revision).toBe(1);
  });

  it('continua o rollback e preserva o erro original se uma restauração falha', () => {
    const team = fakeTeam();
    const system = new TeamTacticsSystem();
    const previous = team.athletes.map((athlete) => ({ ...athlete.target }));
    team.athletes[0].failOnAttempts.add(2);
    team.athletes[2].failNextMove = true;

    expect(() => system.coordinate({ team, phase: 'base' })).toThrow(/falha moveTo 2/i);
    expect(team.athletes[1].target).toEqual(previous[1]);
    expect(system.snapshot(TeamSide.HOME)).toBeNull();
  });
});
