import type * as THREE from 'three';

/** Superfície lógica mínima da bola consumida pela simulação. */
export interface BallSimulationPort {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  inFlight: boolean;
  bouncy: boolean;

  hold(position: THREE.Vector3): void;
  launch(position: THREE.Vector3, velocity: THREE.Vector3): void;
  step(dt: number): void;
  predictLanding(): { point: THREE.Vector3; time: number };
  timeToDescend(height: number): number;
  posAt(time: number, out: THREE.Vector3): THREE.Vector3;
}

/** Extensão usada pelo Match browser/headless para sincronizar apresentação por fixed step. */
export interface MatchBallPort extends BallSimulationPort {
  readonly group: THREE.Object3D;
  beginFixedStep(): void;
  endFixedStep(): void;
  present(alpha: number): THREE.Vector3;
}
