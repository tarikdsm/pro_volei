import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTIES, TeamSide } from '../../core/constants';
import { RandomHub } from '../../core/random';
import { RallyState, type TouchPlan } from '../RallyState';
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
import type { AttackDecisionDraft, BoundAttackCommitment } from './StrategicAttackTypes';
import type {
  BoundSetCommitment,
  OffenseRallyRef,
  SetDecisionDraft,
} from './StrategicOffenseSystem';
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
  readonly offenseEvents: string[] = [];
  readonly offenseContacts: Parameters<MatchStrategyPort['observeOffenseContact']>[1][] = [];
  prepareSetterId: number | null = null;
  prepareAttackerId: number | null = null;
  private possessionEpoch = 0;
  private currentRally?: OffenseRallyRef;
  private currentSetDraft?: SetDecisionDraft;
  private boundSet?: BoundSetCommitment;
  private currentAttackDraft?: AttackDecisionDraft;
  private boundAttack?: BoundAttackCommitment;

  startMatch(): void {
    this.startMatchCalls++;
    this.matchEpoch++;
  }

  startSet(): void {
    this.startSetCalls++;
  }

  beginOffenseRally: MatchStrategyPort['beginOffenseRally'] = () => {
    this.offenseEvents.push('begin-rally');
    return (this.currentRally = Object.freeze({
      matchEpoch: this.matchEpoch,
      rallyEpoch: ++this.rallyEpoch,
    }));
  };

  endOffenseRally: MatchStrategyPort['endOffenseRally'] = () => {
    this.offenseEvents.push('end-rally');
  };

  observeOffenseContact: MatchStrategyPort['observeOffenseContact'] = (
    _rally,
    source,
    possessionTouches,
  ) => {
    this.offenseEvents.push(`observe-${source.kind}`);
    this.offenseContacts.push(source);
    if (possessionTouches === 1) this.possessionEpoch++;
    return Object.freeze({
      status: 'observed' as const,
      contact: Object.freeze({
        matchEpoch: this.matchEpoch,
        rallyEpoch: this.currentRally?.rallyEpoch ?? 0,
        possessionEpoch: this.possessionEpoch,
        contactSequence: possessionTouches,
        side: source.side,
        tick: source.tick,
      }),
    });
  };

  prepareOffenseSet: MatchStrategyPort['prepareOffenseSet'] = (contact) => {
    this.offenseEvents.push('prepare-set');
    if (this.prepareSetterId === null) return Object.freeze({ status: 'stale' as const });
    this.currentSetDraft = Object.freeze({
      ref: contact,
      setterAthleteId: this.prepareSetterId,
      setterContact: Object.freeze({ x: 2, z: 0 }),
      leadTicks: 40,
      execution: Object.freeze({
        mode: 'fallback-high' as const,
        reason: 'perception-not-ready' as const,
        optionId: 'set.high-left' as const,
        family: 'high' as const,
        target: Object.freeze({ x: 1, z: 2 }),
        attackerAthleteId: this.prepareAttackerId ?? 3,
      }),
      plannedAttackerAthleteId: this.prepareAttackerId,
      plannedAttack: null,
    });
    return Object.freeze({ status: 'prepared' as const, draft: this.currentSetDraft });
  };

  bindOffenseSet: MatchStrategyPort['bindOffenseSet'] = (ref, plan) => {
    this.offenseEvents.push('bind-set');
    if (!this.currentSetDraft || this.currentSetDraft.ref !== ref) {
      return Object.freeze({ status: 'stale' as const });
    }
    this.boundSet = Object.freeze({
      ...plan,
      ref,
      decisionId: null,
      observationTick: null,
      draft: this.currentSetDraft,
    });
    return Object.freeze({ status: 'bound' as const, commitment: this.boundSet });
  };

  consumeOffenseSet: MatchStrategyPort['consumeOffenseSet'] = (commitment, plan) => {
    this.offenseEvents.push('consume-set');
    if (
      commitment !== this.boundSet ||
      plan.planId !== commitment.planId ||
      plan.tacticalRevision !== commitment.tacticalRevision ||
      plan.athleteId !== commitment.athleteId
    ) {
      return Object.freeze({ status: 'stale' as const });
    }
    return Object.freeze({ status: 'consumed' as const, execution: commitment.draft.execution });
  };

  prepareOffenseAttack: MatchStrategyPort['prepareOffenseAttack'] = (contact) => {
    this.offenseEvents.push('prepare-attack');
    if (this.prepareAttackerId === null || !this.boundSet) {
      return Object.freeze({ status: 'stale' as const });
    }
    this.currentAttackDraft = Object.freeze({
      basis: 'executed-set' as const,
      decisionContact: contact,
      executedSetContact: contact,
      originSetDecisionId: null,
      originSetPlanId: this.boundSet.planId,
      attackerAthleteId: this.prepareAttackerId,
      leadTicks: 28,
      deliveryEffectiveness: 0.8,
      execution: Object.freeze({
        mode: 'fallback-placed-seam' as const,
        reason: 'perception-not-ready' as const,
        optionId: 'attack.placed-seam' as const,
        family: 'placed' as const,
        target: Object.freeze({ x: -7, z: 0.5 }),
      }),
    });
    return Object.freeze({ status: 'prepared' as const, draft: this.currentAttackDraft });
  };

  bindOffenseAttack: MatchStrategyPort['bindOffenseAttack'] = (draft, plan) => {
    this.offenseEvents.push('bind-attack');
    if (draft !== this.currentAttackDraft) return Object.freeze({ status: 'stale' as const });
    this.boundAttack = Object.freeze({
      ...plan,
      draft,
      decisionId: null,
      observationTick: null,
    });
    return Object.freeze({ status: 'bound' as const, commitment: this.boundAttack });
  };

  consumeOffenseAttack: MatchStrategyPort['consumeOffenseAttack'] = (commitment, plan) => {
    this.offenseEvents.push('consume-attack');
    if (
      commitment !== this.boundAttack ||
      plan.planId !== commitment.planId ||
      plan.tacticalRevision !== commitment.tacticalRevision ||
      plan.athleteId !== commitment.athleteId
    ) {
      return Object.freeze({ status: 'stale' as const });
    }
    return Object.freeze({ status: 'consumed' as const, execution: commitment.draft.execution });
  };

  resolveOffenseBlock: MatchStrategyPort['resolveOffenseBlock'] = () => {
    this.offenseEvents.push('resolve-block');
    return true;
  };

  resolveOffenseDefense: MatchStrategyPort['resolveOffenseDefense'] = () => {
    this.offenseEvents.push('resolve-defense');
    return true;
  };

  resolveOffensePoint: MatchStrategyPort['resolveOffensePoint'] = () => {
    this.offenseEvents.push('resolve-point');
    return true;
  };

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
  function cpuPlan(
    sample: ReturnType<typeof fixture>,
    kind: 'set' | 'spike',
    athleteId: number,
    planId: number,
  ): TouchPlan {
    return {
      planId,
      side: TeamSide.AWAY,
      athlete: sample.away.athletes[athleteId],
      contactIn: 0.8,
      point: new THREE.Vector3(2, kind === 'set' ? 2.35 : 2.65, 0),
      kind,
      isHuman: false,
      tacticalRevision: 7,
      serveOutcomeToken: null,
      done: false,
    };
  }

  function prepareCpuSet(sample: ReturnType<typeof fixture>): TouchPlan {
    sample.coordinator.startMatch();
    sample.coordinator.beginRally();
    sample.port.prepareSetterId = 4;
    sample.port.prepareAttackerId = 3;
    sample.rally.countTouch(TeamSide.AWAY);
    sample.ball.launch(new THREE.Vector3(5, 1, 0), new THREE.Vector3(-4, 6, 0));
    sample.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'pass',
      athleteId: 1,
      outcomeToken: null,
    });
    const plan = cpuPlan(sample, 'set', 4, 21);
    sample.coordinator.bindCpuPlan(plan);
    return plan;
  }

  it('prepara levantadora CPU da leitura própria pós-contato e ignora o lado humano', () => {
    const sample = fixture();
    sample.mechanics.isHumanSide = (side) => side === TeamSide.HOME;
    sample.coordinator.startMatch();
    sample.coordinator.beginRally();
    sample.port.prepareSetterId = 4;
    sample.rally.countTouch(TeamSide.AWAY);
    sample.ball.launch(new THREE.Vector3(5, 1, 0), new THREE.Vector3(-4, 6, 0));

    sample.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'pass',
      athleteId: 1,
      outcomeToken: null,
    });

    expect(sample.port.offenseEvents).toEqual(['begin-rally', 'observe-pass', 'prepare-set']);
    expect(sample.coordinator.plannedCpuAthlete('set', TeamSide.AWAY)).toBe(4);
    expect(sample.rally.setterHold).toBe(sample.away.athletes[4]);
    expect(sample.port.offenseContacts[0].ownAthletes.map((athlete) => athlete.slot)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    sample.rally.countTouch(TeamSide.HOME);
    sample.coordinator.onBallContact({
      side: TeamSide.HOME,
      kind: 'pass',
      athleteId: 1,
      outcomeToken: null,
    });
    expect(sample.port.offenseContacts).toHaveLength(1);
  });

  it('vincula após a revisão tática e consome o set somente pela identidade exata', () => {
    const sample = fixture();
    const plan = prepareCpuSet(sample);

    const command = sample.coordinator.consumeCpuTouch(plan);

    expect(sample.port.offenseEvents.slice(-2)).toEqual(['bind-set', 'consume-set']);
    expect(command).toMatchObject({
      kind: 'set',
      execution: { mode: 'fallback-high', target: { x: 1, z: 2 } },
      attackerAthleteId: 3,
    });
    expect(sample.coordinator.consumeCpuTouch({ ...plan, tacticalRevision: 8 })).toBeNull();
  });

  it('recusa autoridade humana tardia e atleta de outro lado mesmo com flag CPU', () => {
    const humanized = fixture();
    const humanizedPlan = prepareCpuSet(humanized);
    humanized.mechanics.isHumanSide = (side) => side === TeamSide.AWAY;

    expect(humanized.coordinator.consumeCpuTouch(humanizedPlan)).toBeNull();

    const crossed = fixture();
    crossed.coordinator.startMatch();
    crossed.coordinator.beginRally();
    crossed.port.prepareSetterId = 4;
    crossed.rally.countTouch(TeamSide.AWAY);
    crossed.ball.launch(new THREE.Vector3(5, 1, 0), new THREE.Vector3(-4, 6, 0));
    crossed.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'pass',
      athleteId: 1,
      outcomeToken: null,
    });
    const crossSidePlan = {
      ...cpuPlan(crossed, 'set', 4, 21),
      athlete: crossed.home.athletes[4],
    };

    crossed.coordinator.bindCpuPlan(crossSidePlan);
    expect(crossed.port.offenseEvents).not.toContain('bind-set');
    expect(crossed.coordinator.consumeCpuTouch(crossSidePlan)).toBeNull();
  });

  it('prepara, vincula e consome ataque a partir do voo real do set', () => {
    const sample = fixture();
    const setPlan = prepareCpuSet(sample);
    expect(sample.coordinator.consumeCpuTouch(setPlan)?.kind).toBe('set');
    sample.rally.countTouch(TeamSide.AWAY);
    sample.ball.launch(new THREE.Vector3(2, 2.35, 0), new THREE.Vector3(-1, 5, 0.4));

    sample.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'set',
      athleteId: 4,
      outcomeToken: null,
    });

    expect(sample.coordinator.plannedCpuAthlete('spike', TeamSide.AWAY)).toBe(3);
    const attackPlan = cpuPlan(sample, 'spike', 3, 22);
    sample.coordinator.bindCpuPlan(attackPlan);
    expect(sample.coordinator.consumeCpuTouch(attackPlan)).toMatchObject({
      kind: 'spike',
      execution: { mode: 'fallback-placed-seam', target: { x: -7, z: 0.5 } },
    });
    expect(sample.port.offenseEvents.slice(-4)).toEqual([
      'observe-set',
      'prepare-attack',
      'bind-attack',
      'consume-attack',
    ]);
  });

  it('resolve bloqueio sem observá-lo e resolve defesa antes da nova posse', () => {
    const blocked = fixture();
    const blockedSet = prepareCpuSet(blocked);
    blocked.coordinator.consumeCpuTouch(blockedSet);
    blocked.rally.countTouch(TeamSide.AWAY);
    blocked.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'set',
      athleteId: 4,
      outcomeToken: null,
    });
    const blockedAttack = cpuPlan(blocked, 'spike', 3, 22);
    blocked.coordinator.bindCpuPlan(blockedAttack);
    blocked.coordinator.consumeCpuTouch(blockedAttack);

    blocked.coordinator.onBallContact({
      side: TeamSide.HOME,
      kind: 'block',
      athleteId: 3,
      outcomeToken: null,
    });
    expect(blocked.port.offenseEvents.at(-1)).toBe('resolve-block');
    expect(blocked.port.offenseContacts).toHaveLength(2);

    const defended = fixture();
    const defendedSet = prepareCpuSet(defended);
    defended.coordinator.consumeCpuTouch(defendedSet);
    defended.rally.countTouch(TeamSide.AWAY);
    defended.coordinator.onBallContact({
      side: TeamSide.AWAY,
      kind: 'set',
      athleteId: 4,
      outcomeToken: null,
    });
    const defendedAttack = cpuPlan(defended, 'spike', 3, 22);
    defended.coordinator.bindCpuPlan(defendedAttack);
    defended.coordinator.consumeCpuTouch(defendedAttack);
    defended.rally.countTouch(TeamSide.HOME);
    defended.ball.launch(new THREE.Vector3(-5, 1, 0), new THREE.Vector3(4, 6, 0));

    defended.coordinator.onBallContact({
      side: TeamSide.HOME,
      kind: 'dig',
      athleteId: 1,
      outcomeToken: null,
    });
    const defense = defended.port.offenseEvents.lastIndexOf('resolve-defense');
    const observation = defended.port.offenseEvents.lastIndexOf('observe-dig');
    expect(defense).toBeGreaterThanOrEqual(0);
    expect(observation).toBeGreaterThan(defense);
  });

  it('resolve o ataque no ponto antes de encerrar o rally ofensivo', () => {
    const sample = fixture();
    sample.coordinator.startMatch();
    sample.coordinator.beginRally();

    sample.coordinator.onPoint({
      servingSide: TeamSide.AWAY,
      winner: TeamSide.HOME,
      ace: false,
      cause: 'floor-in',
    });

    expect(sample.port.offenseEvents).toEqual(['begin-rally', 'resolve-point', 'end-rally']);
  });

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
