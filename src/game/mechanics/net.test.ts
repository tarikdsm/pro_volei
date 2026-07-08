import { describe, it, expect } from 'vitest';
import { computeNetCrossing, netTouchPoint } from './net';
import { COURT } from '../../core/constants';

describe('computeNetCrossing', () => {
  it('sem componente horizontal (vx ~ 0) → não cruza', () => {
    expect(computeNetCrossing({ x: -3, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }).kind).toBe('none');
  });

  it('bola se afastando da rede (tempo negativo) → não cruza', () => {
    // pos.x=-3 com vx negativo: t = -(-3)/(-2) = -1.5 < 0
    expect(computeNetCrossing({ x: -3, y: 2, z: 0 }, { x: -2, y: 0, z: 0 }).kind).toBe('none');
  });

  it('trajetória alta e limpa por cima da rede → cross', () => {
    // t=1; y no cruzamento = 3m, acima do topo da rede (2,43)
    const r = computeNetCrossing({ x: -3, y: 2, z: 0 }, { x: 3, y: 7.5, z: 0 });
    expect(r.kind).toBe('cross');
    if (r.kind !== 'none') expect(r.t).toBeCloseTo(1, 5);
  });

  it('bola na altura da rede → net', () => {
    // t=1; y no cruzamento = 1m, dentro da faixa da rede
    const r = computeNetCrossing({ x: -1, y: 1, z: 0 }, { x: 1, y: 6.5, z: 0 });
    expect(r.kind).toBe('net');
  });

  it('cruza dentro da faixa de altura mas muito para fora em z → cross (passa pela lateral)', () => {
    const z = COURT.halfWidth + 1; // além da largura da rede
    const r = computeNetCrossing({ x: -1, y: 1, z }, { x: 1, y: 6.5, z: 0 });
    expect(r.kind).toBe('cross');
  });
});

describe('netTouchPoint', () => {
  it('para kind "net" leva y e z do cruzamento ao ponto de snap no plano da rede (x = 0)', () => {
    const r = computeNetCrossing({ x: -1, y: 1, z: 0.3 }, { x: 1, y: 6.5, z: 0 });
    expect(r.kind).toBe('net');
    if (r.kind === 'net') {
      expect(typeof r.y).toBe('number');
      expect(typeof r.z).toBe('number');
      const p = netTouchPoint(r);
      expect(p.x).toBe(0); // plano da rede
      expect(p.y).toBeCloseTo(r.y);
      expect(p.z).toBeCloseTo(r.z);
    }
  });
});
