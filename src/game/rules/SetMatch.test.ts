import { describe, it, expect, vi } from 'vitest';
import { TeamSide, type TouchKind } from '../../core/constants';
import { awardPoint, endSet, resolvePoint, pushScore, ScoringCtx } from './SetMatch';
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
    emitTelemetry: noop,
    onPointResolved: noop,
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

// ---------------------------------------------------------------------------
// Cobertura completa da orquestração de pontuação: awardPoint (placar, ace,
// side-out, rodízio, set point, fim de set), resolvePoint, pushScore e os ramos
// de endSet (fim de partida vs. próximo set). Aqui o `after` NÃO é síncrono: os
// callbacks são coletados e drenados por flush(), pois endSet reagenda outro
// `after` no ramo do próximo set (o laço drena até esvaziar).
// ---------------------------------------------------------------------------

interface FakeOpts {
  score?: [number, number];
  sets?: [number, number];
  servingTeam?: TeamSide;
  setNumber?: number;
  firstServerOfSet?: TeamSide;
  formatSets?: number;
  pointsPerSet?: number;
  isRally?: () => boolean;
  ballPos?: { x: number; z: number };
  lastTouchTeam?: TeamSide | null;
  lastKind?: TouchKind;
  rallyTouches?: number;
  coinTossSide?: () => TeamSide;
}

function makeFake(o: FakeOpts = {}) {
  // hooks: todos os métodos que awardPoint/endSet/pushScore chamam, como spies
  const hooks = {
    banner: vi.fn(),
    hint: vi.fn(),
    setScore: vi.fn(),
    serveMeter: vi.fn(),
    zoneHint: vi.fn(),
    slowMo: vi.fn(),
    matchEnd: vi.fn(),
    audio: {
      whistleLong: vi.fn(),
      scoreJingle: vi.fn(),
      cheer: vi.fn(),
      applause: vi.fn(),
      victoryFanfare: vi.fn(),
    },
    effects: { showLanding: vi.fn(), showAim: vi.fn(), confetti: vi.fn() },
    camera: { setMode: vi.fn() },
    crowd: { excite: vi.fn(), startWave: vi.fn() },
    referee: { signalPoint: vi.fn() },
    arena: { updateScoreboard: vi.fn() },
  } as unknown as Hooks;

  // times falsos por lado: só o que awardPoint/endSet usam (rotate/celebrate/deject)
  const teams = {
    [TeamSide.HOME]: { rotate: vi.fn(), celebrate: vi.fn(), deject: vi.fn() },
    [TeamSide.AWAY]: { rotate: vi.fn(), celebrate: vi.fn(), deject: vi.fn() },
  };

  const ball = {
    bouncy: false,
    pos: { x: o.ballPos?.x ?? 0, z: o.ballPos?.z ?? 0 },
  } as unknown as Ball;

  const rally = {
    plan: {},
    lastTouchTeam: o.lastTouchTeam ?? null,
    lastKind: o.lastKind ?? 'spike',
    rallyTouches: o.rallyTouches ?? 3,
  } as unknown as RallyState;

  // agendador falso: coleta os callbacks; flush() drena em laço até esvaziar
  const scheduled: { t: number; fn: () => void }[] = [];
  const flush = (): void => {
    while (scheduled.length > 0) scheduled.shift()!.fn();
  };

  const beginServePrep = vi.fn();
  const enterPoint = vi.fn();
  const enterMatchEnd = vi.fn();

  const ctx: ScoringCtx = {
    ball,
    rally,
    hooks,
    emitTelemetry: noop,
    onPointResolved: noop,
    score: o.score ?? [0, 0],
    sets: o.sets ?? [0, 0],
    stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] },
    format: { sets: o.formatSets ?? 1, pointsPerSet: o.pointsPerSet ?? 15 },
    servingTeam: o.servingTeam ?? TeamSide.HOME,
    setNumber: o.setNumber ?? 1,
    firstServerOfSet: o.firstServerOfSet ?? TeamSide.HOME,
    teamOf: (s: TeamSide) => teams[s] as unknown as Team,
    after: (t: number, fn: () => void) => {
      scheduled.push({ t, fn });
    },
    coinTossSide: o.coinTossSide ?? (() => TeamSide.HOME),
    releaseControl: vi.fn(),
    beginServePrep,
    enterPoint,
    enterSetEnd: vi.fn(),
    enterMatchEnd,
    isRally: o.isRally ?? (() => true),
  };

  return { ctx, hooks, teams, flush, beginServePrep, enterPoint, enterMatchEnd };
}

