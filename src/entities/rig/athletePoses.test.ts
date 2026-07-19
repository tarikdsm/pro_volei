import { describe, expect, it } from 'vitest';
import { easeOutBack, phase, poseFor } from './athletePoses';
import type { CharAction } from '../PlayerCharacter';

const ACTIONS: CharAction[] = [
  'idle',
  'run',
  'bump',
  'set',
  'spikeWindup',
  'spikeHit',
  'block',
  'serveToss',
  'serveHit',
  'dive',
  'celebrate',
  'dejected',
  'serveUnderhand',
  'land',
];

describe('easings', () => {
  it('phase normaliza e clampa o intervalo', () => {
    expect(phase(0.1, 0.2, 0.4)).toBe(0);
    expect(phase(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(phase(0.9, 0.2, 0.4)).toBe(1);
  });

  it('easeOutBack passa do alvo no meio e termina em 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.02) peak = Math.max(peak, easeOutBack(t));
    expect(peak).toBeGreaterThan(1); // overshoot existe
    expect(peak).toBeLessThan(1.25); // e é contido
  });
});

describe('poseFor', () => {
  it('todas as ações produzem valores finitos em toda a duração', () => {
    for (const action of ACTIONS) {
      for (let t = 0; t <= 1.2; t += 0.05) {
        const p = poseFor(action, t, 1.3, 2.1, 0.7);
        for (const [k, v] of Object.entries(p)) {
          expect(Number.isFinite(v), `${action}.${k}@${t}`).toBe(true);
        }
      }
    }
  });

  it('manchete tem anticipação: o tronco recua antes de estender', () => {
    const early = poseFor('bump', 0.04, 0, 0, 0);
    const late = poseFor('bump', 0.4, 0, 0, 0);
    expect(early.lShX).toBeLessThan(late.lShX);
    expect(late.lShX).toBeGreaterThan(0.9); // extensão final próxima da pose 2.0.0 (1.05)
  });

  it('cortada chicoteia com overshoot e acomoda perto do valor final', () => {
    let peak = -Infinity;
    for (let t = 0; t <= 0.5; t += 0.01)
      peak = Math.max(peak, poseFor('spikeHit', t, 0, 0, 0).rShX);
    const settled = poseFor('spikeHit', 0.5, 0, 0, 0).rShX;
    expect(peak).toBeGreaterThan(settled); // passou do alvo e voltou
    expect(settled).toBeGreaterThan(0.7);
    expect(settled).toBeLessThan(1.3);
  });

  it('bloqueio sobe rápido: braços quase estendidos em 150 ms', () => {
    expect(poseFor('block', 0.15, 0, 0, 0).lShX).toBeGreaterThan(2.4);
  });
});

describe('ações novas (Fase 8)', () => {
  it('saque por baixo balança o braço direito de trás para frente', () => {
    const armed = poseFor('serveUnderhand', 0.2, 0, 0, 0).rShX;
    const swung = poseFor('serveUnderhand', 0.6, 0, 0, 0).rShX;
    expect(armed).toBeLessThan(0); // braço atrás
    expect(swung).toBeGreaterThan(1); // pêndulo à frente
  });

  it('aterrissagem agacha e recupera valores finitos', () => {
    const p = poseFor('land', 0.15, 0, 0, 0);
    expect(p.knees).toBeLessThan(-0.8);
    expect(p.hips).toBeGreaterThan(0.4);
  });
});
