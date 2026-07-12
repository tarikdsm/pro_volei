import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ballisticArc,
  positionAt,
  timeToHeight,
  integrateBallistic,
  clamp,
  lerp,
  lerpAngle,
  easeOutCubic,
  easeInOutCubic,
} from './math3d';
import { GRAVITY } from './constants';

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

describe('lerpAngle', () => {
  it('usa o menor arco ao atravessar a fronteira ±π', () => {
    const from = Math.PI - 0.1;
    const to = -Math.PI + 0.1;

    expect(Math.abs(lerpAngle(from, to, 0.5))).toBeCloseTo(Math.PI);
    expect(lerpAngle(from, to, 0)).toBeCloseTo(from);
    expect(lerpAngle(from, to, 1)).toBeCloseTo(Math.PI + 0.1);
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

describe('integrateBallistic', () => {
  // A integração passo-a-passo deve coincidir com a forma analítica positionAt
  // para qualquer dt — é o que garante que a bola real pousa/cruza a rede onde
  // as previsões (predictLanding, computeNetCrossing) já indicam. O antigo Euler
  // semi-implícito acumulava erro 0.5*g*T*dt e deixaria a bola mais baixa.
  it('coincide com positionAt integrando a 60 fps (T=1.5)', () => {
    const p0 = new THREE.Vector3(-6, 2.3, 3);
    const v0 = new THREE.Vector3(4, 8, -1);
    const pos = p0.clone();
    const vel = v0.clone();
    const dt = 1 / 60;
    for (let i = 0; i < 90; i++) integrateBallistic(pos, vel, dt); // T = 90/60 = 1.5s
    const expected = positionAt(p0, v0, 1.5, new THREE.Vector3());
    expect(pos.x).toBeCloseTo(expected.x, 6);
    expect(pos.y).toBeCloseTo(expected.y, 6);
    expect(pos.z).toBeCloseTo(expected.z, 6);
  });

  it('coincide com positionAt mesmo no cap de dt=0.05 (T=1.5)', () => {
    const p0 = new THREE.Vector3(-6, 2.3, 3);
    const v0 = new THREE.Vector3(4, 8, -1);
    const pos = p0.clone();
    const vel = v0.clone();
    const dt = 0.05;
    for (let i = 0; i < 30; i++) integrateBallistic(pos, vel, dt); // T = 30*0.05 = 1.5s
    const expected = positionAt(p0, v0, 1.5, new THREE.Vector3());
    expect(pos.x).toBeCloseTo(expected.x, 6);
    expect(pos.y).toBeCloseTo(expected.y, 6);
    expect(pos.z).toBeCloseTo(expected.z, 6);
  });

  it('atualiza a velocidade vertical corretamente (vy = v0y + g*T)', () => {
    const v0 = new THREE.Vector3(4, 8, -1);
    const pos = new THREE.Vector3(-6, 2.3, 3);
    const vel = v0.clone();
    const dt = 1 / 60;
    for (let i = 0; i < 90; i++) integrateBallistic(pos, vel, dt);
    expect(vel.y).toBeCloseTo(v0.y + GRAVITY * 1.5, 6);
    expect(vel.x).toBeCloseTo(v0.x, 6); // horizontais intactas (sem aceleração)
    expect(vel.z).toBeCloseTo(v0.z, 6);
  });

  it('integra x e z de forma exata mesmo com velocidade horizontal', () => {
    const p0 = new THREE.Vector3(1, 0.5, -2);
    const v0 = new THREE.Vector3(-3, 5, 2.5);
    const pos = p0.clone();
    const vel = v0.clone();
    const dt = 0.05;
    for (let i = 0; i < 20; i++) integrateBallistic(pos, vel, dt); // T = 1.0s
    const expected = positionAt(p0, v0, 1.0, new THREE.Vector3());
    expect(pos.x).toBeCloseTo(expected.x, 6);
    expect(pos.z).toBeCloseTo(expected.z, 6);
    expect(pos.y).toBeCloseTo(expected.y, 6);
  });
});
