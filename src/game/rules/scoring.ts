// Regras de pontuação do vôlei — funções puras, sem estado nem efeitos colaterais.
// Extraídas de Match.ts para serem testáveis isoladamente (ver scoring.test.ts).
import { COURT, BALL_RADIUS, TeamSide, otherSide, TouchKind } from '../../core/constants';

/** Set encerra ao atingir a pontuação-alvo com pelo menos 2 pontos de vantagem. */
export function isSetOver(h: number, a: number, pointsPerSet: number): boolean {
  return (h >= pointsPerSet || a >= pointsPerSet) && Math.abs(h - a) >= 2;
}

/** Vencedor do set pelo placar (empate resolve para AWAY, como no comportamento original). */
export function setWinner(h: number, a: number): TeamSide {
  return h > a ? TeamSide.HOME : TeamSide.AWAY;
}

/** Quantos sets são necessários para vencer a partida num formato de N sets. */
export function setsNeeded(totalSets: number): number {
  return Math.ceil(totalSets / 2);
}

/** Partida encerra quando o vencedor de um set atinge os sets necessários. */
export function isMatchOver(winnerSetCount: number, totalSets: number): boolean {
  return winnerSetCount >= setsNeeded(totalSets);
}

/**
 * Set decisivo (tie-break) do formato: o último set possível.
 * Melhor de 3 → set 3; 1 set → o próprio set 1. Nele o primeiro saque vai a sorteio.
 */
export function isDecidingSet(setNumber: number, totalSets: number): boolean {
  return setNumber === setsNeeded(totalSets) * 2 - 1;
}

/** Alternância do primeiro sacador entre sets não decisivos: saca quem NÃO sacou primeiro no anterior. */
export function nextFirstServer(prevFirstServer: TeamSide): TeamSide {
  return otherSide(prevFirstServer);
}

/**
 * Líder em situação de set point (a 1 ponto de fechar), ou null.
 * Empate não gera set point; se o set já acabou, retorna null.
 */
export function setPointLeader(h: number, a: number, pointsPerSet: number): TeamSide | null {
  if (isSetOver(h, a, pointsPerSet)) return null;
  const leader = h > a ? TeamSide.HOME : a > h ? TeamSide.AWAY : null;
  if (leader === null) return null;
  return Math.max(h, a) >= pointsPerSet - 1 ? leader : null;
}

/** Ace: o último toque foi o saque, o ponto foi de quem sacou e não houve toques no rally. */
export function isAce(
  lastKind: TouchKind,
  winner: TeamSide,
  servingTeam: TeamSide,
  rallyTouches: number,
): boolean {
  return lastKind === 'serve' && winner === servingTeam && rallyTouches === 0;
}

export interface RallyOutcome {
  winner: TeamSide;
  inCourt: boolean;
  landSide: TeamSide;
}

/**
 * Decide o vencedor do rally pela queda da bola:
 * - dentro da quadra → ponto de quem NÃO é o dono daquele lado;
 * - fora → ponto de quem não tocou por último (ou de quem não sacou, se ninguém tocou).
 */
export function resolveRallyOutcome(
  landing: { x: number; z: number },
  lastTouchTeam: TeamSide | null,
  servingTeam: TeamSide,
): RallyOutcome {
  const landSide: TeamSide = landing.x < 0 ? TeamSide.HOME : TeamSide.AWAY;
  const inCourt =
    Math.abs(landing.x) <= COURT.halfLength + BALL_RADIUS &&
    Math.abs(landing.z) <= COURT.halfWidth + BALL_RADIUS;
  const winner = inCourt
    ? otherSide(landSide)
    : lastTouchTeam !== null
      ? otherSide(lastTouchTeam)
      : otherSide(servingTeam);
  return { winner, inCourt, landSide };
}

/**
 * Cruzamento fora do corredor das antenas: falta de quem enviou a bola.
 * Ponto de quem recebe — o oposto do último a tocar; no saque (sem toques), o recebedor.
 */
export function outOfAntennaWinner(
  lastTouchTeam: TeamSide | null,
  servingTeam: TeamSide,
): TeamSide {
  return otherSide(lastTouchTeam ?? servingTeam);
}
