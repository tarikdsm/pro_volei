// Fluxo de ponto → set → partida: orquestração (placar + apresentação + transições) sobre um
// contexto injetado. As decisões puras ficam em rules/scoring.ts; aqui é o "como" (banners,
// áudio, câmera, rodízio, agendamento). Extraído de Match.ts (1.6).
import { TeamSide, otherSide, sideSign } from '../../core/constants';
import type { BallSimulationPort } from '../simulation/BallSimulationPort';
import { Team } from '../Team';
import { RallyState } from '../RallyState';
import type { MatchHooks as Hooks, MatchStats } from '../ports/MatchHooks';
import type { SimulationTelemetryEmitter } from '../simulation/SimulationTelemetry';
import type { PointCause } from '../simulation/SimulationTelemetry';
import {
  isSetOver,
  setWinner,
  isMatchOver,
  setPointLeader,
  isAce,
  resolveRallyOutcome,
  isDecidingSet,
  nextFirstServer,
} from './scoring';

// A fatia do Match que o fluxo de pontuação precisa. `state` continua sendo do orquestrador: em vez
// de setters crus, transições vêm por métodos de intenção (enterPoint/enterSetEnd/enterMatchEnd).
export interface ScoringCtx {
  ball: BallSimulationPort;
  rally: RallyState;
  hooks: Hooks;
  emitTelemetry: SimulationTelemetryEmitter;
  readonly score: [number, number]; // mutado in-place
  readonly sets: [number, number]; // mutado in-place
  readonly stats: MatchStats; // mutado in-place
  readonly format: { sets: number; pointsPerSet: number };
  servingTeam: TeamSide; // leitura + escrita (troca de saque)
  setNumber: number; // leitura + escrita (próximo set)
  firstServerOfSet: TeamSide; // leitura + escrita (quem sacou primeiro no set atual — base da alternância)
  teamOf(side: TeamSide): Team;
  after(t: number, fn: () => void): void;
  coinTossSide(): TeamSide; // sorteio de posse (mantém a aleatoriedade fora das regras puras)
  releaseControl(): void; // human.release()
  beginServePrep(): void;
  enterPoint(): void; // state='point'; stateTime=0; events=[]
  enterSetEnd(): void; // state='setEnd'; stateTime=0
  enterMatchEnd(): void; // state='matchEnd'
  isRally(): boolean; // guard: state === 'rally'
}

/** Resolve o vencedor pela queda da bola e concede o ponto. */
export function resolvePoint(ctx: ScoringCtx): void {
  const { winner, inCourt, landSide } = resolveRallyOutcome(
    ctx.ball.pos,
    ctx.rally.lastTouchTeam,
    ctx.servingTeam,
  );
  const reason = inCourt
    ? landSide === TeamSide.HOME
      ? 'Bola no seu chão'
      : 'Bola no chão deles!'
    : 'Bola fora';
  awardPoint(ctx, winner, reason, inCourt ? 'floor-in' : 'floor-out');
}

