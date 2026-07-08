import { describe, it, expect } from 'vitest';
import { blockCrossing, blockerReaches, blockProximity, BlockCrossing } from './block';

describe('blockCrossing', () => {
  it('resolve quando/onde a cortada cruza o plano da rede dentro da janela', () => {
    // pos.x=-2, vel.x=10 → t=0.2; y = 2.5 + 1*0.2 + 0.5*(-13)*0.2² = 2.44; z = 0.5
    const c = blockCrossing({ x: -2, y: 2.5, z: 0.5 }, { x: 10, y: 1, z: 0 });
    expect(c).not.toBeNull();
    expect(c!.t).toBeCloseTo(0.2);
    expect(c!.y).toBeCloseTo(2.44);
    expect(c!.z).toBeCloseTo(0.5);
  });

  it('null sem componente horizontal (bola não cruza)', () => {
    expect(blockCrossing({ x: -2, y: 2.5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });

  it('null quando o cruzamento já passou (t ≤ 0)', () => {
    expect(blockCrossing({ x: -2, y: 2.5, z: 0 }, { x: -5, y: 1, z: 0 })).toBeNull();
  });

  it('null quando o cruzamento é tarde demais (fora da janela de 0.8s)', () => {
    expect(blockCrossing({ x: -9, y: 2.5, z: 0 }, { x: 1, y: 1, z: 0 })).toBeNull();
  });
});

describe('blockerReaches', () => {
  const cross: BlockCrossing = { t: 0.2, y: 2.4, z: 0.5 };

  it('alcança: na rede, perto em z e bola dentro do alcance', () => {
    expect(blockerReaches(0.72, 0.6, 0.5, cross)).toBe(true);
  });

  it('não alcança longe da rede (|x| ≥ 1.4)', () => {
    expect(blockerReaches(2.0, 0.6, 0.5, cross)).toBe(false);
  });

  it('não alcança longe em z (zDist > 0.85)', () => {
    expect(blockerReaches(0.72, 2.0, 0.5, cross)).toBe(false);
  });

  it('não alcança bola alta demais (acima do reach)', () => {
    expect(blockerReaches(0.72, 0.6, 0, { t: 0.2, y: 4.0, z: 0.5 })).toBe(false);
  });
});

describe('blockProximity', () => {
  it('1 quando o bloqueador está em cima do ponto de cruzamento', () => {
    expect(blockProximity(0.5, 0.5)).toBeCloseTo(1);
  });

  it('0 no limite do alcance em z (0.85)', () => {
    expect(blockProximity(1.35, 0.5)).toBeCloseTo(0);
  });

  it('0.5 na metade do alcance', () => {
    expect(blockProximity(0.925, 0.5)).toBeCloseTo(0.5);
  });
});
