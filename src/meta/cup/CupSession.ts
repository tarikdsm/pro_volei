import type { StrategyBiasProfile } from '../../game/strategy/StrategyTypes';
import type { SaveRepository } from '../../platform/save/SaveRepository';
import type { CareerStats, ProVoleiSaveV1 } from '../../platform/save/SaveSchema';
import { advanceCup, restartCup, type CupResultStatus } from './Cup';
import { CUP_OPPONENTS, type CupOpponent } from './CupOpponents';

export interface CupMatchStats {
  readonly points: readonly [number, number];
  readonly aces: number;
  readonly blocks: number;
  readonly longestRally: number;
}

export interface CupMatchConfig {
  readonly token: string;
  readonly opponent: Readonly<CupOpponent>;
  readonly difficulty: 0 | 1 | 2;
  readonly format: 0;
  readonly lossCount: number;
  readonly awayTacticalProfile: Readonly<StrategyBiasProfile>;
}

export interface CupSessionResult {
  readonly status: CupResultStatus;
  readonly rewardId?: string;
  readonly save: Readonly<ProVoleiSaveV1>;
}

export class CupSession {
  private active: Readonly<CupMatchConfig> | null = null;
  private readonly results = new Map<string, Readonly<CupSessionResult>>();

  constructor(private readonly repository: SaveRepository) {}

  snapshot(): Readonly<ProVoleiSaveV1> {
    return this.repository.snapshot();
  }

  startCurrent(): Readonly<CupMatchConfig> | null {
    const cup = this.repository.snapshot().cup;
    if (cup.completed || cup.currentRound >= CUP_OPPONENTS.length) return null;
    if (this.active) return this.active;
    const opponent = CUP_OPPONENTS[cup.currentRound];
    const lossCount = cup.attempts[cup.currentRound] ?? 0;
    this.active = Object.freeze({
      token: `cup:${cup.currentRound}:${lossCount}:${opponent.id}`,
      opponent,
      difficulty: opponent.difficulty,
      format: 0,
      lossCount,
      awayTacticalProfile: opponent.tactics,
    });
    return this.active;
  }

  recordResult(
    token: string,
    homeWon: boolean,
    stats: Readonly<CupMatchStats>,
  ): Readonly<CupSessionResult> {
    const cached = this.results.get(token);
    if (cached) return cached;
    const active = this.active;
    if (!active || token !== active.token)
      throw new Error('Resultado não pertence ao confronto ativo');

    const transition = advanceCup(this.repository.snapshot().cup, homeWon);
    const save = this.repository.update((current) => ({
      ...current,
      cup: transition.progress,
      stats: recordCareerResult(current.stats, homeWon, stats),
      unlocks: homeWon
        ? {
            ...current.unlocks,
            unlocked: [...new Set([...current.unlocks.unlocked, active.opponent.rewardId])],
          }
        : current.unlocks,
    }));
    const result = Object.freeze({
      status: transition.status,
      rewardId: homeWon ? active.opponent.rewardId : undefined,
      save,
    });
    this.results.set(token, result);
    this.active = null;
    return result;
  }

  restart(): Readonly<ProVoleiSaveV1> {
    this.active = null;
    this.results.clear();
    return this.repository.update((current) => ({ ...current, cup: restartCup() }));
  }
}

export function recordCareerResult(
  current: Readonly<CareerStats>,
  homeWon: boolean,
  stats: Readonly<CupMatchStats>,
): CareerStats {
  const pointsFor = nonNegativeInteger(stats.points[0]);
  const pointsAgainst = nonNegativeInteger(stats.points[1]);
  return {
    matches: current.matches + 1,
    wins: current.wins + (homeWon ? 1 : 0),
    losses: current.losses + (homeWon ? 0 : 1),
    pointsFor: current.pointsFor + pointsFor,
    pointsAgainst: current.pointsAgainst + pointsAgainst,
    aces: current.aces + nonNegativeInteger(stats.aces),
    blocks: current.blocks + nonNegativeInteger(stats.blocks),
    longestRally: Math.max(current.longestRally, nonNegativeInteger(stats.longestRally)),
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
