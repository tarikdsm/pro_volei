import { describe, it, expect } from 'vitest';
import { stickKeys } from './touchMapping';

const R = 52; // mesmo raio usado em TouchControls.updateStick
const FAR = 40; // > limiar (0.35 * 52 ≈ 18.2)
const NEAR = 10; // < limiar (zona morta)

describe('stickKeys — câmera broadcast (serveCam=false)', () => {
  it('direita da tela (dx>0) → KeyW (rumo à rede)', () => {
    expect(stickKeys(FAR, 0, R, false).has('KeyW')).toBe(true);
  });
  it('esquerda da tela (dx<0) → KeyS', () => {
    expect(stickKeys(-FAR, 0, R, false).has('KeyS')).toBe(true);
  });
  it('baixo da tela (dy>0) → KeyD (mundo +z)', () => {
    expect(stickKeys(0, FAR, R, false).has('KeyD')).toBe(true);
  });
  it('cima da tela (dy<0) → KeyA', () => {
    expect(stickKeys(0, -FAR, R, false).has('KeyA')).toBe(true);
  });
});

describe('stickKeys — câmera de saque (serveCam=true)', () => {
  it('cima (dy<0) → KeyW (mais fundo)', () => {
    expect(stickKeys(0, -FAR, R, true).has('KeyW')).toBe(true);
  });
  it('direita (dx>0) → KeyD', () => {
    expect(stickKeys(FAR, 0, R, true).has('KeyD')).toBe(true);
  });
});

describe('stickKeys — limiar e diagonais', () => {
  it('dentro do limiar (|d| < 0.35*R) não sintetiza tecla', () => {
    expect(stickKeys(NEAR, NEAR, R, false).size).toBe(0);
    expect(stickKeys(NEAR, NEAR, R, true).size).toBe(0);
  });

  it('diagonal acima do limiar em ambos os eixos sintetiza duas teclas', () => {
    const keys = stickKeys(FAR, FAR, R, false); // dx>0 → KeyW, dy>0 → KeyD
    expect(keys.size).toBe(2);
    expect(keys.has('KeyW')).toBe(true);
    expect(keys.has('KeyD')).toBe(true);
  });
});
