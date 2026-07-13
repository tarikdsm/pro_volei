import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTIES, TeamSide } from '../../core/constants';
import { RandomHub } from '../../core/random';
import { RallyState } from '../RallyState';
import { Team } from '../Team';
import type { MechanicsCtx } from '../mechanics/context';
import { HeadlessBall } from '../simulation/HeadlessBall';
import { createHeadlessCharacter } from '../simulation/HeadlessCharacter';
import { createHeadlessHooks } from '../simulation/HeadlessHooks';
import {
  MatchStrategyCoordinator,
  type MatchStrategyCoordinatorRuntime,
  type MatchStrategyState,
} from './MatchStrategyCoordinator';
import type {
  MatchStrategyBallContact,
  MatchStrategyPoint,
  MatchStrategyPort,
  MatchStrategyServeFacts,
  MatchStrategyTickSource,
} from './MatchStrategyBridge';
import type {
  ServeCommitmentRef,
  ServeEpochToken,
  StrategicServeRealization,
} from './StrategicServeSystem';
import type { StrategyDifficulty, StrategyMemorySnapshot } from './StrategyTypes';

class RecordingPort implements MatchStrategyPort {
  matchEpoch = 0;
  serveEpoch = 0;
  rallyEpoch = 0;
  notReady = 0;
  contactResult = false;
  pointResult = false;
  startMatchCalls = 0;
  startSetCalls = 0;
  flushCalls = 0;
  readonly captures: MatchStrategyTickSource[] = [];
  readonly begins: ServeEpochToken[] = [];
  readonly commits: ServeEpochToken[] = [];
  readonly guards: { stage: 'toss' | 'hit'; facts: MatchStrategyServeFacts }[] = [];
  readonly launches: StrategicServeRealization[] = [];
  readonly contacts: MatchStrategyBallContact[] = [];
  readonly points: MatchStrategyPoint[] = [];

  startMatch(): void {
    this.startMatchCalls++;
    this.matchEpoch++;
  }

  startSet(): void {
    this.startSetCalls++;
  }

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
    this.captures.push(source);
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

  commitServe(token: ServeEpochToken, _difficulty: StrategyDifficulty, _tick: number) {
    this.commits.push(token);
    if (this.notReady-- > 0) return Object.freeze({ status: 'not-ready' as const });
    return Object.freeze({
      status: 'committed' as const,
      directive: Object.freeze({
        ref: Object.freeze({
          ...token,
          decisionId: `serve:${token.matchEpoch}:${token.serveEpoch}`,
          optionId: 'serve.float-deep.center' as const,
        }),
        family: 'float-deep' as const,
        target: Object.freeze({ x: token.side === TeamSide.HOME ? 7 : -7, z: 0 }),
      }),
    });
  }

  guardServe(
    _ref: ServeCommitmentRef,
    stage: 'toss' | 'hit',
    facts: MatchStrategyServeFacts,
  ): boolean {
    this.guards.push({ stage, facts });
    return true;
  }

  markServeLaunched(ref: ServeCommitmentRef, realization: StrategicServeRealization) {
    this.launches.push(realization);
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
    return this.contactResult;
  }

  onPoint(point: MatchStrategyPoint): boolean {
    this.points.push(point);
    return this.pointResult;
  }

  memory(_side: TeamSide): StrategyMemorySnapshot {
    return Object.freeze({
      revision: 0,
      outcomes: Object.freeze([]),
      recentChoices: Object.freeze([]),
    });
  }

  flush(): void {
    this.flushCalls++;
  }
}

function fixture() {
  const port = new RecordingPort();
  const ball = new HeadlessBall();
  const rally = new RallyState();
  const home = new Team(TeamSide.HOME, createHeadlessCharacter);
  const away = new Team(TeamSide.AWAY, createHeadlessCharacter);
  const random = new RandomHub(0x3c2);
  const scheduled: { seconds: number; fn: () => void }[] = [];
  let tick = 12;
  let state: MatchStrategyState = 'servePrep';
  let serving = TeamSide.HOME;
  let difficulty: StrategyDifficulty = 1;
  let score: readonly [number, number] = [3, 2];
  const hooks = createHeadlessHooks();
  const mechanics = {
    ball,
    rally,
    hooks,
    diff: DIFFICULTIES[1],
    servingTeam: serving,
    aim: new THREE.Vector3(),
    chosenZone: 1,
    stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] },
    random: {
      rules: random.stream('rules'),
      ai: random.stream('ai'),
      contact: random.stream('contact'),
      control: random.stream('control'),
    },
    emitTelemetry: vi.fn(),
    onBallContact: vi.fn(),
    isHumanSide: () => false,
    teamOf: (side: TeamSide) => (side === TeamSide.HOME ? home : away),
    after: (seconds: number, fn: () => void) => scheduled.push({ seconds, fn }),
    planNext: vi.fn(),
    startRally: vi.fn(() => {
      state = 'rally';
    }),
  } as MechanicsCtx;
  const runtime: MatchStrategyCoordinatorRuntime = {
    ball,
    rally,
    home,
    away,
    tick: () => tick,
    state: () => state,
    score: () => score,
    serving: () => serving,
    difficulty: () => difficulty,
    mechanics: () => mechanics,
    after: (seconds, fn) => scheduled.push({ seconds, fn }),
  };
  const coordinator = new MatchStrategyCoordinator(port, runtime);
  return {
    port,
    ball,
    rally,
    home,
    away,
    random,
    scheduled,
    mechanics,
    coordinator,
    setTick: (value: number) => {
      tick = value;
    },
    setState: (value: MatchStrategyState) => {
      state = value;
    },
    setServing: (value: TeamSide) => {
      serving = value;
      mechanics.servingTeam = value;
    },
    setDifficulty: (value: StrategyDifficulty) => {
      difficulty = value;
    },
    setScore: (value: readonly [number, number]) => {
      score = value;
    },
  };
}

