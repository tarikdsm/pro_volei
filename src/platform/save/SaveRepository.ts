import { normalizeAudioSettings, type AudioSettings } from '../../core/audio/AudioSettings';
import { migrateSave } from './SaveMigrations';
import { createDefaultSave, normalizeSaveV1, type ProVoleiSaveV1 } from './SaveSchema';

export const SAVE_KEY = 'pro-volei.save.v1';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveRepositoryOptions {
  readonly legacyAudio?: AudioSettings;
}

export interface SaveRepository {
  snapshot(): Readonly<ProVoleiSaveV1>;
  update(recipe: (current: Readonly<ProVoleiSaveV1>) => ProVoleiSaveV1): Readonly<ProVoleiSaveV1>;
  resetProgress(): Readonly<ProVoleiSaveV1>;
}

export function createSaveRepository(
  storage: SaveStorage | null | undefined,
  options: SaveRepositoryOptions = {},
): SaveRepository {
  let serialized: string | null = null;
  try {
    serialized = storage?.getItem(SAVE_KEY) ?? null;
  } catch {
    // Storage bloqueado: o snapshot em memória continua disponível.
  }

  let current = serialized === null ? createDefaultSave() : migrateSave(serialized);
  if (serialized === null && options.legacyAudio) {
    current = normalizeSaveV1({
      ...current,
      preferences: {
        ...current.preferences,
        audio: normalizeAudioSettings(options.legacyAudio),
      },
    });
  }

  const persist = (): void => {
    try {
      storage?.setItem(SAVE_KEY, JSON.stringify(current));
    } catch {
      // Quota/política privada não pode invalidar o estado já normalizado em memória.
    }
  };
  if (serialized === null) persist();

  return {
    snapshot: () => current,
    update: (recipe) => {
      current = normalizeSaveV1(recipe(current));
      persist();
      return current;
    },
    resetProgress: () => {
      const defaults = createDefaultSave();
      current = normalizeSaveV1({
        ...defaults,
        preferences: current.preferences,
      });
      persist();
      return current;
    },
  };
}
