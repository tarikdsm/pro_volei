import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ball } from '../../entities/Ball';
import type { AiController } from '../ai/AiController';
import type { MechanicsCtx } from '../mechanics/context';
import { RallyState } from '../RallyState';
import { MatchTimeline, type MatchTimelinePort } from './MatchTimeline';

function fixture(overrides: Partial<MatchTimelinePort> = {}) {
  const rally = new RallyState();
  const ball = {
    inFlight: false,
    pos: new THREE.Vector3(0, 2, 0),
    vel: new THREE.Vector3(),
    step: vi.fn(),
    timeToDescend: vi.fn(() => -1),
  } as unknown as Ball;
  const ai = {
    advanceScheduledJumpTimers: vi.fn(),
    resolveScheduledJumps: vi.fn(),
  } as unknown as AiController;
  const port: MatchTimelinePort = {
    rally,
    ball,
    ai,
    mechanics: {} as MechanicsCtx,
    isRally: () => false,
    advanceWorld: vi.fn(),
    resolveContact: vi.fn(),
    resolveNet: vi.fn(),
    resolveAntenna: vi.fn(),
    resolveFloor: vi.fn(),
    ...overrides,
  };
  return { rally, ball, ai, port, timeline: new MatchTimeline(port) };
}

describe('MatchTimeline', () => {
  it('segmenta o tick no instante exato de um evento agendado', () => {
    const slices: number[] = [];
    const order: string[] = [];
    const { timeline, port, ball, ai } = fixture({
      advanceWorld: (seconds) => {
        slices.push(seconds);
        order.push(`world:${seconds}`);
      },
    });
    timeline.after(0.04, () => order.push('event'));

    timeline.step(0.1);

    expect(slices).toEqual([0.04, 0.060000000000000005]);
    expect(order).toEqual(['world:0.04', 'event', 'world:0.060000000000000005']);
    expect(ball.step).toHaveBeenNthCalledWith(1, 0.04);
    expect(ball.step).toHaveBeenNthCalledWith(2, 0.060000000000000005);
    expect(ai.advanceScheduledJumpTimers).toHaveBeenCalledTimes(2);
    expect(port.resolveFloor).not.toHaveBeenCalled();
  });

  it('processa eventos zero-time criados por outro evento sem duplicar resolução', () => {
    const resolved: string[] = [];
    const { timeline } = fixture();
    timeline.after(0, () => {
      resolved.push('first');
      timeline.after(0, () => resolved.push('second'));
    });

    timeline.step(1 / 60);

    expect(resolved).toEqual(['first', 'second']);
  });

  it('não atrasa um evento decimal que cai exatamente na fronteira do tick', () => {
    const resolvedAtStep: number[] = [];
    const { timeline } = fixture();
    timeline.after(0.1, () => resolvedAtStep.push(6));

    for (let step = 1; step <= 6; step++) {
      timeline.step(1 / 60);
      if (step < 6) expect(resolvedAtStep).toEqual([]);
    }

    expect(resolvedAtStep).toEqual([6]);
  });

  it('zera o timer do pulo tolerado na fronteira antes de pedir a resolução', () => {
    const { rally, ai, timeline } = fixture({ isRally: () => true });
    vi.mocked(ai.advanceScheduledJumpTimers).mockImplementation((seconds) => {
      if (rally.plan?.jumpScheduledIn !== undefined) rally.plan.jumpScheduledIn -= seconds;
    });
    rally.plan = {
      side: 0,
      athlete: {} as never,
      contactIn: 1,
      point: new THREE.Vector3(),
      kind: 'spike',
      isHuman: false,
      jumpScheduledIn: 0.01 + 1e-10,
      done: false,
    };

    timeline.step(0.01);

    expect(rally.plan.jumpScheduledIn).toBe(0);
    expect(ai.resolveScheduledJumps).toHaveBeenCalledOnce();
  });

  it('resolve contato antes do chão quando ambos acontecem no mesmo instante', () => {
    const order: string[] = [];
    let floorIn = 0.01;
    const { rally, ball, port, timeline } = fixture({ isRally: () => true });
    const typedBall = ball as unknown as {
      inFlight: boolean;
      vel: THREE.Vector3;
      step: ReturnType<typeof vi.fn>;
      timeToDescend: ReturnType<typeof vi.fn>;
    };
    typedBall.inFlight = true;
    typedBall.vel.set(0, -1, 0);
    typedBall.step.mockImplementation((seconds: number) => {
      floorIn = Math.max(0, floorIn - seconds);
    });
    typedBall.timeToDescend.mockImplementation(() => floorIn);
    rally.plan = {
      side: 0,
      athlete: {} as never,
      contactIn: 0.01,
      point: new THREE.Vector3(),
      kind: 'pass',
      isHuman: false,
      done: false,
    };
    port.resolveContact = (plan) => {
      order.push('contact');
      plan.done = true;
    };
    port.resolveFloor = () => order.push('floor');

    timeline.step(0.02);

    expect(order).toEqual(['contact', 'floor']);
  });
});
