import { describe, it, expect } from 'vitest';
import { TOUCH_A11Y } from './TouchControls';

// Trava a rotulagem de acessibilidade dos controles de toque contra regressão, sem precisar
// de DOM: os atributos são aplicados a partir deste mapa exportado (ver TouchControls.ts).
describe('TOUCH_A11Y — rótulos de acessibilidade dos controles de toque', () => {
  it('cobre os três controles de toque (stick, ação, pausa)', () => {
    expect(Object.keys(TOUCH_A11Y).sort()).toEqual(['tc-action', 'tc-pause', 'tc-stick']);
  });

  it('todo controle tem role e aria-label não vazios', () => {
    for (const { role, ariaLabel } of Object.values(TOUCH_A11Y)) {
      expect(role).toMatch(/\S/);
      expect(ariaLabel).toMatch(/\S/);
    }
  });

  it('tc-action é role="button" com rótulo em pt-BR', () => {
    expect(TOUCH_A11Y['tc-action'].role).toBe('button');
    expect(TOUCH_A11Y['tc-action'].ariaLabel.toLowerCase()).toContain('sacar');
  });

  it('tc-pause é role="button" rotulado como pausar', () => {
    expect(TOUCH_A11Y['tc-pause'].role).toBe('button');
    expect(TOUCH_A11Y['tc-pause'].ariaLabel.toLowerCase()).toContain('pausar');
  });

  it('tc-stick é rotulado como direcional de movimento', () => {
    expect(TOUCH_A11Y['tc-stick'].role).toMatch(/\S/);
    expect(TOUCH_A11Y['tc-stick'].ariaLabel.toLowerCase()).toContain('direcional');
  });
});
