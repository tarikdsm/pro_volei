import { describe, expect, it } from 'vitest';
import { advanceCup, normalizeCupProgress, restartCup } from './Cup';

describe('Cup', () => {
  it('avança pelos quatro confrontos e torna a campeã terminal', () => {
    let progress = normalizeCupProgress(undefined);
    for (let round = 0; round < 4; round++) {
      const result = advanceCup(progress, true);
      progress = result.progress;
      expect(progress.currentRound).toBe(round + 1);
      expect(result.status).toBe(round === 3 ? 'champion' : 'next');
    }

    expect(progress.completed).toBe(true);
    expect(advanceCup(progress, true).progress).toEqual(progress);
    expect(advanceCup(progress, false).progress).toEqual(progress);
  });

  it('mantém o confronto e registra derrotas como tentativas', () => {
    const first = advanceCup(normalizeCupProgress(undefined), false);
    const second = advanceCup(first.progress, false);

    expect(first.status).toBe('retry');
    expect(second.progress).toEqual({ currentRound: 0, completed: false, attempts: [2, 0, 0, 0] });
  });

  it('normaliza dados inválidos e reinicia a chave', () => {
    expect(
      normalizeCupProgress({ currentRound: 99, completed: false, attempts: [-1, 2.8] }),
    ).toEqual({ currentRound: 4, completed: true, attempts: [0, 2, 0, 0] });
    expect(restartCup()).toEqual({ currentRound: 0, completed: false, attempts: [0, 0, 0, 0] });
  });
});
