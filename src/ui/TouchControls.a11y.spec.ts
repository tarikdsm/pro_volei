import { describe, it, expect } from 'vitest';
import { TOUCH_A11Y } from './TouchControls';

// Trava a rotulagem de acessibilidade dos controles de toque contra regressão, sem precisar
// de DOM: os atributos são aplicados a partir deste mapa exportado (ver TouchControls.ts).
describe('TOUCH_A11Y — rótulos de acessibilidade dos controles de toque', () => {
  it('cobre apenas ação e movimento; portrait substitui a pausa mobile', () => {
    expect(Object.keys(TOUCH_A11Y).sort()).toEqual(['tc-action-zone', 'tc-move-zone']);
  });

  it('todo controle tem role e aria-label não vazios', () => {
    for (const { role, ariaLabel } of Object.values(TOUCH_A11Y)) {
      expect(role).toMatch(/\S/);
      expect(ariaLabel).toMatch(/\S/);
    }
  });

  it('a zona de ação é role="button" com rótulo em pt-BR', () => {
    expect(TOUCH_A11Y['tc-action-zone'].role).toBe('button');
    expect(TOUCH_A11Y['tc-action-zone'].ariaLabel.toLowerCase()).toContain('sacar');
  });

  it('a zona direita é rotulada como direcional de movimento', () => {
    expect(TOUCH_A11Y['tc-move-zone'].role).toMatch(/\S/);
    expect(TOUCH_A11Y['tc-move-zone'].ariaLabel.toLowerCase()).toContain('direcional');
  });
});
