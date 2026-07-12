import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { executeTouch } from './touch';
import { RallyState, TouchPlan } from '../RallyState';
import { TeamSide } from '../../core/constants';
import type { MechanicsCtx } from './context';
import type { Athlete } from '../Team';
import type {
  ActionContext,
  ActionGesture,
  ActionIntent,
  ActionTechnique,
} from '../control/ActionIntent';

// executeTouch é função livre sobre o MechanicsCtx: testável em Node com fakes
// (usa só THREE.Vector3). O foco é garantir que a bola é lançada do ponto ANALÍTICO
// do contato (plan.point), nunca da posição stale do frame anterior (ctx.ball.pos).

interface FakeBall {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  origin: THREE.Vector3 | null; // p0 capturado no último launch
  launch(p0: THREE.Vector3, v0: THREE.Vector3): void;
}

function makeCtx(stalePos: THREE.Vector3): {
  ctx: MechanicsCtx;
  ball: FakeBall;
  acts: string[];
  planned: string[];
} {
  const ball: FakeBall = {
    pos: stalePos.clone(),
    vel: new THREE.Vector3(),
    origin: null,
    launch(p0, v0) {
      this.origin = p0.clone();
      this.pos.copy(p0);
      this.vel.copy(v0);
    },
  };

  const acts: string[] = [];
  const planned: string[] = [];
  const athlete = {
    pos: new THREE.Vector3(),
    act(kind: string): void {
      acts.push(kind);
    },
  } as unknown as Athlete;
  const team = {
    setterSpot: () => ({ x: -0.95, z: 1.1 }),
    nearestTo: () => athlete,
    nearestFrontRowTo: () => athlete,
    frontRow: () => [] as Athlete[],
  };

  const noop = (): void => {};
  const ctx = {
    ball,
    rally: new RallyState(),
    hooks: {
      crowd: { excite: noop },
      audio: { excite: noop, hitSoft: noop, hitHard: noop },
      effects: { burst: noop, showAim: noop },
      camera: { kickFov: noop, addShake: noop },
      slowMo: noop,
      zoneHint: noop,
    },
    diff: { attackError: 0 },
    aim: new THREE.Vector3(5, 0, 0),
    chosenZone: 1,
    teamOf: () => team,
    after: noop,
    planNext: (kind: string) => planned.push(kind),
  } as unknown as MechanicsCtx;

  return { ctx, ball, acts, planned };
}

function makePlan(kind: TouchPlan['kind'], athlete: Athlete): TouchPlan {
  return {
    planId: 1,
    side: TeamSide.HOME,
    athlete,
    contactIn: 0,
    point: new THREE.Vector3(-3, 0.9, 1), // ponto analítico do contato
    kind,
    isHuman: true,
    done: false,
  };
}

function actionIntent(
  context: ActionContext,
  gesture: ActionGesture,
  technique: ActionTechnique,
  overrides: Partial<ActionIntent> = {},
): ActionIntent {
  return {
    token: 1,
    context,
    gesture,
    charge: gesture === 'tap' ? 0 : 0.8,
    direction: { x: 0, z: 0 },
    pressedTick: 1,
    resolvedTick: 10,
    cause: 'release',
    technique,
    power: 0.8,
    reach: 0.7,
    precision: 0.85,
    penetration: 0.5,
    ...overrides,
  };
}

