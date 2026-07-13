import type * as THREE from 'three';
import { BALL_RADIUS } from '../../core/constants';
import { integrateBallistic } from '../../core/math3d';

export interface MutableBallState {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly bouncy: boolean;
}

/** Única regra de integração e quique compartilhada pelos adapters visual e headless. */
export function stepBallPhysics(state: MutableBallState, dt: number): void {
  integrateBallistic(state.pos, state.vel, dt);
  if (!state.bouncy || state.pos.y > BALL_RADIUS || state.vel.y >= 0) return;

  state.pos.y = BALL_RADIUS;
  state.vel.y = -state.vel.y * 0.55;
  state.vel.x *= 0.82;
  state.vel.z *= 0.82;
  if (Math.abs(state.vel.y) < 0.8) state.vel.set(0, 0, 0);
}
