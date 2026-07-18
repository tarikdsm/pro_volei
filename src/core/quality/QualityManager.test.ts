import { describe, expect, it } from 'vitest';
import { QualityManager } from './QualityManager';

/** Alimenta N frames com o mesmo dt (s) e avalia na "fronteira de ponto". */
function feedAndEvaluate(manager: QualityManager, dt: number, frames = 200): number | null {
  for (let i = 0; i < frames; i += 1) manager.sampleFrame(dt);
  return manager.evaluateAtBreak();
}

describe('QualityManager', () => {
  it('mantém o tier com frame time saudável intermediário', () => {
    const manager = new QualityManager(1);
    expect(feedAndEvaluate(manager, 1 / 50)).toBe(null); // 20 ms: nem sobe nem desce
    expect(manager.tier).toBe(1);
  });

  it('desce um tier após duas avaliações ruins seguidas (não na primeira)', () => {
    const manager = new QualityManager(2);
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // 1ª avaliação ruim: ainda segura
    expect(feedAndEvaluate(manager, 0.05)).toBe(1); // 2ª seguida: desce
    expect(manager.tier).toBe(1);
  });

  it('sobe somente após quatro avaliações boas seguidas', () => {
    const manager = new QualityManager(0);
    expect(feedAndEvaluate(manager, 1 / 120)).toBe(null);
    expect(feedAndEvaluate(manager, 1 / 120)).toBe(null);
    expect(feedAndEvaluate(manager, 1 / 120)).toBe(null);
    expect(feedAndEvaluate(manager, 1 / 120)).toBe(1);
    expect(manager.tier).toBe(1);
  });

  it('cooldown: depois de trocar, segura por duas avaliações mesmo com sinal', () => {
    const manager = new QualityManager(2);
    feedAndEvaluate(manager, 0.05);
    expect(feedAndEvaluate(manager, 0.05)).toBe(1); // trocou
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // cooldown 1
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // cooldown 2
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // 1ª ruim pós-cooldown
    expect(feedAndEvaluate(manager, 0.05)).toBe(0); // 2ª ruim: desce de novo
  });

  it('clampa nos extremos: não desce abaixo de 0 nem sobe acima de 2', () => {
    const low = new QualityManager(0);
    feedAndEvaluate(low, 0.05);
    expect(feedAndEvaluate(low, 0.05)).toBe(null); // já no piso
    const high = new QualityManager(2);
    for (let i = 0; i < 6; i += 1) feedAndEvaluate(high, 1 / 120);
    expect(high.tier).toBe(2); // já no teto
  });

  it('sequência ruim interrompida por avaliação boa zera o contador de descida', () => {
    const manager = new QualityManager(2);
    expect(feedAndEvaluate(manager, 0.05)).toBe(null);
    expect(feedAndEvaluate(manager, 1 / 60)).toBe(null); // boa/neutra: quebra a sequência
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // recomeça a contagem
    expect(feedAndEvaluate(manager, 0.05)).toBe(1);
  });

  it('resetWindow descarta amostras e sequências acumuladas', () => {
    const manager = new QualityManager(2);
    feedAndEvaluate(manager, 0.05); // 1ª avaliação ruim (streak 1)
    for (let i = 0; i < 200; i += 1) manager.sampleFrame(0.05);
    manager.resetWindow();
    expect(manager.evaluateAtBreak()).toBe(null); // sem amostras: neutra
    expect(feedAndEvaluate(manager, 0.05)).toBe(null); // streak recomeçou do zero
    expect(feedAndEvaluate(manager, 0.05)).toBe(1);
  });

  it('avaliação sem amostras suficientes é neutra', () => {
    const manager = new QualityManager(1);
    manager.sampleFrame(0.05);
    expect(manager.evaluateAtBreak()).toBe(null);
    expect(manager.tier).toBe(1);
  });
});
