import { describe, it, expect } from 'vitest';
import { ZONE_A11Y, ZONE_CODES } from './HUD';

// Trava a rotulagem de acessibilidade das zonas de ataque tocáveis e o alinhamento
// índice → código de tecla, sem precisar de DOM (ver HUD.ts).
describe('ZONE_A11Y — rótulos das zonas de ataque tocáveis', () => {
  it('tem três rótulos alinhados aos três códigos de tecla', () => {
    expect(ZONE_A11Y).toHaveLength(3);
    expect(ZONE_CODES).toHaveLength(3);
  });

  it('cada rótulo é não vazio e em pt-BR (contém "atacar")', () => {
    for (const label of ZONE_A11Y) {
      expect(label).toMatch(/\S/);
      expect(label.toLowerCase()).toContain('atacar');
    }
  });

  it('alinha índice → código: 0=KeyA/esquerda, 1=KeyW/centro, 2=KeyD/direita', () => {
    expect(ZONE_CODES).toEqual(['KeyA', 'KeyW', 'KeyD']);
    expect(ZONE_A11Y[0].toLowerCase()).toContain('esquerda');
    expect(ZONE_A11Y[1].toLowerCase()).toContain('centro');
    expect(ZONE_A11Y[2].toLowerCase()).toContain('direita');
  });
});
