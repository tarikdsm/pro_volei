import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TeamSide } from '../core/constants';
import { RandomHub } from '../core/random';
import type { ControlFrame } from './control/ControlFrame';
import { Match } from './Match';
import { Team } from './Team';
import { HeadlessBall } from './simulation/HeadlessBall';
import { createHeadlessCharacter, HeadlessCharacter } from './simulation/HeadlessCharacter';
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

describe('Match headless AI × AI', () => {
  it('constrói e atravessa o saque em Node sem DOM, canvas ou WebGL', () => {
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.window).toBeUndefined();
    const hooks = createHeadlessHooks();
    const ball = new HeadlessBall();
    const random = new RandomHub(0x20_26_07_12);
    const teamFactoryCalls: TeamSide[] = [];
    const match = new Match(hooks, {
      ball,
      charFactory: createHeadlessCharacter,
      teamFactory: (side, makeChar) => {
        teamFactoryCalls.push(side);
        return new Team(side, makeChar);
      },
      humanSide: null,
      random,
    });

    match.startMatch(1, 0);
    const visited = new Set<string>([match.state]);
    for (let tick = 1; tick <= 7_200 && match.score[0] + match.score[1] === 0; tick++) {
      match.update(1 / 60, neutralFrame(tick));
      visited.add(match.state);
    }

    expect(teamFactoryCalls).toEqual([TeamSide.HOME, TeamSide.AWAY]);
    expect(visited.has('rally')).toBe(true);
    expect(match.score[0] + match.score[1]).toBe(1);
    expect(hooks.lastScore).not.toBeNull();
    expect(match.ball).toBe(ball);
    expect([...match.home.athletes, ...match.away.athletes]).toHaveLength(12);
    expect(
      [...match.home.athletes, ...match.away.athletes].every(
        (athlete) => athlete.char instanceof HeadlessCharacter,
      ),
    ).toBe(true);
    expect(match.actionSnapshot().status).toBe('idle');
    const visualNodes: THREE.Object3D[] = [];
    match.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) visualNodes.push(object);
    });
    expect(visualNodes).toHaveLength(0);
    expect(
      random.snapshot().streams.find((stream) => stream.name === 'control')?.random.draws,
    ).toBe(0);
  });

  it('não instancia a bola visual quando um port headless é fornecido', () => {
    const ball = new HeadlessBall();
    const match = new Match(createHeadlessHooks(), {
      ball,
      charFactory: createHeadlessCharacter,
      humanSide: null,
    });

    expect(match.ball).toBe(ball);
    expect(match.group.children).toContain(ball.group);
  });

  it('isola falhas do observador de telemetria do resultado da simulação', () => {
    const match = new Match(createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random: new RandomHub(77),
      telemetry: {
        emit: () => {
          throw new Error('observador indisponível');
        },
      },
    });

    match.startMatch(1, 0);
    expect(() => {
      for (let tick = 1; tick <= 7_200 && match.score[0] + match.score[1] === 0; tick++) {
        match.update(1 / 60, neutralFrame(tick));
      }
    }).not.toThrow();
    expect(match.score[0] + match.score[1]).toBe(1);
  });
});
