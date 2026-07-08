import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { executeTouch } from './touch';
import { RallyState, TouchPlan } from '../RallyState';
import { TeamSide } from '../../core/constants';
import type { MechanicsCtx } from './context';
import type { Athlete } from '../Team';

// executeTouch é função livre sobre o MechanicsCtx: testável em Node com fakes
// (usa só THREE.Vector3). O foco é garantir que a bola é lançada do ponto ANALÍTICO
// do contato (plan.point), nunca da posição stale do frame anterior (ctx.ball.pos).

interface FakeBall {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  origin: THREE.Vector3 | null; // p0 capturado no último launch
  launch(p0: THREE.Vector3, v0: THREE.Vector3): void;
}

function makeCtx(stalePos: THREE.Vector3): { ctx: MechanicsCtx; ball: FakeBall } {
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

  const athlete = { pos: new THREE.Vector3(), act(): void {} } as unknown as Athlete;
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
    planNext: noop,
  } as unknown as MechanicsCtx;

  return { ctx, ball };
}

function makePlan(kind: TouchPlan['kind'], athlete: Athlete): TouchPlan {
  return {
    side: TeamSide.HOME,
    athlete,
    contactIn: 0,
    point: new THREE.Vector3(-3, 0.9, 1), // ponto analítico do contato
    kind,
    isHuman: true,
    done: false,
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
