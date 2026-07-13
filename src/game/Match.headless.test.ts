import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TeamSide } from '../core/constants';
import { RandomHub } from '../core/random';
import type { ControlFrame } from './control/ControlFrame';
import { Match } from './Match';
import { Team } from './Team';
import { HeadlessBall } from './simulation/HeadlessBall';
import { createHeadlessCharacter, HeadlessCharacter } from './simulation/HeadlessCharacter';
import { createHeadlessHooks } from './simulation/HeadlessHooks';
import {
  MatchStrategyBridge,
  type MatchStrategyBallContact,
  type MatchStrategyPoint,
  type MatchStrategyPort,
  type MatchStrategyServeFacts,
  type MatchStrategyTickSource,
} from './strategy/MatchStrategyBridge';
import type {
  ServeCommitmentRef,
  ServeEpochToken,
  StrategicServeRealization,
} from './strategy/StrategicServeSystem';
import type { StrategyDifficulty, StrategyMemorySnapshot } from './strategy/StrategyTypes';

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

class RecordingStrategy implements MatchStrategyPort {
  matchEpoch = 0;
  private serveEpoch = 0;
  private rallyEpoch = 0;
  lastCaptureTick = 0;
  readonly captures: MatchStrategyTickSource[] = [];
  readonly begins: ServeEpochToken[] = [];
  readonly commits: { token: ServeEpochToken; difficulty: StrategyDifficulty; tick: number }[] = [];
  readonly launchTicks: number[] = [];
  readonly contacts: MatchStrategyBallContact[] = [];
  readonly points: MatchStrategyPoint[] = [];
  onCapture?: () => void;

  startMatch(): void {
    this.matchEpoch++;
  }

  startSet(): void {}

  beginOffenseRally: MatchStrategyPort['beginOffenseRally'] = () =>
    Object.freeze({ matchEpoch: this.matchEpoch, rallyEpoch: ++this.rallyEpoch });
  endOffenseRally: MatchStrategyPort['endOffenseRally'] = () => {};
  observeOffenseContact: MatchStrategyPort['observeOffenseContact'] = () =>
    Object.freeze({ status: 'stale' });
  prepareOffenseSet: MatchStrategyPort['prepareOffenseSet'] = () =>
    Object.freeze({ status: 'stale' });
  bindOffenseSet: MatchStrategyPort['bindOffenseSet'] = () => Object.freeze({ status: 'stale' });
  consumeOffenseSet: MatchStrategyPort['consumeOffenseSet'] = () =>
    Object.freeze({ status: 'stale' });
  prepareOffenseAttack: MatchStrategyPort['prepareOffenseAttack'] = () =>
    Object.freeze({ status: 'stale' });
  bindOffenseAttack: MatchStrategyPort['bindOffenseAttack'] = () =>
    Object.freeze({ status: 'stale' });
  consumeOffenseAttack: MatchStrategyPort['consumeOffenseAttack'] = () =>
    Object.freeze({ status: 'stale' });
  resolveOffenseBlock: MatchStrategyPort['resolveOffenseBlock'] = () => false;
  resolveOffenseDefense: MatchStrategyPort['resolveOffenseDefense'] = () => false;
  resolveOffensePoint: MatchStrategyPort['resolveOffensePoint'] = () => false;

  captureTick(source: MatchStrategyTickSource): void {
    this.lastCaptureTick = source.tick;
    this.captures.push(source);
    this.onCapture?.();
  }

  beginServe(side: TeamSide, serverAthleteId: number): ServeEpochToken {
    const token = Object.freeze({
      matchEpoch: this.matchEpoch,
      serveEpoch: ++this.serveEpoch,
      side,
      serverAthleteId,
    });
    this.begins.push(token);
    return token;
  }

  commitServe(token: ServeEpochToken, difficulty: StrategyDifficulty, tick: number) {
    this.commits.push({ token, difficulty, tick });
    const ref = Object.freeze({
      ...token,
      decisionId: `serve:${token.matchEpoch}:${token.serveEpoch}`,
      optionId: 'serve.float-deep.center' as const,
    });
    return Object.freeze({
      status: 'committed' as const,
      directive: Object.freeze({
        ref,
        family: 'float-deep' as const,
        target: Object.freeze({ x: token.side === TeamSide.HOME ? 7 : -7, z: 0 }),
      }),
    });
  }

