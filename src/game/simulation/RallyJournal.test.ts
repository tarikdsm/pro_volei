import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import { RallyJournal } from './RallyJournal';

const draws = { rules: 1, ai: 2, contact: 3, control: 0 } as const;

describe('RallyJournal', () => {
  it('quantiza e copia eventos sem reter payload mutável', () => {
    const journal = new RallyJournal({ seed: 7, difficulty: 1, format: 0 });
    const target = { x: 1.23456, y: 0, z: -2.34567 };

    journal.emit({
      type: 'serve',
      tick: 42,
      draws,
      side: TeamSide.HOME,
      athlete: 2,
      power: 0.87654,
      target,
      clearance: 0.33333,
    });
    target.x = 99;

    expect(journal.entries).toEqual([
      {
        rally: 0,
        tick: 42,
        type: 'serve',
        draws: [1, 2, 3, 0],
        data: ['home', 2, 8765, 1235, 0, -2346, 333],
      },
    ]);
    expect(Object.isFrozen(journal.entries[0])).toBe(true);
    expect(Object.isFrozen(journal.entries[0].data)).toBe(true);
  });

  it('serialização e hash são idênticos para a mesma sequência e mudam com o conteúdo', () => {
    const make = (winner: TeamSide): RallyJournal => {
      const journal = new RallyJournal({ seed: 7, difficulty: 1, format: 0 });
      journal.emit({
        type: 'point',
        tick: 120,
        draws,
        winner,
        cause: 'floor-out',
        ace: false,
        score: winner === TeamSide.HOME ? [1, 0] : [0, 1],
        lastTouchSide: TeamSide.AWAY,
        lastKind: 'spike',
      });
      return journal;
    };

    const first = make(TeamSide.HOME);
    const same = make(TeamSide.HOME);
    const other = make(TeamSide.AWAY);

    expect(first.serialize()).toBe(same.serialize());
    expect(first.hash()).toBe(same.hash());
    expect(first.hash()).not.toBe(other.hash());
  });
});
