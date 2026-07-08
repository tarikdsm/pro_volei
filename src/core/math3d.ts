import * as THREE from 'three';
import { GRAVITY } from './constants';

// Solver balístico por arco: dado início, alvo e altura do ápice ACIMA do ponto inicial,
// retorna velocidade inicial e tempo total de voo. Garante que a bola sempre chega no alvo.
export function ballisticArc(
  p0: THREE.Vector3,
  target: THREE.Vector3,
  apexAbove: number,
): { v0: THREE.Vector3; time: number } {
  const g = -GRAVITY;
  const apexY = Math.max(p0.y, target.y) + Math.max(0.3, apexAbove);
  const vy = Math.sqrt(2 * g * (apexY - p0.y));
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * (apexY - target.y)) / g);
  const time = tUp + tDown;
  const v0 = new THREE.Vector3((target.x - p0.x) / time, vy, (target.z - p0.z) / time);
  return { v0, time };
}

// Solver por tempo: trajetória reta-tensa (cortada/saque forte). Dado o tempo de voo,
// resolve a velocidade inicial exata para atingir o alvo sob gravidade.
export function ballisticDrive(
  p0: THREE.Vector3,
  target: THREE.Vector3,
  time: number,
): { v0: THREE.Vector3; time: number } {
  const v0 = new THREE.Vector3(
    (target.x - p0.x) / time,
    (target.y - p0.y) / time - 0.5 * GRAVITY * time,
    (target.z - p0.z) / time,
  );
  return { v0, time };
}

// Saque: resolve o tempo de voo para que a trajetória cruze o plano da rede (x=0)
// exatamente na altura crossHeight. Garante que a força escolhida nunca gere uma
// trajetória geometricamente impossível (que era a causa de todo saque ir na rede).
// crossHeight abaixo do topo da rede = falta proposital (saque fraco/errado).
export function serveDrive(
  p0: THREE.Vector3,
  target: THREE.Vector3,
  crossHeight: number,
): { v0: THREE.Vector3; time: number } {
  const dxTotal = target.x - p0.x;
  const f = (0 - p0.x) / dxTotal; // fração do percurso horizontal onde está a rede
  if (f > 0.03 && f < 0.97) {
    // y(f·T) = p0.y + f·(y1 − y0) + (|g|/2)·T²·f·(1−f)  →  resolve T
    const num = crossHeight - p0.y - f * (target.y - p0.y);
    const den = (-GRAVITY / 2) * f * (1 - f);
    const t2 = num / den;
    if (t2 > 0.05) return ballisticDrive(p0, target, Math.sqrt(t2));
  }
  return ballisticDrive(p0, target, 1.1); // alvo atípico (mesmo lado da rede etc.)
}

// Tempo até a bola (pos, vel) descer à altura h. Retorna -1 se nunca atinge.
export function timeToHeight(pos: THREE.Vector3, vel: THREE.Vector3, h: number): number {
  // pos.y + vel.y*t + 0.5*g*t^2 = h  →  0.5*g*t^2 + vel.y*t + (pos.y - h) = 0
  const a = 0.5 * GRAVITY;
  const b = vel.y;
  const c = pos.y - h;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  // raiz maior = descendo através de h
  const t = (-b - sq) / (2 * a);
  return t > 0 ? t : -1;
}

export function positionAt(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.set(pos.x + vel.x * t, pos.y + vel.y * t + 0.5 * GRAVITY * t * t, pos.z + vel.z * t);
  return out;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Amortecimento exponencial independente de framerate
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampV3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  dt: number,
): void {
  const t = 1 - Math.exp(-lambda * dt);
  current.lerp(target, t);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chance(p: number): boolean {
  return Math.random() < p;
}