/** Concede o ponto: placar, celebração, troca de saque/rodízio e agenda o próximo passo. */
export function awardPoint(
  ctx: ScoringCtx,
  winner: TeamSide,
  reason: string,
  pointCause: PointCause = 'other',
): void {
  if (!ctx.isRally()) return;
  ctx.enterPoint();
  ctx.rally.plan = null;
  ctx.releaseControl();
  ctx.ball.bouncy = true;
  ctx.hooks.effects.showLanding(null);
  ctx.hooks.effects.showAim(null);
  ctx.hooks.serveMeter(false);
  ctx.hooks.zoneHint(null);

  const ace = isAce(ctx.rally.lastKind, winner, ctx.servingTeam, ctx.rally.rallyTouches);
  const cause: PointCause = ace ? 'ace' : pointCause;
  ctx.score[winner]++;
  ctx.stats.points[winner]++;
  ctx.stats.longestRally = Math.max(ctx.stats.longestRally, ctx.rally.rallyTouches);
  ctx.emitTelemetry({
    type: 'point',
    winner,
    cause,
    ace,
    score: [ctx.score[0], ctx.score[1]],
    lastTouchSide: ctx.rally.lastTouchTeam,
    lastKind: ctx.rally.lastKind,
  });
  ctx.emitTelemetry({ type: 'rally-end', winner, cause, touches: ctx.rally.rallyTouches });

  // banners com personalidade
  let text = winner === TeamSide.HOME ? 'PONTO SEU!' : 'PONTO DO CPU';
  if (ace) {
    text = winner === TeamSide.HOME ? '🔥 ACE!' : 'ACE DO CPU';
    if (winner === TeamSide.HOME) ctx.stats.aces++;
  } else if (ctx.rally.rallyTouches >= 8) text = `QUE RALLY! ${ctx.rally.rallyTouches} toques`;
  ctx.hooks.banner(text, reason);

  ctx.hooks.audio.whistleLong();
  ctx.hooks.audio.scoreJingle(winner === TeamSide.HOME);
  ctx.hooks.audio.cheer(winner === TeamSide.HOME);
  if (winner === TeamSide.HOME) ctx.hooks.audio.applause(1.4);
  ctx.hooks.referee.signalPoint(winner);
  ctx.hooks.crowd.excite(winner === TeamSide.HOME ? 1 : 0.55);
  ctx.hooks.camera.setMode('point', { side: winner });

  ctx.teamOf(winner).celebrate();
  ctx.teamOf(otherSide(winner)).deject();

  // troca de saque + rodízio
  if (winner !== ctx.servingTeam) {
    ctx.servingTeam = winner;
    ctx.teamOf(winner).rotate();
  }
  pushScore(ctx);

  // fim de set?
  const target = ctx.format.pointsPerSet;
  const [h, a] = ctx.score;
  const setOver = isSetOver(h, a, target);
  ctx.after(2.6, () => {
    if (setOver) endSet(ctx, setWinner(h, a));
    else ctx.beginServePrep();
  });

  // set point / match point aviso
  const spLeader = setPointLeader(h, a, target);
  if (spLeader !== null) {
    ctx.after(1.4, () =>
      ctx.hooks.banner(spLeader === TeamSide.HOME ? 'SET POINT — VOCÊ!' : 'SET POINT — CPU', ''),
    );
  }
}

/** Encerra o set: contabiliza, celebra e agenda fim de partida ou próximo set. */
export function endSet(ctx: ScoringCtx, winner: TeamSide): void {
  ctx.sets[winner]++;
  ctx.enterSetEnd();
  ctx.hooks.camera.setMode('setEnd');
  ctx.hooks.effects.confetti(sideSign(winner) * 4);
  ctx.hooks.audio.victoryFanfare();
  ctx.hooks.crowd.excite(1);
  ctx.hooks.crowd.startWave();

  const matchOver = isMatchOver(ctx.sets[winner], ctx.format.sets);
  ctx.hooks.banner(
    matchOver ? '' : winner === TeamSide.HOME ? 'SET SEU! 🏐' : 'SET DO CPU',
    matchOver ? '' : `Sets ${ctx.sets[0]} × ${ctx.sets[1]}`,
  );
  pushScore(ctx);

  ctx.after(matchOver ? 1.2 : 4.0, () => {
    if (matchOver) {
      ctx.enterMatchEnd();
      const scoreline = `${ctx.sets[0]} × ${ctx.sets[1]}`;
      ctx.hooks.matchEnd(winner === TeamSide.HOME, ctx.stats, scoreline);
    } else {
      ctx.setNumber++;
      ctx.score[0] = 0;
      ctx.score[1] = 0;
      // Primeiro saque do novo set: sorteio no set decisivo; nos demais, alterna a partir de
      // quem sacou primeiro no set anterior (regra FIVB — não segue mais o vencedor do set).
      const next = isDecidingSet(ctx.setNumber, ctx.format.sets)
        ? ctx.coinTossSide()
        : nextFirstServer(ctx.firstServerOfSet);
      ctx.firstServerOfSet = next;
      ctx.servingTeam = next;
      pushScore(ctx);
      ctx.beginServePrep();
    }
  });
}

/** Empurra o placar para o HUD e o placar da arena. */
export function pushScore(ctx: ScoringCtx): void {
  ctx.hooks.setScore(
    ctx.score[0],
    ctx.score[1],
    ctx.sets[0],
    ctx.sets[1],
    ctx.setNumber,
    ctx.servingTeam,
  );
  ctx.hooks.arena.updateScoreboard(
    ctx.score[0],
    ctx.score[1],
    ctx.sets[0],
    ctx.sets[1],
    ctx.setNumber,
  );
}
