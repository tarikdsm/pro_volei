import { describe, expect, it } from 'vitest';
import { TeamSide } from '../core/constants';
import { RandomHub } from '../core/random';
import type { ControlFrame } from './control/ControlFrame';
import { Match } from './Match';
import { HeadlessBall } from './simulation/HeadlessBall';
import { createHeadlessCharacter } from './simulation/HeadlessCharacter';
import { createHeadlessHooks } from './simulation/HeadlessHooks';

function neutralFrame(tick: number): ControlFrame {
  return {
    simulationTick: tick,
    sampledAtMs: tick * (1_000 / 60),
    screenAxis: { right: 0, up: 0 },
    courtAxis: { x: 0, z: 0 },
    actionDown: false,
    actionEdges: [],
    cancellations: [],
  };
}

function headlessMatch(humanSide: TeamSide.HOME | null): Match {
  return new Match(createHeadlessHooks(), {
    ball: new HeadlessBall(),
    charFactory: createHeadlessCharacter,
    humanSide,
    random: new RandomHub(0x3b),
  });
}

describe('Match + TeamTacticsSystem', () => {
  it('coordena cinco companheiras após a seleção humana inicial', () => {
    const match = headlessMatch(TeamSide.HOME);
    match.debugAutoSelectionScenario();

    const plan = match.teamTacticsSnapshot(TeamSide.HOME);
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({ phase: 'reception', planId: 1 });
    expect(plan?.assignments.find((assignment) => assignment.role === 'active')?.athleteId).toBe(1);
    const active = match.home.athletes[1];
    expect(active.target.x).toBe(active.pos.x);
    expect(active.target.z).toBe(active.pos.z);
    expect(
      match.home.athletes.filter(
        (athlete) => athlete.index !== active.index && !athlete.target.equals(athlete.pos),
      ),
    ).toHaveLength(5);
  });

  it('move off-ball no AI × AI e segura targets no fim do ponto', () => {
    const match = headlessMatch(null);
    match.startMatch(1, 0);
    let sawReception = false;
    let sawTransition = false;
    let sawAttackCoverage = false;
    let tick = 1;

    for (; tick <= 7_200 && match.state !== 'point'; tick++) {
      match.update(1 / 60, neutralFrame(tick));
      const home = match.teamTacticsSnapshot(TeamSide.HOME);
      const away = match.teamTacticsSnapshot(TeamSide.AWAY);
      sawReception ||= home?.phase === 'reception' || away?.phase === 'reception';
      sawTransition ||=
        home?.phase === 'offense-transition' || away?.phase === 'offense-transition';
      sawAttackCoverage ||= home?.phase === 'attack-coverage' || away?.phase === 'attack-coverage';
    }

    expect(sawReception).toBe(true);
    expect(sawTransition).toBe(true);
    expect(match.state).toBe('point');
    expect(match.teamTacticsSnapshot(TeamSide.HOME)?.phase).toBe('hold');
    expect(match.teamTacticsSnapshot(TeamSide.AWAY)?.phase).toBe('hold');
    for (const athlete of [...match.home.athletes, ...match.away.athletes]) {
      expect(athlete.target.x).toBeCloseTo(athlete.pos.x, 8);
      expect(athlete.target.z).toBeCloseTo(athlete.pos.z, 8);
    }

    for (; tick <= 7_500 && match.state === 'point'; tick++) {
      match.update(1 / 60, neutralFrame(tick));
    }
    expect(match.state).toBe('servePrep');
    expect(match.teamTacticsSnapshot(match.servingTeam)?.phase).toBe('serve-formation');
    expect(
      match.teamTacticsSnapshot(match.servingTeam === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME)
        ?.phase,
    ).toBe('recompose');
    const server = match.servingTeam === TeamSide.HOME ? match.home.server() : match.away.server();
    const serverAssignment = match
      .teamTacticsSnapshot(match.servingTeam)
      ?.assignments.find((assignment) => assignment.role === 'server');
    expect(serverAssignment?.athleteId).toBe(server.index);
    expect(serverAssignment?.target.x).toBeCloseTo(server.pos.x, 8);
    expect(serverAssignment?.target.z).toBeCloseTo(server.pos.z, 8);

    for (; tick <= 60_000 && !sawAttackCoverage; tick++) {
      match.update(1 / 60, neutralFrame(tick));
      sawAttackCoverage =
        match.teamTacticsSnapshot(TeamSide.HOME)?.phase === 'attack-coverage' ||
        match.teamTacticsSnapshot(TeamSide.AWAY)?.phase === 'attack-coverage';
    }
    expect(sawAttackCoverage).toBe(true);
  });
});
