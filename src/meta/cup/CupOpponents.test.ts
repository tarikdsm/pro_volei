import { describe, expect, it } from 'vitest';
import { CUP_OPPONENTS } from './CupOpponents';

describe('CUP_OPPONENTS', () => {
  it('define a progressão Normal, Normal, Difícil, Difícil com identidades únicas', () => {
    expect(CUP_OPPONENTS).toHaveLength(4);
    expect(CUP_OPPONENTS.map((opponent) => opponent.difficulty)).toEqual([1, 1, 2, 2]);
    expect(CUP_OPPONENTS.map((opponent) => opponent.identity)).toEqual([
      'saque',
      'velocidade',
      'bloqueio',
      'leitura',
    ]);
    expect(new Set(CUP_OPPONENTS.map((opponent) => opponent.rewardId)).size).toBe(4);
  });

  it('expõe apenas vieses estratégicos limitados, sem parâmetros físicos', () => {
    for (const opponent of CUP_OPPONENTS) {
      const serialized = JSON.stringify(opponent.tactics);
      expect(serialized).not.toMatch(/power|gravity|speed|reach|error|format/i);
      for (const bias of Object.values(opponent.tactics.familyBias ?? {}).flatMap((entry) =>
        Object.values(entry ?? {}),
      )) {
        expect(Math.abs(bias)).toBeLessThanOrEqual(0.12);
      }
      for (const bias of Object.values(opponent.tactics.optionBias ?? {})) {
        expect(Math.abs(bias)).toBeLessThanOrEqual(0.12);
      }
    }
  });
});
