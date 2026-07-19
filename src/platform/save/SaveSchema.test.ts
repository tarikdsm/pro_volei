import { describe, expect, it } from 'vitest';
import {
  BASE_COSMETICS,
  createDefaultSave,
  normalizeSaveV1,
  type ProVoleiSaveV1,
} from './SaveSchema';

describe('SaveSchema', () => {
  it('cria defaults completos e independentes', () => {
    const first = createDefaultSave();
    const second = createDefaultSave();

    expect(first).toMatchObject({
      version: 1,
      preferences: {
        difficulty: 1,
        format: 0,
        hudScale: 1,
        colorPreset: 'default',
        highContrast: false,
        reducedMotion: false,
        shakeEnabled: true,
        replayEnabled: true,
        captionsEnabled: true,
        hapticsEnabled: true,
        timingAssist: 'normal',
        audio: { master: 0.7, effects: 1, crowd: 0.6, music: 0.55 },
      },
      cup: { currentRound: 0, completed: false, attempts: [0, 0, 0, 0] },
      stats: {
        matches: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        aces: 0,
        blocks: 0,
        longestRally: 0,
      },
      unlocks: { unlocked: Object.values(BASE_COSMETICS), selected: BASE_COSMETICS },
    });
    expect(first).not.toBe(second);
    expect(first.preferences).not.toBe(second.preferences);
  });

  it('normaliza números, enums, arrays e seleção bloqueada', () => {
    const normalized = normalizeSaveV1({
      version: 1,
      preferences: {
        difficulty: 99,
        format: 2,
        hudScale: 1.15,
        colorPreset: 'tritan',
        highContrast: true,
        reducedMotion: true,
        shakeEnabled: false,
        replayEnabled: false,
        captionsEnabled: false,
        hapticsEnabled: false,
        timingAssist: 'wide',
        audio: { master: 2, effects: -1, crowd: 0.25, music: Number.NaN },
      },
      cup: { currentRound: 9, completed: false, attempts: [1, -1, 2.8, 'x'] },
      stats: { matches: 3, wins: 9, losses: -1, longestRally: 12.9 },
      unlocks: {
        unlocked: ['uniform.aurora', 'uniform.aurora', 'invalid', BASE_COSMETICS.uniform],
        selected: { uniform: 'uniform.aurora', palette: 'palette.locked', court: 42, effect: null },
      },
    });

    expect(normalized.preferences).toMatchObject({
      difficulty: 1,
      format: 2,
      hudScale: 1.15,
      colorPreset: 'tritan',
      highContrast: true,
      timingAssist: 'wide',
      audio: { master: 1, effects: 0, crowd: 0.25, music: 0.55 },
    });
    expect(normalized.cup).toEqual({ currentRound: 4, completed: true, attempts: [1, 0, 2, 0] });
    expect(normalized.stats).toMatchObject({ matches: 3, wins: 3, losses: 0, longestRally: 12 });
    expect(normalized.unlocks.unlocked).toEqual(
      expect.arrayContaining([...Object.values(BASE_COSMETICS), 'uniform.aurora']),
    );
    expect(normalized.unlocks.selected).toEqual({
      uniform: 'uniform.aurora',
      palette: BASE_COSMETICS.palette,
      court: BASE_COSMETICS.court,
      effect: BASE_COSMETICS.effect,
    });
  });

  it('dados incompatíveis voltam integralmente aos defaults', () => {
    expect(normalizeSaveV1(null)).toEqual(createDefaultSave());
    expect(normalizeSaveV1([])).toEqual(createDefaultSave());
    expect(normalizeSaveV1('save')).toEqual(createDefaultSave());
  });

  it('retorna snapshot profundamente congelado', () => {
    const save = normalizeSaveV1({}) as ProVoleiSaveV1;
    expect(Object.isFrozen(save)).toBe(true);
    expect(Object.isFrozen(save.preferences.audio)).toBe(true);
    expect(Object.isFrozen(save.cup.attempts)).toBe(true);
    expect(Object.isFrozen(save.unlocks.unlocked)).toBe(true);
  });
});