describe('MatchStrategyCoordinator', () => {
  it('captura somente o DTO público com phase e slots atuais', () => {
    const sample = fixture();
    sample.home.rotate();
    const expectedIds = [...sample.home.slots];

    sample.coordinator.captureTick();

    expect(sample.port.captures).toHaveLength(1);
    expect(sample.port.captures[0]).toMatchObject({
      tick: 12,
      score: [3, 2],
      phase: 'serve-prep',
      servingSide: TeamSide.HOME,
    });
    const home = sample.port.captures[0].athletes.filter(
      (athlete) => athlete.side === TeamSide.HOME,
    );
    expect(home.map((athlete) => athlete.id)).toEqual(expectedIds);
    expect(home.map((athlete) => athlete.slot)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('encaminha lifecycle de partida, set, flush e todo saque inclusive humano', () => {
    const sample = fixture();
    const server = sample.home.server();

    sample.coordinator.startMatch();
    sample.coordinator.startSet();
    sample.coordinator.beginServe(TeamSide.HOME, server, false);
    sample.coordinator.flush();

    expect(sample.port.startMatchCalls).toBe(1);
    expect(sample.port.startSetCalls).toBe(1);
    expect(sample.port.begins).toHaveLength(1);
    expect(sample.port.begins[0].serverAthleteId).toBe(server.index);
    expect(sample.scheduled).toEqual([]);
    expect(sample.port.flushCalls).toBe(1);
  });

  it('saca pela CPU com um draw temporal e retry fixo sem draw adicional', () => {
    const sample = fixture();
    sample.coordinator.startMatch();
    sample.port.notReady = 1;
    const launch = vi.spyOn(sample.ball, 'launch');

    sample.coordinator.beginServe(TeamSide.HOME, sample.home.server(), true);

    expect(
      sample.random.snapshot().streams.find((entry) => entry.name === 'ai')?.random.draws,
    ).toBe(1);
    expect(sample.scheduled).toHaveLength(1);
    expect(sample.scheduled[0].seconds).toBeGreaterThanOrEqual(1.4);
    expect(sample.scheduled[0].seconds).toBeLessThanOrEqual(2.4);

    sample.scheduled.shift()!.fn();
    expect(sample.port.commits).toHaveLength(1);
    expect(sample.scheduled[0].seconds).toBe(1 / 60);
    sample.scheduled.shift()!.fn();

    expect(sample.port.commits).toHaveLength(2);
    expect(
      sample.random.snapshot().streams.find((entry) => entry.name === 'ai')?.random.draws,
    ).toBe(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(sample.scheduled.map((entry) => entry.seconds)).toEqual([0.34, 0.42]);
    sample.scheduled.shift()!.fn();
    sample.scheduled.shift()!.fn();

    expect(sample.port.launches).toHaveLength(1);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(sample.rally.serveOutcomeToken).toEqual({ matchEpoch: 1, serveEpoch: 1 });
    expect(sample.port.guards.map((guard) => guard.stage)).toEqual(['toss', 'hit', 'hit']);
  });

  it('descarta callback CPU stale antes do commit', () => {
    const sample = fixture();
    sample.coordinator.startMatch();
    sample.coordinator.beginServe(TeamSide.HOME, sample.home.server(), true);
    sample.setState('point');

    sample.scheduled.shift()!.fn();

    expect(sample.port.commits).toEqual([]);
  });

  it('traduz contato pós-lançamento com setter real e limpa outcome resolvido', () => {
    const sample = fixture();
    sample.coordinator.startMatch();
    const setter = sample.away.athletes[4];
    setter.warpTo(2.5, -0.7);
    sample.rally.setterHold = setter;
    sample.rally.serveOutcomeToken = { matchEpoch: 1, serveEpoch: 8 };
    sample.ball.launch(new THREE.Vector3(4, 1.1, 0), new THREE.Vector3(-3, 5, 1));
    sample.port.contactResult = true;

    sample.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'pass',
      athleteId: 1,
      outcomeToken: sample.rally.serveOutcomeToken,
    });

    expect(sample.port.contacts[0]).toMatchObject({
      matchEpoch: 1,
      tick: 12,
      side: TeamSide.AWAY,
      ballAfter: { inFlight: true },
      setterPosition: { x: 2.5, z: -0.7 },
    });
    expect(sample.rally.serveOutcomeToken).toBeNull();
  });

  it('encaminha ponto com o lado sacador recebido e limpa outcome resolvido', () => {
    const sample = fixture();
    sample.rally.serveOutcomeToken = { matchEpoch: 3, serveEpoch: 4 };
    sample.port.pointResult = true;

    sample.coordinator.onPoint({
      servingSide: TeamSide.AWAY,
      winner: TeamSide.HOME,
      ace: false,
      cause: 'floor-in',
    });

    expect(sample.port.points).toEqual([
      {
        outcomeToken: { matchEpoch: 3, serveEpoch: 4 },
        servingSide: TeamSide.AWAY,
        winner: TeamSide.HOME,
        ace: false,
      },
    ]);
    expect(sample.rally.serveOutcomeToken).toBeNull();
  });
});
