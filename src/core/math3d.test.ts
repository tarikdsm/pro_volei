import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ballisticArc,
  positionAt,
  timeToHeight,
  clamp,
  lerp,
  easeOutCubic,
  easeInOutCubic,
} from './math3d';

describe('clamp', () => {
  it('mantém valores dentro do intervalo', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpola linearmente', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('easing', () => {
  it('respeita os pontos de borda', () => {
    expect(easeOutCubic(0)).toBeCloseTo(0);
    expect(easeOutCubic(1)).toBeCloseTo(1);
    expect(easeInOutCubic(0)).toBeCloseTo(0);
    expect(easeInOutCubic(1)).toBeCloseTo(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
});

describe('ballisticArc', () => {
  it('faz a bola chegar exatamente no alvo ao fim do voo', () => {
    const p0 = new THREE.Vector3(-6, 2.3, 3);
    const target = new THREE.Vector3(4, 1, -2);
    const { v0, time } = ballisticArc(p0, target, 3);
    const landing = positionAt(p0, v0, time, new THREE.Vector3());
    expect(landing.x).toBeCloseTo(target.x, 4);
    expect(landing.y).toBeCloseTo(target.y, 4);
    expect(landing.z).toBeCloseTo(target.z, 4);
    expect(time).toBeGreaterThan(0);
  });

  it('passa por um ápice acima das duas pontas', () => {
    const p0 = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(5, 1, 0);
    const { v0, time } = ballisticArc(p0, target, 2);
    const mid = positionAt(p0, v0, time / 2, new THREE.Vector3());
    expect(mid.y).toBeGreaterThan(1);
  });
});

describe('timeToHeight', () => {
  it('encontra o instante de descida até uma altura', () => {
    const pos = new THREE.Vector3(0, 3, 0);
    const vel = new THREE.Vector3(0, 0, 0); // queda livre
    const t = timeToHeight(pos, vel, 1);
    expect(t).toBeGreaterThan(0);
    const landing = positionAt(pos, vel, t, new THREE.Vector3());
    expect(landing.y).toBeCloseTo(1, 4);
  });

  it('retorna -1 quando a altura nunca é alcançada', () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const vel = new THREE.Vector3(0, 1, 0); // subindo devagar, gravidade puxa de volta
    expect(timeToHeight(pos, vel, 100)).toBe(-1);
  });
});
