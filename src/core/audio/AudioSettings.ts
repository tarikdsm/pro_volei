export interface AudioSettings {
  readonly master: number;
  readonly effects: number;
  readonly crowd: number;
  readonly music: number;
}

export interface AudioSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AUDIO_SETTINGS_KEY = 'pro-volei.audio.v1';
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = Object.freeze({
  master: 0.7,
  effects: 1,
  crowd: 0.6,
  music: 0.55,
});

export function normalizeAudioSettings(value: unknown): AudioSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }

  const candidate = value as Partial<Record<keyof AudioSettings, unknown>>;
  return {
    master: normalizeChannel(candidate.master, DEFAULT_AUDIO_SETTINGS.master),
    effects: normalizeChannel(candidate.effects, DEFAULT_AUDIO_SETTINGS.effects),
    crowd: normalizeChannel(candidate.crowd, DEFAULT_AUDIO_SETTINGS.crowd),
    music: normalizeChannel(candidate.music, DEFAULT_AUDIO_SETTINGS.music),
  };
}

export function loadAudioSettings(storage: AudioSettingsStorage | null | undefined): AudioSettings {
  if (!storage) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const serialized = storage.getItem(AUDIO_SETTINGS_KEY);
    return serialized === null
      ? { ...DEFAULT_AUDIO_SETTINGS }
      : normalizeAudioSettings(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(
  storage: AudioSettingsStorage | null | undefined,
  settings: AudioSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(normalizeAudioSettings(settings)));
  } catch {
    // Storage bloqueado/cheio não pode interromper o jogo.
  }
}

function normalizeChannel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
