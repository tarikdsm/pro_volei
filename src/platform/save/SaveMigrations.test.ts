import { describe, expect, it } from 'vitest';
import { createDefaultSave } from './SaveSchema';
import { migrateSave } from './SaveMigrations';

describe('migrateSave', () => {
  it('migra versão 0/sem versão preservando preferências conhecidas', () => {
    const migrated = migrateSave({
      preferences: {
        difficulty: 2,
        format: 1,
        hudScale: 0.85,
        audio: { master: 0.2, effects: 0.3, crowd: 0.4, music: 0.5 },
      },
      cup: { currentRound: 2, attempts: [1, 2, 0, 0] },
    });

    expect(migrated.version).toBe(1);
    expect(migrated.preferences).toMatchObject({ difficulty: 2, format: 1, hudScale: 0.85 });
    expect(migrated.preferences.audio).toEqual({
      master: 0.2,
      effects: 0.3,
      crowd: 0.4,
      music: 0.5,
    });
    expect(migrated.cup.currentRound).toBe(2);
  });

  it('normaliza v1 de forma idempotente', () => {
    const first = migrateSave({
      ...createDefaultSave(),
      preferences: { ...createDefaultSave().preferences, difficulty: 2 },
    });
    expect(migrateSave(first)).toEqual(first);
  });

  it('isola versões futuras, JSON inválido e tipos incompatíveis', () => {
    expect(migrateSave({ version: 99, preferences: { difficulty: 2 } })).toEqual(
      createDefaultSave(),
    );
    expect(migrateSave('{')).toEqual(createDefaultSave());
    expect(migrateSave(42)).toEqual(createDefaultSave());
  });
});
