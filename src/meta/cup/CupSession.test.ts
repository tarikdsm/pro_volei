import { describe, expect, it } from 'vitest';
import {
  createSaveRepository,
  SAVE_KEY,
  type SaveStorage,
} from '../../platform/save/SaveRepository';
import { CupSession, type CupMatchStats } from './CupSession';

const STATS: CupMatchStats = {
  points: [22, 14],
  aces: 3,
  blocks: 2,
  longestRally: 11,
};

function memoryStorage(): SaveStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('CupSession', () => {
  it('persiste vitória, estatísticas e recompensa antes de devolver next', () => {
    const storage = memoryStorage();
    const repository = createSaveRepository(storage);
    const session = new CupSession(repository);
    const match = session.startCurrent();
    if (!match) throw new Error('confronto esperado');

    const first = session.recordResult(match.token, true, STATS);
    const duplicate = session.recordResult(match.token, true, STATS);
    const saved = JSON.parse(storage.values.get(SAVE_KEY) ?? '{}');

    expect(first.status).toBe('next');
    expect(duplicate).toBe(first);
    expect(saved.cup.currentRound).toBe(1);
    expect(saved.stats).toMatchObject({ matches: 1, wins: 1, losses: 0, pointsFor: 22 });
    expect(saved.unlocks.unlocked).toContain(match.opponent.rewardId);
  });

  it('derrota mantém confronto, incrementa tentativas e sobrevive ao reload', () => {
    const storage = memoryStorage();
    const first = new CupSession(createSaveRepository(storage));
    const match = first.startCurrent();
    if (!match) throw new Error('confronto esperado');

    expect(first.recordResult(match.token, false, STATS).status).toBe('retry');
    const resumed = new CupSession(createSaveRepository(storage));
    expect(resumed.startCurrent()).toMatchObject({
      opponent: { id: match.opponent.id },
      lossCount: 1,
    });
    expect(resumed.snapshot().stats).toMatchObject({ matches: 1, wins: 0, losses: 1 });
  });

  it('conclui quatro vitórias, fica terminal e permite reiniciar', () => {
    const repository = createSaveRepository(memoryStorage());
    const session = new CupSession(repository);
    for (let round = 0; round < 4; round++) {
      const match = session.startCurrent();
      if (!match) throw new Error('confronto esperado');
      expect(session.recordResult(match.token, true, STATS).status).toBe(
        round === 3 ? 'champion' : 'next',
      );
    }

    expect(session.startCurrent()).toBeNull();
    session.restart();
    expect(session.startCurrent()?.opponent.id).toBe('ondas-do-saque');
    expect(session.snapshot().stats.matches).toBe(4);
  });
});