  guardServe(
    ref: ServeCommitmentRef,
    _stage: 'toss' | 'hit',
    facts: MatchStrategyServeFacts,
  ): boolean {
    return (
      ref.matchEpoch === this.matchEpoch &&
      facts.phase === 'serve-prep' &&
      facts.servingSide === ref.side &&
      facts.serverAthleteId === ref.serverAthleteId
    );
  }

  markServeLaunched(ref: ServeCommitmentRef, realization: StrategicServeRealization) {
    this.launchTicks.push(this.lastCaptureTick);
    return Object.freeze({
      status: 'launched' as const,
      serve: Object.freeze({
        ref,
        outcomeToken: Object.freeze({ matchEpoch: ref.matchEpoch, serveEpoch: ref.serveEpoch }),
        family: 'float-deep' as const,
        target: realization.target,
        power: realization.power,
        clearance: realization.clearance,
        stage: 'in-flight' as const,
      }),
    });
  }

  onBallContact(contact: MatchStrategyBallContact): boolean {
    this.contacts.push(contact);
    return false;
  }

  onPoint(point: MatchStrategyPoint): boolean {
    this.points.push(point);
    return false;
  }

  memory(_side: TeamSide): StrategyMemorySnapshot {
    return Object.freeze({
      revision: 0,
      outcomes: Object.freeze([]),
      recentChoices: Object.freeze([]),
    });
  }

  flush(): void {}
}

function seedServing(side: TeamSide): number {
  for (let seed = 0; seed < 1_000; seed++) {
    const probe = new RandomHub(seed);
    const serving = probe.stream('rules').chance(0.5) ? TeamSide.HOME : TeamSide.AWAY;
    if (serving === side) return seed;
  }
  throw new Error('seed de saque não encontrada');
}

