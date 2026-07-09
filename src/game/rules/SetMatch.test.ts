import { describe, it, expect, vi } from 'vitest';
import { TeamSide } from '../../core/constants';
import { endSet, ScoringCtx } from './SetMatch';
import type { Ball } from '../../entities/Ball';
import type { RallyState } from '../RallyState';
import type { Team } from '../Team';
import type { Hooks, MatchStats } from '../Match';

// endSet recebe o ScoringCtx por injeção, então é testável em Node com um contexto falso:
// hooks no-op, `after` síncrono e ball/rally stubados (endSet não os toca).
const noop = (): void => {};

function stubHooks(): Hooks {
  return {
    banner: noop,
    setScore: noop,
    audio: { victoryFanfare: noop },
    effects: { confetti: noop },
    camera: { setMode: noop },
    crowd: { excite: noop, startWave: noop },
    arena: { updateScoreboard: noop },
  } as unknown as Hooks;
}

interface CtxOpts {
  setNumber: number;
  sets: [number, number];
  servingTeam: TeamSide;
  firstServerOfSet: TeamSide;
  coinTossSide?: () => TeamSide;
  formatSets?: number;
}

function makeCtx(o: CtxOpts): ScoringCtx {
  const stats: MatchStats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
  return {
    ball: {} as unknown as Ball,
    rally: {} as unknown as RallyState,
    hooks: stubHooks(),
    score: [0, 0],
    sets: o.sets,
    stats,
    format: { sets: o.formatSets ?? 3, pointsPerSet: 25 },
    servingTeam: o.servingTeam,
    setNumber: o.setNumber,
    firstServerOfSet: o.firstServerOfSet,
    coinTossSide: o.coinTossSide ?? (() => TeamSide.HOME),
    teamOf: () => ({}) as unknown as Team,
    after: (_t: number, fn: () => void) => fn(), // executa o agendamento de forma síncrona
    releaseControl: noop,
    beginServePrep: noop,
    enterPoint: noop,
    enterSetEnd: noop,
    enterMatchEnd: noop,
    isRally: () => true,
  };
}

describe('endSet — primeiro sacador entre sets', () => {
  it('set não decisivo alterna o primeiro saque, mesmo quando o vencedor sacou primeiro', () => {
    // Set 1: HOME sacou primeiro e venceu. A alternância deve dar AWAY (não o vencedor).
    const ctx = makeCtx({
      setNumber: 1,
      sets: [0, 0],
      servingTeam: TeamSide.HOME,
      firstServerOfSet: TeamSide.HOME,
    });
    endSet(ctx, TeamSide.HOME);
    expect(ctx.setNumber).toBe(2);
    expect(ctx.firstServerOfSet).toBe(TeamSide.AWAY);
    expect(ctx.servingTeam).toBe(TeamSide.AWAY);
  });

  it('alterna na outra direção (AWAY sacou primeiro → HOME saca no próximo)', () => {
    const ctx = makeCtx({
      setNumber: 1,
      sets: [0, 0],
      servingTeam: TeamSide.AWAY,
      firstServerOfSet: TeamSide.AWAY,
    });
    endSet(ctx, TeamSide.AWAY);
    expect(ctx.firstServerOfSet).toBe(TeamSide.HOME);
    expect(ctx.servingTeam).toBe(TeamSide.HOME);
  });

  it('set decisivo (set 3 do melhor-de-3) usa o sorteio, ignorando a alternância', () => {
    // Set 2 termina 1×1 → entra o set 3 decisivo. firstServerOfSet=HOME faria alternância dar AWAY;
    // o sorteio (mock=HOME) deve prevalecer, provando que o toss substitui a alternância.
    const toss = vi.fn(() => TeamSide.HOME);
    const ctx = makeCtx({
      setNumber: 2,
      sets: [1, 0],
      servingTeam: TeamSide.AWAY,
      firstServerOfSet: TeamSide.HOME,
      coinTossSide: toss,
    });
    endSet(ctx, TeamSide.AWAY); // sets → 1×1, partida não encerra
    expect(ctx.setNumber).toBe(3);
    expect(toss).toHaveBeenCalledTimes(1);
    expect(ctx.firstServerOfSet).toBe(TeamSide.HOME);
    expect(ctx.servingTeam).toBe(TeamSide.HOME);
  });

  it('regressão do bug: com vencedor=HOME e primeiro sacador anterior=HOME, o próximo saque NÃO é HOME', () => {
    const ctx = makeCtx({
      setNumber: 1,
      sets: [0, 0],
      servingTeam: TeamSide.HOME,
      firstServerOfSet: TeamSide.HOME,
    });
    endSet(ctx, TeamSide.HOME);
    expect(ctx.servingTeam).not.toBe(TeamSide.HOME);
  });
});
