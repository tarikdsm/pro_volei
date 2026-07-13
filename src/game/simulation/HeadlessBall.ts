import * as THREE from 'three';
import { BALL_RADIUS } from '../../core/constants';
import { positionAt, timeToHeight } from '../../core/math3d';
import type { MatchBallPort } from './BallSimulationPort';
import { stepBallPhysics } from './BallPhysics';

/** Bola lógica sem meshes, canvas, WebGL ou aleatoriedade visual. */
export class HeadlessBall implements MatchBallPort {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(0, 1, 0);
  readonly vel = new THREE.Vector3();
  private readonly previousPos = new THREE.Vector3(0, 1, 0);
  private readonly presentedPos = new THREE.Vector3(0, 1, 0);
  inFlight = false;
  bouncy = false;

  hold(position: THREE.Vector3): void {
    this.inFlight = false;
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.previousPos.copy(position);
    this.presentedPos.copy(position);
  }

  launch(position: THREE.Vector3, velocity: THREE.Vector3): void {
    this.pos.copy(position);
    this.vel.copy(velocity);
    this.inFlight = true;
    this.bouncy = false;
  }

  step(dt: number): void {
    if (!this.inFlight) return;

    stepBallPhysics(this, dt);
  }

  predictLanding(): { point: THREE.Vector3; time: number } {
    const time = timeToHeight(this.pos, this.vel, BALL_RADIUS);
    const point = new THREE.Vector3();
    if (time < 0) return { point: point.copy(this.pos).setY(0), time: 0 };

    positionAt(this.pos, this.vel, time, point);
    point.y = 0;
    return { point, time };
  }

  timeToDescend(height: number): number {
    return timeToHeight(this.pos, this.vel, height);
  }

  posAt(time: number, out: THREE.Vector3): THREE.Vector3 {
    return positionAt(this.pos, this.vel, time, out);
  }

  beginFixedStep(): void {
    this.previousPos.copy(this.pos);
  }

  endFixedStep(): void {}

  present(alpha: number): THREE.Vector3 {
    const t = Math.max(0, Math.min(1, alpha));
    return this.presentedPos.lerpVectors(this.previousPos, this.pos, t);
  }
}
