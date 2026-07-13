import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DIFFICULTIES, TeamSide } from '../../core/constants';
import { RandomHub } from '../../core/random';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { RallyState } from '../RallyState';
import type { Athlete, Team } from '../Team';
import type {
  ServeCommitmentRef,
  StrategicServeDirective,
  StrategicServeFamily,
  StrategicServeRealization,
} from '../strategy/StrategicServeSystem';
import type { MechanicsCtx } from './context';
import { aiServe, performServe, performStrategicServe } from './serve';

function makeCtx(aiValues: readonly number[], contactValues: readonly number[]) {
  const ai = SequenceRandom.fromFloats(aiValues);
  const contact = SequenceRandom.fromFloats(contactValues);
  const hub = new RandomHub(1);
  const scheduled: Array<() => void> = [];
  const launches: Array<{ p0: THREE.Vector3; v0: THREE.Vector3 }> = [];
  const telemetryOrder: string[] = [];
  const events: string[] = [];
  const telemetry: Array<Record<string, unknown>> = [];
  const actions: Array<{ action: string; duration: number }> = [];
  const scheduleTimes: number[] = [];
  const server = {
    side: TeamSide.HOME,
    index: 4,
    act: (action: string, duration: number) => {
      actions.push({ action, duration });
      events.push(`act:${action}`);
    },
    reachPoint: () => new THREE.Vector3(-8.5, 1.1, 0),
  } as unknown as Athlete;
  const ballPosition = new THREE.Vector3();
  const ball = {
    pos: ballPosition,
    launch: (p0: THREE.Vector3, v0: THREE.Vector3) => {
      launches.push({ p0: p0.clone(), v0: v0.clone() });
      ballPosition.copy(p0);
      events.push('ball:launch');
    },
  };
  const ctx = {
    ball,
    rally: new RallyState(),
    servingTeam: TeamSide.HOME,
    diff: { servePower: [0.5, 0.9], serveError: 0.25 },
    random: {
      rules: hub.stream('rules'),
      ai,
      contact,
      control: hub.stream('control'),
    },
    teamOf: () => ({ server: () => server }) as unknown as Team,
    hooks: {
      serveMeter: () => events.push('meter:off'),
      effects: { showAim: () => events.push('aim:off') },
      audio: { hitHard: () => events.push('audio:hard') },
      camera: { setMode: (mode: string) => events.push(`camera:${mode}`) },
    },
    after: (seconds: number, callback: () => void) => {
      scheduleTimes.push(seconds);
      scheduled.push(callback);
    },
    startRally: () => {
      telemetryOrder.push('rally-start');
      events.push('rally-start');
    },
    planNext: (kind: string) => events.push(`plan:${kind}`),
    emitTelemetry: (event: Record<string, unknown>) => {
      telemetryOrder.push(event.type as string);
      telemetry.push(event);
      events.push(`telemetry:${event.type as string}`);
    },
  } as unknown as MechanicsCtx;

  return {
    ctx,
    ai,
    contact,
    launches,
    scheduled,
    scheduleTimes,
    telemetryOrder,
    telemetry,
    events,
    actions,
    server,
  };
}

function directive(
  family: StrategicServeFamily = 'float-deep',
  side: TeamSide = TeamSide.HOME,
): StrategicServeDirective {
  const ref: ServeCommitmentRef = {
    matchEpoch: 2,
    serveEpoch: 7,
    side,
    serverAthleteId: 4,
    decisionId: '2:home:3',
    optionId: `serve.${family}.center`,
  };
  return {
    ref,
    family,
    target: { x: side === TeamSide.HOME ? 7.2 : -7.2, z: 1.1 },
  };
}

function runCallbacks(scheduled: Array<() => void>): void {
  for (const callback of scheduled) callback();
}

describe('aiServe — ownership e consumo do RNG', () => {
  it('saque dentro consome decisões de alvo no stream ai e contato físico no contact', () => {
    const { ctx, ai, contact, launches, scheduled } = makeCtx([0.5, 0.25, 0.75], [0.9, 0.5]);

    aiServe(ctx);

    expect(ai.draws).toBe(3);
    expect(contact.draws).toBe(2);
    expect(launches).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
  });

  it('erro longo mantém toda a dispersão física no stream contact', () => {
    const { ctx, ai, contact } = makeCtx([0.5], [0.1, 0.1, 0.2, 0.3, 0.4]);

    aiServe(ctx);

    expect(ai.draws).toBe(1);
    expect(contact.draws).toBe(5);
  });

  it('erro na rede tem o mesmo orçamento de draws do erro longo', () => {
    const { ctx, ai, contact } = makeCtx([0.5], [0.1, 0.9, 0.2, 0.3, 0.4]);

    aiServe(ctx);

    expect(ai.draws).toBe(1);
    expect(contact.draws).toBe(5);
  });

  it('transiciona o rally antes de publicar o evento de saque', () => {
    const { ctx, scheduled, telemetryOrder } = makeCtx([0.5, 0.25, 0.75], [0.9, 0.5]);

    aiServe(ctx);
    scheduled[1]();

    expect(telemetryOrder).toEqual(['rally-start', 'serve']);
  });
});