describe('awardPoint — placar, saque e rodízio', () => {
  it('publica o resultado com o lado sacador antigo antes de qualquer transição', () => {
    const { ctx, enterPoint } = makeFake({ servingTeam: TeamSide.HOME });
    const onPointResolved = vi.fn(() => {
      expect(enterPoint).not.toHaveBeenCalled();
      expect(ctx.score).toEqual([0, 0]);
      expect(ctx.servingTeam).toBe(TeamSide.HOME);
    });
    (ctx as unknown as { onPointResolved: typeof onPointResolved }).onPointResolved =
      onPointResolved;

    awardPoint(ctx, TeamSide.AWAY, 'Bola no chão deles!', 'floor-in');

    expect(onPointResolved).toHaveBeenCalledWith({
      servingSide: TeamSide.HOME,
      winner: TeamSide.AWAY,
      ace: false,
      cause: 'floor-in',
    });
  });

  it('side-out: ponto de quem não sacava troca o saque e roda só o vencedor', () => {
    const { ctx, teams } = makeFake({ servingTeam: TeamSide.HOME });
    awardPoint(ctx, TeamSide.AWAY, 'Bola no chão deles!');
    expect(ctx.score).toEqual([0, 1]);
    expect(ctx.servingTeam).toBe(TeamSide.AWAY);
    expect(teams[TeamSide.AWAY].rotate).toHaveBeenCalledTimes(1);
    expect(teams[TeamSide.HOME].rotate).not.toHaveBeenCalled();
  });

  it('mantém o saque: ponto de quem já sacava não troca saque nem roda (isola a condição side-out)', () => {
    const { ctx, teams } = makeFake({ servingTeam: TeamSide.HOME });
    awardPoint(ctx, TeamSide.HOME, 'Bola no chão deles!');
    expect(ctx.servingTeam).toBe(TeamSide.HOME);
    expect(teams[TeamSide.HOME].rotate).not.toHaveBeenCalled();
    expect(teams[TeamSide.AWAY].rotate).not.toHaveBeenCalled();
  });

  it('guard: fora do rally não pontua nem entra no estado de ponto', () => {
    const { ctx, enterPoint } = makeFake({ isRally: () => false });
    awardPoint(ctx, TeamSide.HOME, 'Bola no chão deles!');
    expect(ctx.score).toEqual([0, 0]);
    expect(enterPoint).not.toHaveBeenCalled();
  });

  it('ace do humano conta ace, ponto e placar', () => {
    const { ctx } = makeFake({ servingTeam: TeamSide.HOME, lastKind: 'serve', rallyTouches: 0 });
    awardPoint(ctx, TeamSide.HOME, 'ACE');
    expect(ctx.stats.aces).toBe(1);
    expect(ctx.stats.points[TeamSide.HOME]).toBe(1);
    expect(ctx.score[TeamSide.HOME]).toBe(1);
  });

  it('ace do CPU não incrementa os aces do jogador', () => {
    const { ctx } = makeFake({ servingTeam: TeamSide.AWAY, lastKind: 'serve', rallyTouches: 0 });
    awardPoint(ctx, TeamSide.AWAY, 'ACE');
    expect(ctx.stats.aces).toBe(0);
    expect(ctx.stats.points[TeamSide.AWAY]).toBe(1);
  });

  it('longestRally guarda o maior rally e não é sobrescrito por um menor', () => {
    const { ctx } = makeFake({ servingTeam: TeamSide.HOME, rallyTouches: 10 });
    awardPoint(ctx, TeamSide.HOME, 'ponto');
    expect(ctx.stats.longestRally).toBe(10);
    ctx.rally.rallyTouches = 3;
    awardPoint(ctx, TeamSide.HOME, 'ponto');
    expect(ctx.stats.longestRally).toBe(10);
  });

  it('agenda o aviso de set point sem fechar o set', () => {
    const { ctx, hooks, flush } = makeFake({
      servingTeam: TeamSide.HOME,
      score: [13, 5],
      pointsPerSet: 15,
    });
    awardPoint(ctx, TeamSide.HOME, 'ponto'); // 14 × 5 → set point do HOME
    flush();
    expect(ctx.sets).toEqual([0, 0]);
    expect(hooks.banner).toHaveBeenCalledWith(expect.stringContaining('SET POINT'), '');
  });

  it('fecha o set ao atingir o alvo com 2 pontos de vantagem (dispara endSet, não beginServePrep)', () => {
    const { ctx, flush, beginServePrep } = makeFake({
      servingTeam: TeamSide.HOME,
      score: [14, 5],
      pointsPerSet: 15,
      formatSets: 1,
    });
    awardPoint(ctx, TeamSide.HOME, 'ponto'); // 15 × 5 → fecha o set
    flush();
    expect(ctx.sets[TeamSide.HOME]).toBe(1);
    expect(beginServePrep).not.toHaveBeenCalled();
  });

  it('deuce não fecha o set: segue o jogo com beginServePrep', () => {
    const { ctx, flush, beginServePrep } = makeFake({
      servingTeam: TeamSide.HOME,
      score: [15, 14],
      pointsPerSet: 15,
    });
    awardPoint(ctx, TeamSide.AWAY, 'ponto'); // 15 × 15 → sem vantagem, segue
    flush();
    expect(ctx.sets).toEqual([0, 0]);
    expect(beginServePrep).toHaveBeenCalledTimes(1);
  });
});

