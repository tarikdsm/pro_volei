import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Effects } from './Effects';

// Recupera o THREE.Points do pool de partículas (é filho público de effects.group).
function getPoints(effects: Effects): THREE.Points {
  const pts = effects.group.children.find((c) => c instanceof THREE.Points);
  if (!pts) throw new Error('pool de partículas não encontrado no grupo');
  return pts as THREE.Points;
}

function positionAttr(pts: THREE.Points): THREE.BufferAttribute {
  return pts.geometry.getAttribute('position') as THREE.BufferAttribute;
}

// Acesso ao array privado só para validar a integridade do swap-remove.
function particleCount(effects: Effects): number {
  return (effects as unknown as { particles: unknown[] }).particles.length;
}

describe('Effects — upload de buffer sob demanda (B11)', () => {
  it('sem partículas não re-envia o buffer à GPU', () => {
    const effects = new Effects();
    const pts = getPoints(effects);
    const pos = positionAttr(pts);
    const v = pos.version;
    effects.update(0.016);
    // guard if (n > 0) impede o needsUpdate ocioso => version não muda
    expect(pos.version).toBe(v);
    expect(pts.geometry.drawRange.count).toBe(0);
  });

  it('com partículas sinaliza upload e ajusta o drawRange', () => {
    const effects = new Effects();
    const pts = getPoints(effects);
    const pos = positionAttr(pts);
    effects.burst(new THREE.Vector3(0, 1, 0), 0xffffff, 5, 4);
    const v = pos.version;
    effects.update(0.016);
    // life >= 0.55, então nenhuma morre no 1º frame; buffer é reenviado
    expect(pos.version).toBeGreaterThan(v);
    expect(pts.geometry.drawRange.count).toBe(5);
  });

  it('swap-remove não perde nem duplica quando todas expiram', () => {
    const effects = new Effects();
    const pts = getPoints(effects);
    effects.burst(new THREE.Vector3(0, 1, 0), 0xffffff, 5, 4);
    effects.update(2.0); // dt grande mata todas (life <= 0.85)
    expect(pts.geometry.drawRange.count).toBe(0);
    expect(particleCount(effects)).toBe(0);
  });

  it('volta a não re-enviar o buffer depois que todas expiram', () => {
    const effects = new Effects();
    const pts = getPoints(effects);
    const pos = positionAttr(pts);
    effects.burst(new THREE.Vector3(0, 1, 0), 0xffffff, 5, 4);
    effects.update(2.0); // zera as partículas
    const v2 = pos.version;
    effects.update(0.016);
    expect(pos.version).toBe(v2);
    expect(pts.geometry.drawRange.count).toBe(0);
  });

  it('swap-remove mantém a contagem exata quando só parte das partículas expira', () => {
    // Math.random fixo => life determinística de 0.70 (0.55 + 0.5 * 0.3) para todas.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const effects = new Effects();
    const pts = getPoints(effects);
    effects.burst(new THREE.Vector3(0, 1, 0), 0xffffff, 3, 4); // lote A: 3 partículas
    effects.update(0.4); // A envelhece para 0.40 (< 0.70, seguem vivas)
    effects.burst(new THREE.Vector3(0, 1, 0), 0x00ff00, 4, 4); // lote B: 4 partículas (age 0)
    effects.update(0.35); // A -> 0.75 (morre); B -> 0.35 (vive)
    // sobram exatamente as 4 do lote B, sem perda nem duplicação
    expect(pts.geometry.drawRange.count).toBe(4);
    expect(particleCount(effects)).toBe(4);
    rnd.mockRestore();
  });
});