describe('performStrategicServe - protocolo e realização física', () => {
  it('toss stale é inerte antes de animação, bola e agendamento', () => {
    const sample = makeCtx([0.5], [0.5]);
    const guards: string[] = [];

    performStrategicServe(sample.ctx, sample.server, directive(), {
      guard: (_ref, stage) => {
        guards.push(stage);
        return false;
      },
      onLaunched: () => true,
    });

    expect(guards).toEqual(['toss']);
    expect(sample.events).toEqual([]);
    expect(sample.launches).toEqual([]);
    expect(sample.scheduled).toEqual([]);
    expect(sample.contact.draws).toBe(0);
    expect(sample.ai.draws).toBe(0);
  });

  it.each([
    [
      'ctx.side',
      (sample: ReturnType<typeof makeCtx>) => {
        sample.ctx.servingTeam = TeamSide.AWAY;
      },
    ],
    [
      'server.side',
      (sample: ReturnType<typeof makeCtx>) => {
        sample.server.side = TeamSide.AWAY;
      },
    ],
    [
      'server.index',
      (sample: ReturnType<typeof makeCtx>) => {
        sample.server.index = 5;
      },
    ],
  ] as const)('mismatch %s é rejeitado antes até do guard de toss', (_case, mutate) => {
    const sample = makeCtx([0.5], [0.5]);
    let guards = 0;
    mutate(sample);

    performStrategicServe(sample.ctx, sample.server, directive(), {
      guard: () => {
        guards++;
        return true;
      },
      onLaunched: () => true,
    });

    expect(guards).toBe(0);
    expect(sample.events).toEqual([]);
    expect(sample.launches).toEqual([]);
    expect(sample.scheduled).toEqual([]);
    expect(sample.contact.draws).toBe(0);
  });

  it('stale entre toss e hit guarda animação e contato de forma independente', () => {
    const sample = makeCtx([0.5], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const guards: string[] = [];

    performStrategicServe(sample.ctx, sample.server, directive(), {
      guard: (_ref, stage) => {
        guards.push(stage);
        return guards.length < 3;
      },
      onLaunched: () => true,
    });
    const afterToss = sample.launches.map(({ p0, v0 }) => ({ p0: p0.clone(), v0: v0.clone() }));
    runCallbacks(sample.scheduled);

    expect(guards).toEqual(['toss', 'hit', 'hit']);
    expect(sample.events.filter((event) => event.startsWith('act:'))).toEqual([
      'act:serveToss',
      'act:serveHit',
    ]);
    expect(sample.launches).toEqual(afterToss);
    expect(sample.contact.draws).toBe(0);
    expect(sample.ai.draws).toBe(0);
    expect(sample.telemetry).toEqual([]);
    expect(sample.ctx.rally.possessionTeam).toBeNull();
  });

  it('válido usa seis draws contact e aceita realização antes da finalização', () => {
    const sample = makeCtx([0.13], [0.5, 0.99, 0.25, 0.5, 0.5, 0.5]);
    const stages: string[] = [];
    let realized: StrategicServeRealization | undefined;
    const plan = directive('float-deep');

    performStrategicServe(sample.ctx, sample.server, plan, {
      guard: (ref, stage) => {
        stages.push(`guard:${stage}:${ref.serveEpoch}`);
        sample.events.push(`guard:${stage}`);
        return true;
      },
      onLaunched: (ref, realization) => {
        sample.events.push('onLaunched');
        expect(ref).toEqual(plan.ref);
        realized = realization;
        return true;
      },
    });
    runCallbacks(sample.scheduled);

    expect(stages).toEqual(['guard:toss:7', 'guard:hit:7', 'guard:hit:7']);
    expect(sample.contact.draws).toBe(6);
    expect(sample.ai.draws).toBe(0);
    expect(realized?.target).toEqual(plan.target);
    expect(realized?.power).toBeGreaterThan(0);
    expect(realized?.power).toBeLessThanOrEqual(1);
    expect(realized?.clearance).toBeGreaterThan(0);
    expect(sample.events).toEqual([
      'guard:toss',
      'meter:off',
      'aim:off',
      'act:serveToss',
      'ball:launch',
      'guard:hit',
      'act:serveHit',
      'guard:hit',
      'onLaunched',
      'ball:launch',
      'rally-start',
      'telemetry:serve',
      'audio:hard',
      'camera:rally',
      'plan:pass',
    ]);
  });

  it('famílias alteram potência, folga e dispersão mantendo o alvo como aim', () => {
    const results = new Map<StrategicServeFamily, StrategicServeRealization>();
    for (const family of ['float-short', 'float-deep', 'power-deep'] as const) {
      const sample = makeCtx([0.4], [0.5, 0.99, 0.5, 0.99, 0.99, 0.5]);
      const plan = directive(family);
      performStrategicServe(sample.ctx, sample.server, plan, {
        guard: () => true,
        onLaunched: (_ref, realization) => {
          results.set(family, realization);
          return true;
        },
      });
      runCallbacks(sample.scheduled);
      expect(sample.contact.draws).toBe(6);
      expect(sample.ai.draws).toBe(0);
      expect(results.get(family)?.target.x).toBeGreaterThan(plan.target.x);
      expect(results.get(family)?.target.z).toBeGreaterThan(plan.target.z);
    }

    const short = results.get('float-short')!;
    const deep = results.get('float-deep')!;
    const power = results.get('power-deep')!;
    expect(short.power).toBeLessThan(deep.power);
    expect(deep.power).toBeLessThan(power.power);
    expect(short.clearance).toBeGreaterThan(deep.clearance);
    expect(deep.clearance).toBeGreaterThan(power.clearance);
    expect(power.target.x - 7.2).toBeGreaterThan(deep.target.x - 7.2);
    expect(deep.target.x - 7.2).toBeGreaterThan(short.target.x - 7.2);
  });

  it('compõe dificuldade no power e altera tempo/velocidade com os mesmos draws', () => {
    const results: Array<{
      realization: StrategicServeRealization;
      flightTime: number;
      speed: number;
    }> = [];
    for (const difficulty of DIFFICULTIES) {
      const sample = makeCtx([0.4], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
      sample.ctx.diff = difficulty;
      let realization: StrategicServeRealization | undefined;
      performStrategicServe(sample.ctx, sample.server, directive('float-deep'), {
        guard: () => true,
        onLaunched: (_ref, value) => {
          realization = value;
          return true;
        },
      });
      runCallbacks(sample.scheduled);
      const flight = sample.launches[1];
      const flightTime = (realization!.target.x - flight.p0.x) / flight.v0.x;
      results.push({ realization: realization!, flightTime, speed: flight.v0.length() });
      expect(sample.contact.draws).toBe(6);
      expect(sample.ai.draws).toBe(0);
    }

    expect(results[0].realization.power).toBeLessThan(results[1].realization.power);
    expect(results[1].realization.power).toBeLessThan(results[2].realization.power);
    expect(results[0].realization.clearance).toBeGreaterThan(results[1].realization.clearance);
    expect(results[1].realization.clearance).toBeGreaterThan(results[2].realization.clearance);
    expect(results[0].flightTime).toBeGreaterThan(results[1].flightTime);
    expect(results[1].flightTime).toBeGreaterThan(results[2].flightTime);
    expect(results[0].speed).not.toBe(results[2].speed);
  });

  it('compõe serveError da dificuldade mantendo o orçamento fixo', () => {
    const targetX: number[] = [];
    for (const difficulty of DIFFICULTIES) {
      const sample = makeCtx([0.4], [0.5, 0.12, 0.1, 0.5, 0.5, 0.5]);
      sample.ctx.diff = difficulty;
      performStrategicServe(sample.ctx, sample.server, directive('float-deep'), {
        guard: () => true,
        onLaunched: (_ref, realization) => {
          targetX.push(realization.target.x);
          return true;
        },
      });
      runCallbacks(sample.scheduled);
      expect(sample.contact.draws).toBe(6);
    }

    expect(targetX[0]).toBeGreaterThan(9);
    expect(targetX[1]).toBeLessThan(9);
    expect(targetX[2]).toBeLessThan(9);
  });

  it('chance de erro também depende da família', () => {
    const targets = new Map<StrategicServeFamily, number>();
    for (const family of ['float-short', 'float-deep', 'power-deep'] as const) {
      const sample = makeCtx([0.4], [0.5, 0.22, 0.1, 0.5, 0.5, 0.5]);
      performStrategicServe(sample.ctx, sample.server, directive(family), {
        guard: () => true,
        onLaunched: (_ref, realization) => {
          targets.set(family, realization.target.x);
          return true;
        },
      });
      runCallbacks(sample.scheduled);
    }

    expect(targets.get('float-short')).toBeLessThan(9);
    expect(targets.get('float-deep')).toBeGreaterThan(9);
    expect(targets.get('power-deep')).toBeGreaterThan(9);
  });

  it('float e power têm toss/hit observavelmente distintos sem consultar alvo', () => {
    const float = makeCtx([0.4], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
    const power = makeCtx([0.4], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
    const hooks = { guard: () => true, onLaunched: () => true };

    performStrategicServe(float.ctx, float.server, directive('float-short'), hooks);
    performStrategicServe(power.ctx, power.server, directive('power-deep'), hooks);

    expect(float.launches[0].v0.y).not.toBe(power.launches[0].v0.y);
    expect(float.actions[0].duration).not.toBe(power.actions[0].duration);
    float.scheduled[0]();
    power.scheduled[0]();
    expect(float.actions[1].duration).not.toBe(power.actions[1].duration);
    expect(float.actions[1].duration).toBeGreaterThanOrEqual(0.42);
    expect(power.actions[1].duration).toBeGreaterThanOrEqual(0.42);
    expect(float.scheduleTimes[1]).toBeGreaterThanOrEqual(0.42);
    expect(power.scheduleTimes[1]).toBeGreaterThanOrEqual(0.42);
    expect(float.contact.draws).toBe(0);
    expect(power.contact.draws).toBe(0);
  });

  it.each([
    ['longo', 0.1, true],
    ['rede', 0.9, false],
  ] as const)('erro %s preserva orçamento fixo', (_name, errorMode, long) => {
    const sample = makeCtx([0.7], [0.5, 0, errorMode, 0.6, 0.4, 0.5]);
    let realized: StrategicServeRealization | undefined;

    performStrategicServe(sample.ctx, sample.server, directive('power-deep'), {
      guard: () => true,
      onLaunched: (_ref, realization) => {
        realized = realization;
        return true;
      },
    });
    runCallbacks(sample.scheduled);

    expect(sample.contact.draws).toBe(6);
    expect(sample.ai.draws).toBe(0);
    if (long) {
      expect(realized!.target.x).toBeGreaterThan(9);
      expect(realized!.clearance).toBeGreaterThan(0);
    } else {
      expect(realized!.target.x).toBeLessThan(9);
      expect(realized!.clearance).toBeLessThan(0);
    }
  });

  it('onLaunched false bloqueia launch, rally e telemetria após realizar', () => {
    const sample = makeCtx([0.8], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
    performStrategicServe(sample.ctx, sample.server, directive(), {
      guard: () => true,
      onLaunched: () => false,
    });
    runCallbacks(sample.scheduled);

    expect(sample.contact.draws).toBe(6);
    expect(sample.launches).toHaveLength(1);
    expect(sample.telemetry).toEqual([]);
    expect(sample.events).not.toContain('rally-start');
    expect(sample.events).not.toContain('audio:hard');
    expect(sample.events).not.toContain('camera:rally');
    expect(sample.ctx.rally.possessionTeam).toBeNull();
  });

  it('captura side e ref no toss, sem observar mudanças tardias do contexto', () => {
    const sample = makeCtx([0.2], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
    const plan = directive('float-deep', TeamSide.HOME);
    const seenRefs: ServeCommitmentRef[] = [];
    performStrategicServe(sample.ctx, sample.server, plan, {
      guard: (ref) => {
        seenRefs.push(ref);
        return true;
      },
      onLaunched: (ref) => {
        seenRefs.push(ref);
        return true;
      },
    });
    sample.ctx.servingTeam = TeamSide.AWAY;
    sample.server.side = TeamSide.AWAY;
    sample.server.index = 99;
    runCallbacks(sample.scheduled);

    expect(seenRefs).toHaveLength(4);
    expect(seenRefs.every((ref) => ref.side === TeamSide.HOME && Object.isFrozen(ref))).toBe(true);
    expect(sample.telemetry.at(-1)).toMatchObject({ side: TeamSide.HOME, athlete: 4 });
    expect(sample.ctx.rally.lastTouchTeam).toBe(TeamSide.HOME);
    expect(sample.ctx.rally.possessionTeam).toBe(TeamSide.HOME);
  });
});

describe('performServe - regressão humana', () => {
  it('preserva toss, hit e finalização sem consumir RNG', () => {
    const sample = makeCtx([0.4], [0.6]);
    const target = new THREE.Vector3(6.4, 0, -1.3);

    performServe(sample.ctx, sample.server, 0.73, target, 0.48);
    sample.ctx.servingTeam = TeamSide.AWAY;
    runCallbacks(sample.scheduled);

    expect(sample.ai.draws).toBe(0);
    expect(sample.contact.draws).toBe(0);
    expect(sample.launches).toHaveLength(2);
    expect(sample.events.filter((event) => event.startsWith('act:'))).toEqual([
      'act:serveToss',
      'act:serveHit',
    ]);
    expect(sample.telemetry.at(-1)).toMatchObject({
      type: 'serve',
      side: TeamSide.HOME,
      athlete: 4,
      power: 0.73,
      target: { x: 6.4, y: 0, z: -1.3 },
      clearance: 0.48,
    });
    expect(sample.telemetryOrder).toEqual(['rally-start', 'serve']);
  });
});
