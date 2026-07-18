import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { solveTwoBoneIK, type TwoBoneSolution } from './TwoBoneIK';

// Reconstrução forward-kinematics na MESMA convenção do solver: raiz = Ry(yaw)·Rx(pitch);
// osso inferior gira Rx(midFlex) no referencial do superior; descanso aponta -y.
function tipOf(s: TwoBoneSolution, l1: number, l2: number): THREE.Vector3 {
  const root = new THREE.Matrix4()
    .makeRotationY(s.rootYaw)
    .multiply(new THREE.Matrix4().makeRotationX(s.rootPitch));
  const mid = new THREE.Vector3(0, -l1, 0).applyMatrix4(root);
  const lower = new THREE.Vector3(0, -l2, 0)
    .applyMatrix4(new THREE.Matrix4().makeRotationX(s.midFlex))
    .applyMatrix4(root);
  return mid.add(lower);
}

const L1 = 0.26;
const L2 = 0.24;

describe('solveTwoBoneIK', () => {
  it('alvo esticado para baixo: cadeia reta e sem clamp', () => {
    const s = solveTwoBoneIK({ x: 0, y: -(L1 + L2), z: 0 }, L1, L2);
    expect(s.clamped).toBe(false);
    expect(s.midFlex).toBeCloseTo(0, 6);
    expect(tipOf(s, L1, L2).distanceTo(new THREE.Vector3(0, -(L1 + L2), 0))).toBeLessThan(1e-6);
  });

  it('alvo alcançável dobrado: ponta cai exatamente no alvo com flexão negativa', () => {
    const target = new THREE.Vector3(0.1, -0.3, 0.15);
    const s = solveTwoBoneIK(target, L1, L2);
    expect(s.clamped).toBe(false);
    expect(s.midFlex).toBeLessThan(-0.05);
    expect(tipOf(s, L1, L2).distanceTo(target)).toBeLessThan(1e-6);
  });

  it('alvo além do alcance: clampa na extensão máxima apontando para o alvo', () => {
    const target = new THREE.Vector3(0, -2, 0.5);
    const s = solveTwoBoneIK(target, L1, L2);
    expect(s.clamped).toBe(true);
    const tip = tipOf(s, L1, L2);
    expect(tip.length()).toBeCloseTo(L1 + L2, 6);
    expect(tip.clone().normalize().dot(target.clone().normalize())).toBeCloseTo(1, 5);
  });

  it('alvo espelhado em x espelha o yaw sem mudar a flexão', () => {
    const a = solveTwoBoneIK({ x: 0.1, y: -0.3, z: 0.15 }, L1, L2);
    const b = solveTwoBoneIK({ x: -0.1, y: -0.3, z: 0.15 }, L1, L2);
    expect(b.rootYaw).toBeCloseTo(-a.rootYaw, 6);
    expect(b.midFlex).toBeCloseTo(a.midFlex, 6);
  });

  it('alvo degenerado na origem: sem NaN e flexão forte', () => {
    const s = solveTwoBoneIK({ x: 0, y: 0, z: 0 }, L1, L2);
    expect(Number.isFinite(s.rootPitch)).toBe(true);
    expect(Number.isFinite(s.rootYaw)).toBe(true);
    expect(Number.isFinite(s.midFlex)).toBe(true);
    expect(s.clamped).toBe(true);
    expect(s.midFlex).toBeLessThan(-1.5);
  });
});
