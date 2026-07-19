import { describe, expect, it } from 'vitest';
import { createDefaultSave } from './SaveSchema';
import { createSaveRepository, SAVE_KEY, type SaveStorage } from './SaveRepository';

class MemoryStorage implements SaveStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('SaveRepository', () => {
  it('carrega, atualiza e persiste snapshot normalizado', () => {
    const storage = new MemoryStorage();
    const repository = createSaveRepository(storage);

    const updated = repository.update((current) => ({
      ...current,
      preferences: { ...current.preferences, difficulty: 2 },
      stats: { ...current.stats, matches: 1, wins: 1 },
    }));

    expect(updated.preferences.difficulty).toBe(2);
    expect(JSON.parse(storage.data.get(SAVE_KEY)!)).toMatchObject({
      version: 1,
      preferences: { difficulty: 2 },
      stats: { matches: 1, wins: 1 },
    });
    expect(createSaveRepository(storage).snapshot()).toEqual(updated);
  });

  it('migra áudio legado somente quando não há save canônico', () => {
    const storage = new MemoryStorage();
    const legacy = { master: 0.1, effects: 0.2, crowd: 0.3, music: 0.4 };
    const migrated = createSaveRepository(storage, { legacyAudio: legacy }).snapshot();

    expect(migrated.preferences.audio).toEqual(legacy);
    expect(storage.data.has(SAVE_KEY)).toBe(true);

    storage.data.set(SAVE_KEY, JSON.stringify(createDefaultSave()));
    expect(
      createSaveRepository(storage, { legacyAudio: legacy }).snapshot().preferences.audio,
    ).toEqual(createDefaultSave().preferences.audio);
  });

  it('recupera JSON corrompido e storage bloqueado sem lançar', () => {
    const corrupt = new MemoryStorage();
    corrupt.data.set(SAVE_KEY, '{');
    expect(createSaveRepository(corrupt).snapshot()).toEqual(createDefaultSave());

    const blocked: SaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const repository = createSaveRepository(blocked);
    expect(() =>
      repository.update((save) => ({ ...save, stats: { ...save.stats, matches: 1 } })),
    ).not.toThrow();
    expect(repository.snapshot().stats.matches).toBe(1);
  });

  it('resetProgress limpa Copa/stats/unlocks e preserva preferências', () => {
    const repository = createSaveRepository(new MemoryStorage());
    repository.update((save) => ({
      ...save,
      preferences: { ...save.preferences, difficulty: 2, hudScale: 1.15 },
      cup: { currentRound: 3, completed: false, attempts: [1, 1, 1, 0] },
      stats: { ...save.stats, matches: 5, wins: 3, losses: 2 },
      unlocks: {
        unlocked: [...save.unlocks.unlocked, 'uniform.aurora'],
        selected: { ...save.unlocks.selected, uniform: 'uniform.aurora' },
      },
    }));

    const reset = repository.resetProgress();
    expect(reset.preferences).toMatchObject({ difficulty: 2, hudScale: 1.15 });
    expect(reset.cup).toEqual(createDefaultSave().cup);
    expect(reset.stats).toEqual(createDefaultSave().stats);
    expect(reset.unlocks).toEqual(createDefaultSave().unlocks);
  });
});
