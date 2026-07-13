import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import type { MatchStats } from '../ports/MatchHooks';
import { createHeadlessHooks } from './HeadlessHooks';

describe('HeadlessHooks', () => {
  it('registra placar e resultado sem depender de browser', () => {
    expect(globalThis.window).toBeUndefined();
    const hooks = createHeadlessHooks();
    const stats: MatchStats = { aces: 1, blocks: 2, longestRally: 8, points: [15, 11] };

    hooks.setScore(5, 3, 0, 0, 1, TeamSide.AWAY);
    hooks.matchEnd(true, stats, '1 × 0');
    stats.points[0] = 99;

    expect(hooks.lastScore).toEqual({
      home: 5,
      away: 3,
      homeSets: 0,
      awaySets: 0,
      setNumber: 1,
      serving: TeamSide.AWAY,
    });
    expect(hooks.result).toEqual({
      homeWon: true,
      homeStats: { ...stats, points: [15, 11] },
      scoreline: '1 × 0',
    });
  });

  it('cria estado isolado por partida', () => {
    const first = createHeadlessHooks();
    const second = createHeadlessHooks();

    first.camera.ballPos.set(1, 2, 3);

    expect(second.camera.ballPos.toArray()).toEqual([0, 0, 0]);
    expect(second.result).toBeNull();
  });
});
