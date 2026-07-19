import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from './AudioSettings';

describe('normalizeAudioSettings', () => {
  it('limita canais ao intervalo 0..1 e recupera valores não finitos', () => {
    expect(
      normalizeAudioSettings({ master: 2, effects: -1, crowd: 0.4, music: Number.NaN }),
    ).toEqual({ master: 1, effects: 0, crowd: 0.4, music: DEFAULT_AUDIO_SETTINGS.music });
  });

  it('retorna defaults para payload ausente ou estruturalmente inválido', () => {
    expect(normalizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(normalizeAudioSettings('alto')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe('persistência segura de áudio', () => {
  it('carrega JSON válido e salva a forma normalizada', () => {
    const storage = {
      getItem: vi.fn(() => '{"master":0.2,"effects":0.3,"crowd":0.4,"music":0.5}'),
      setItem: vi.fn(),
    };

    expect(loadAudioSettings(storage)).toEqual({
      master: 0.2,
      effects: 0.3,
      crowd: 0.4,
      music: 0.5,
    });
    saveAudioSettings(storage, { master: 2, effects: 0.3, crowd: 0.4, music: 0.5 });
    expect(storage.setItem).toHaveBeenCalledWith(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ master: 1, effects: 0.3, crowd: 0.4, music: 0.5 }),
    );
  });

  it('usa defaults quando storage está corrompido ou bloqueado e nunca propaga escrita', () => {
    const corrupt = { getItem: () => '{', setItem: () => {} };
    const blocked = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };

    expect(loadAudioSettings(corrupt)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(blocked)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => saveAudioSettings(blocked, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
  });
});