describe('executeTouch — origem no ponto analítico (plan.point), não na pos stale', () => {
  it('passe: lança de plan.point, não de ball.pos', () => {
    const { ctx, ball } = makeCtx(new THREE.Vector3(-2, 1, 0)); // pos STALE
    const plan = makePlan('pass', ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(ctx, plan, 0.8);

    expect(ball.origin).not.toBeNull();
    expect(ball.origin!.x).toBeCloseTo(-3);
    expect(ball.origin!.z).toBeCloseTo(1);
    expect(ball.origin!.x).not.toBe(-2); // não a posição stale
  });

  it('levantamento: lança de plan.point, não de ball.pos', () => {
    const { ctx, ball } = makeCtx(new THREE.Vector3(-2, 1, 0));
    const plan = makePlan('set', ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(ctx, plan, 0.8);

    expect(ball.origin).not.toBeNull();
    expect(ball.origin!.x).toBeCloseTo(-3);
    expect(ball.origin!.z).toBeCloseTo(1);
    expect(ball.origin!.x).not.toBe(-2);
  });

  it('cortada: lança de plan.point, não de ball.pos', () => {
    const { ctx, ball } = makeCtx(new THREE.Vector3(-2, 1, 0));
    const plan = makePlan('spike', ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(ctx, plan, 0.7);

    expect(ball.origin).not.toBeNull();
    expect(ball.origin!.x).toBeCloseTo(-3);
    expect(ball.origin!.z).toBeCloseTo(1);
    expect(ball.origin!.x).not.toBe(-2);
  });
});

describe('executeTouch — intenção semântica humana', () => {
  it('direção deliberada orienta o passe e hold usa animação de mergulho', () => {
    const neutral = makeCtx(new THREE.Vector3());
    const directed = makeCtx(new THREE.Vector3());
    const neutralPlan = makePlan('dig', neutral.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));
    const directedPlan = makePlan('dig', directed.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(neutral.ctx, neutralPlan, 1, actionIntent('receive', 'tap', 'platform-pass'));
    executeTouch(
      directed.ctx,
      directedPlan,
      1,
      actionIntent('receive', 'hold', 'emergency-dive', {
        direction: { x: 0, z: 1 },
      }),
    );

    expect(directed.ball.vel.z).toBeGreaterThan(neutral.ball.vel.z);
    expect(directed.acts).toContain('dive');
  });

  it('levantamento alto tem velocidade vertical maior que o tempo rápido', () => {
    const high = makeCtx(new THREE.Vector3());
    const quick = makeCtx(new THREE.Vector3());
    const highPlan = makePlan('set', high.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));
    const quickPlan = makePlan('set', quick.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(high.ctx, highPlan, 1, actionIntent('set', 'tap', 'high-set'));
    executeTouch(quick.ctx, quickPlan, 1, actionIntent('set', 'hold', 'quick-set'));

    expect(high.ball.vel.y).toBeGreaterThan(quick.ball.vel.y);
  });

  it('cortada potente viaja mais rápido que largada para o mesmo alvo', () => {
    const tip = makeCtx(new THREE.Vector3());
    const spike = makeCtx(new THREE.Vector3());
    const tipPlan = makePlan('spike', tip.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));
    const spikePlan = makePlan('spike', spike.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(tip.ctx, tipPlan, 1, actionIntent('attack', 'tap', 'tip'));
    executeTouch(
      spike.ctx,
      spikePlan,
      1,
      actionIntent('attack', 'hold', 'power-spike', { power: 1 }),
    );

    expect(spike.ball.vel.length()).toBeGreaterThan(tip.ball.vel.length());
  });

  it('freeball semântica envia a bola claramente para a quadra rival', () => {
    const safe = makeCtx(new THREE.Vector3());
    const plan = makePlan('freeball', safe.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));

    executeTouch(safe.ctx, plan, 1, actionIntent('freeball', 'tap', 'safe-save'));

    expect(safe.ball.vel.x).toBeGreaterThan(5);
    expect(safe.planned).toContain('pass');
  });

  it('terceiro toque converte passe automaticamente em bola para a outra quadra', () => {
    const third = makeCtx(new THREE.Vector3());
    const plan = makePlan('pass', third.ctx.teamOf(TeamSide.HOME).nearestTo(0, 0));
    third.ctx.rally.countTouch(TeamSide.HOME);
    third.ctx.rally.countTouch(TeamSide.HOME);

    executeTouch(third.ctx, plan, 1, actionIntent('receive', 'tap', 'platform-pass'));

    expect(third.ctx.rally.possessionTouches).toBe(3);
    expect(third.ctx.rally.lastKind).toBe('freeball');
    expect(third.ball.vel.x).toBeGreaterThan(5);
    expect(third.planned).toContain('pass');
  });
});
