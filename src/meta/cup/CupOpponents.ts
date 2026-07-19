import type { StrategyBiasProfile } from '../../game/strategy/StrategyTypes';

export type CupRound = 'classificatoria' | 'quartas' | 'semifinal' | 'final';
export type TacticalIdentity = 'saque' | 'velocidade' | 'bloqueio' | 'leitura';

export interface CupOpponent {
  readonly id: string;
  readonly name: string;
  readonly round: CupRound;
  readonly identity: TacticalIdentity;
  readonly difficulty: 0 | 1 | 2;
  readonly tactics: Readonly<StrategyBiasProfile>;
  readonly rewardId: string;
}

function profile(value: StrategyBiasProfile): Readonly<StrategyBiasProfile> {
  const familyBias = value.familyBias
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(value.familyBias).map(([kind, entries]) => [
            kind,
            Object.freeze({ ...entries }),
          ]),
        ),
      )
    : undefined;
  const optionBias = value.optionBias ? Object.freeze({ ...value.optionBias }) : undefined;
  return Object.freeze({ familyBias, optionBias });
}

export const CUP_OPPONENTS: readonly Readonly<CupOpponent>[] = Object.freeze([
  Object.freeze({
    id: 'ondas-do-saque',
    name: 'Ondas do Saque',
    round: 'classificatoria',
    identity: 'saque',
    difficulty: 1,
    tactics: profile({ familyBias: { serve: { 'float-deep': 0.1 } } }),
    rewardId: 'uniform.copa-saque',
  }),
  Object.freeze({
    id: 'raio-veloz',
    name: 'Raio Veloz',
    round: 'quartas',
    identity: 'velocidade',
    difficulty: 1,
    tactics: profile({ familyBias: { set: { accelerated: 0.08, quick: 0.1 } } }),
    rewardId: 'palette.copa-velocidade',
  }),
  Object.freeze({
    id: 'muralha-central',
    name: 'Muralha Central',
    round: 'semifinal',
    identity: 'bloqueio',
    difficulty: 2,
    tactics: profile({
      familyBias: { set: { high: 0.06 }, attack: { placed: 0.08 } },
      optionBias: { 'attack.placed-line': 0.04 },
    }),
    rewardId: 'court.copa-bloqueio',
  }),
  Object.freeze({
    id: 'visao-tatica',
    name: 'Visão Tática',
    round: 'final',
    identity: 'leitura',
    difficulty: 2,
    tactics: profile({
      familyBias: { attack: { tip: 0.07 } },
      optionBias: { 'attack.placed-seam': 0.08, 'serve.float-short.center': 0.05 },
    }),
    rewardId: 'effect.copa-leitura',
  }),
]);
