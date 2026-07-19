import { describe, expect, it } from 'vitest';
import { HUD_SCALES, normalizeHudScale, reduceHint } from './HudPreferences';

describe('reduceHint', () => {
  it('expira a dica depois da janela transitória', () => {
    const shown = reduceHint(
      { text: '', remaining: 0 },
      { type: 'show', text: 'Receba', seconds: 2.5 },
    );

    expect(reduceHint(shown, { type: 'tick', dt: 2.6 })).toEqual({ text: '', remaining: 0 });
  });

  it('preserva a dica enquanto ainda há tempo e ignora dt negativo', () => {
    const state = { text: 'Bloqueie', remaining: 1 };

    expect(reduceHint(state, { type: 'tick', dt: 0.25 })).toEqual({
      text: 'Bloqueie',
      remaining: 0.75,
    });
    expect(reduceHint(state, { type: 'tick', dt: -1 })).toEqual(state);
  });

  it('texto vazio limpa imediatamente a dica', () => {
    expect(
      reduceHint({ text: 'Ataque', remaining: 1 }, { type: 'show', text: '', seconds: 2.5 }),
    ).toEqual({ text: '', remaining: 0 });
  });
});

describe('normalizeHudScale', () => {
  it('aceita somente os três níveis públicos', () => {
    expect(HUD_SCALES).toEqual([0.85, 1, 1.15]);
    expect(normalizeHudScale(0.85)).toBe(0.85);
    expect(normalizeHudScale(1)).toBe(1);
    expect(normalizeHudScale(1.15)).toBe(1.15);
  });

  it('usa escala normal para valores ausentes ou inválidos', () => {
    expect(normalizeHudScale(undefined)).toBe(1);
    expect(normalizeHudScale(2)).toBe(1);
    expect(normalizeHudScale(Number.NaN)).toBe(1);
  });
});