describe('Match headless AI × AI', () => {
  it('captura observação antes do fixed-step e usa a ordem real dos slots', () => {
    const order: string[] = [];
    const strategy = new RecordingStrategy();
    strategy.onCapture = () => order.push('capture');
    const ball = new HeadlessBall();
    const beginFixedStep = ball.beginFixedStep.bind(ball);
    vi.spyOn(ball, 'beginFixedStep').mockImplementation(() => {
      order.push('ball-begin');
      beginFixedStep();
    });
    const match = new Match(createHeadlessHooks(), {
      ball,
      charFactory: createHeadlessCharacter,
      humanSide: TeamSide.HOME,
      random: new RandomHub(seedServing(TeamSide.HOME)),
      strategy,
    });
    match.startMatch(1, 0);
    match.home.rotate();
    const expectedSlots = [...match.home.slots];

    match.update(1 / 60, neutralFrame(1));

    expect(order.slice(0, 2)).toEqual(['capture', 'ball-begin']);
    const home = strategy.captures[0].athletes.filter((athlete) => athlete.side === TeamSide.HOME);
    expect(home.map((athlete) => athlete.id)).toEqual(expectedSlots);
    expect(home.map((athlete) => athlete.slot)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('compromete antes do toss e mantém cue físico de ao menos 24 ticks', () => {
    const strategy = new RecordingStrategy();
    const match = new Match(createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random: new RandomHub(91),
      strategy,
    });
    match.startMatch(2, 0);

    for (let tick = 1; tick <= 300 && match.state !== 'rally'; tick++) {
      match.update(1 / 60, neutralFrame(tick));
    }

    expect(strategy.commits).toHaveLength(1);
    expect(strategy.launchTicks).toHaveLength(1);
    expect(strategy.launchTicks[0] - strategy.commits[0].tick).toBeGreaterThanOrEqual(24);
    expect(strategy.contacts[0]).toMatchObject({
      side: strategy.commits[0].token.side,
      outcomeToken: {
        matchEpoch: strategy.commits[0].token.matchEpoch,
        serveEpoch: strategy.commits[0].token.serveEpoch,
      },
      ballAfter: { inFlight: true },
    });
  });

  it('novo startMatch invalida o callback de saque anterior sem commit tardio', () => {
    const strategy = new RecordingStrategy();
    const match = new Match(createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random: new RandomHub(12),
      strategy,
    });
    match.startMatch(1, 0);
    const stale = strategy.begins[0];
    match.startMatch(1, 0);
    const current = strategy.begins[1];

    for (let tick = 1; tick <= 300 && strategy.commits.length === 0; tick++) {
      match.update(1 / 60, neutralFrame(tick));
    }

    expect(strategy.matchEpoch).toBe(2);
    expect(strategy.commits.map((commit) => commit.token)).toEqual([current]);
    expect(strategy.commits.some((commit) => commit.token === stale)).toBe(false);
  });

  it('saque humano abre epoch, mas consome zero draw estratégico e zero draw temporal', () => {
    const random = new RandomHub(seedServing(TeamSide.HOME));
    const match = new Match(createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: TeamSide.HOME,
      random,
    });
    match.startMatch(1, 0);
    for (let tick = 1; tick <= 180; tick++) match.update(1 / 60, neutralFrame(tick));

    const streams = random.snapshot().streams;
    expect(streams.find((stream) => stream.name === 'strategy.home')?.random.draws).toBe(0);
    expect(streams.find((stream) => stream.name === 'strategy.away')?.random.draws).toBe(0);
    expect(streams.find((stream) => stream.name === 'ai')?.random.draws).toBe(0);
    expect(match.state).toBe('servePrep');
  });

  it('primeiro saque da CPU usa +2 só no lado sacador e um único draw temporal', () => {
    const random = new RandomHub(0x3c2);
    const match = new Match(createHeadlessHooks(), {
      ball: new HeadlessBall(),
      charFactory: createHeadlessCharacter,
      humanSide: null,
      random,
    });
    match.startMatch(2, 0);
    const serving = match.servingTeam;
    for (let tick = 1; tick <= 300 && match.state !== 'rally'; tick++) {
      match.update(1 / 60, neutralFrame(tick));
    }

    const streams = random.snapshot().streams;
    const ownName = serving === TeamSide.HOME ? 'strategy.home' : 'strategy.away';
    const rivalName = serving === TeamSide.HOME ? 'strategy.away' : 'strategy.home';
    expect(streams.find((stream) => stream.name === ownName)?.random.draws).toBe(2);
    expect(streams.find((stream) => stream.name === rivalName)?.random.draws).toBe(0);
    expect(streams.find((stream) => stream.name === 'ai')?.random.draws).toBe(1);
    expect(match.state).toBe('rally');
  });

  it('fecha o outcome do saque uma vez e independe de telemetria ausente ou falha', () => {
    const run = (failingTelemetry: boolean) => {
      const random = new RandomHub(0x51_ae);
      const bridge = new MatchStrategyBridge({
        home: random.stream('strategy.home'),
        away: random.stream('strategy.away'),
      });
      const match = new Match(createHeadlessHooks(), {
        ball: new HeadlessBall(),
        charFactory: createHeadlessCharacter,
        humanSide: null,
        random,
        strategy: bridge,
        telemetry: failingTelemetry
          ? {
              emit: () => {
                throw new Error('telemetria offline');
              },
            }
          : undefined,
      });
      match.startMatch(1, 0);
      const serving = match.servingTeam;
      for (let tick = 1; tick <= 7_200 && match.score[0] + match.score[1] === 0; tick++) {
        match.update(1 / 60, neutralFrame(tick));
      }
      return {
        score: [...match.score],
        memory: bridge.memory(serving),
        random: random.snapshot(),
      };
    };

    const withoutTelemetry = run(false);
    const failedTelemetry = run(true);
    expect(withoutTelemetry.memory.outcomes).toHaveLength(1);
    expect(failedTelemetry.memory).toEqual(withoutTelemetry.memory);
    expect(failedTelemetry.score).toEqual(withoutTelemetry.score);
    expect(failedTelemetry.random).toEqual(withoutTelemetry.random);
  });

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