describe('endSet — fim de partida vs. próximo set', () => {
  it('melhor de 1: vitória do humano encerra a partida e reporta o placar de sets', () => {
    const { ctx, hooks, flush, enterMatchEnd } = makeFake({ formatSets: 1 });
    endSet(ctx, TeamSide.HOME);
    expect(ctx.sets[TeamSide.HOME]).toBe(1);
    flush();
    expect(enterMatchEnd).toHaveBeenCalledTimes(1);
    expect(hooks.matchEnd).toHaveBeenCalledWith(true, ctx.stats, '1 × 0');
  });

  it('melhor de 1: derrota do humano reporta homeWon=false e o placar invertido', () => {
    const { ctx, hooks, flush } = makeFake({ formatSets: 1 });
    endSet(ctx, TeamSide.AWAY);
    flush();
    expect(hooks.matchEnd).toHaveBeenCalledWith(false, ctx.stats, '0 × 1');
  });

  it('melhor de 3: set intermediário reseta o placar e prepara o próximo saque (partida não encerra)', () => {
    const { ctx, hooks, flush, beginServePrep } = makeFake({
      formatSets: 3,
      sets: [0, 0],
      setNumber: 1,
      firstServerOfSet: TeamSide.HOME,
      score: [15, 8],
    });
    endSet(ctx, TeamSide.HOME);
    expect(ctx.sets[TeamSide.HOME]).toBe(1);
    flush();
    expect(hooks.matchEnd).not.toHaveBeenCalled();
    expect(ctx.setNumber).toBe(2);
    expect(ctx.score).toEqual([0, 0]);
    expect(beginServePrep).toHaveBeenCalledTimes(1);
    // Obs.: quem saca no próximo set (alternância FIVB) já é coberto pelo bloco
    // 'endSet — primeiro sacador entre sets'; aqui o foco é reset + fim de set.
  });
});

describe('resolvePoint — vencedor pela queda da bola', () => {
  it('bola no chão do lado do CPU: ponto do humano', () => {
    const { ctx } = makeFake({
      servingTeam: TeamSide.HOME,
      ballPos: { x: 4, z: 0 },
      lastTouchTeam: TeamSide.HOME,
    });
    resolvePoint(ctx);
    expect(ctx.score[TeamSide.HOME]).toBe(1);
  });

  it('bola fora: ponto de quem não tocou por último', () => {
    const { ctx } = makeFake({
      servingTeam: TeamSide.HOME,
      ballPos: { x: 12, z: 0 },
      lastTouchTeam: TeamSide.HOME,
    });
    resolvePoint(ctx);
    expect(ctx.score[TeamSide.AWAY]).toBe(1);
  });
});

describe('pushScore — espelha o estado no HUD e no placar da arena', () => {
  it('encaminha placar, sets, set atual e sacador', () => {
    const { ctx, hooks } = makeFake({
      score: [5, 3],
      sets: [1, 0],
      setNumber: 2,
      servingTeam: TeamSide.AWAY,
    });
    pushScore(ctx);
    expect(hooks.setScore).toHaveBeenCalledWith(5, 3, 1, 0, 2, TeamSide.AWAY);
    expect(hooks.arena.updateScoreboard).toHaveBeenCalledWith(5, 3, 1, 0, 2);
  });
});
