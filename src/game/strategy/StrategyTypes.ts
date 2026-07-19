import type { TeamSide } from '../../core/constants';
import type { OwnContactRead } from './OwnContactRead';

export interface StrategyPoint2 {
  readonly x: number;
  readonly z: number;
}

export interface StrategyPoint3 extends StrategyPoint2 {
  readonly y: number;
}

export type StrategyVelocity3 = StrategyPoint3;

export type StrategyDecisionKind = 'serve' | 'set' | 'attack';
export type StrategyDifficulty = 0 | 1 | 2;
export type StrategyRow = 'front' | 'back';
export type StrategyPhase = 'idle' | 'serve-prep' | 'rally' | 'point' | 'set-end' | 'match-end';

export type ServeOptionId =
  | 'serve.float-deep.center'
  | 'serve.float-deep.left'
  | 'serve.float-deep.right'
  | 'serve.float-short.center'
  | 'serve.float-short.left'
  | 'serve.float-short.right'
  | 'serve.power-deep.center'
  | 'serve.power-deep.left'
  | 'serve.power-deep.right';

export type SetOptionId =
  | 'set.accelerated-left'
  | 'set.accelerated-right'
  | 'set.high-left'
  | 'set.high-right'
  | 'set.quick-center';

export type AttackOptionId =
  | 'attack.placed-cross'
  | 'attack.placed-line'
  | 'attack.placed-seam'
  | 'attack.power-cross-deep'
  | 'attack.power-line-deep'
  | 'attack.tip-short-center'
  | 'attack.tip-short-left'
  | 'attack.tip-short-right';

export type StrategyOptionId = ServeOptionId | SetOptionId | AttackOptionId;

/** Ajustes de identidade limitados à seleção de jogadas; nunca contém parâmetros físicos. */
export interface StrategyBiasProfile {
  readonly familyBias?: Readonly<
    Partial<Record<StrategyDecisionKind, Readonly<Record<string, number>>>>
  >;
  readonly optionBias?: Readonly<Partial<Record<StrategyOptionId, number>>>;
}

export interface AthleteStrategySnapshot {
  readonly side: TeamSide;
  readonly id: number;
  readonly slot: number;
  readonly row: StrategyRow;
  readonly position: StrategyPoint2;
  readonly velocity: StrategyPoint2;
  readonly airborne: boolean;
}

export interface VisibleStrategyBall {
  readonly position: StrategyPoint3;
  readonly velocity: StrategyVelocity3;
  readonly inFlight: boolean;
  readonly lastVisibleContactTick: number | null;
}

export interface StrategyObservation {
  readonly tick: number;
  readonly score: readonly [number, number];
  readonly phase: StrategyPhase;
  readonly possessionSide: TeamSide | null;
  readonly servingSide: TeamSide;
  readonly possessionTouches: number;
  readonly ball: VisibleStrategyBall;
  readonly athletes: readonly AthleteStrategySnapshot[];
}

export interface StrategyMemoryOutcome {
  readonly kind: StrategyDecisionKind;
  readonly optionId: StrategyOptionId;
  readonly effectiveness: number;
}

export interface StrategyMemorySnapshot {
  readonly revision: number;
  /** Ordem cronológica: o último item de cada lista é sempre o mais recente. */
  readonly outcomes: readonly StrategyMemoryOutcome[];
  readonly recentChoices: readonly StrategyOptionId[];
}

export interface StrategyDrawTicket {
  readonly selection: number;
  readonly variation: number;
}

export interface StrategyDecisionContext {
  readonly side: TeamSide;
  readonly kind: StrategyDecisionKind;
  readonly decisionTick: number;
  readonly difficulty: StrategyDifficulty;
  readonly observation: StrategyObservation;
  readonly memory: StrategyMemorySnapshot;
  readonly ticket: StrategyDrawTicket;
  readonly tacticalProfile?: Readonly<StrategyBiasProfile>;
  /** Bola e elenco próprios logo após o contato; obrigatório em set/attack, nunca contém rival. */
  readonly ownContactRead?: OwnContactRead;
  /** ID da levantadora no roster do próprio lado; obrigatório em runtime quando kind === 'set'. */
  readonly setterAthleteId?: number;
  /** Origem mundial causal do ataque; derivada pelo domínio quando kind === 'attack'. */
  readonly attackOriginZ?: number;
}

export interface StrategyVisibleBallRead {
  readonly reachable: boolean;
  readonly eta: number;
  readonly predictedHeight: number;
  readonly lateralMiss: number;
  readonly quality: number;
}

export type StrategyScoreComponents = Readonly<Record<string, number>>;

export interface ScoredStrategyCandidate {
  readonly optionId: StrategyOptionId;
  readonly kind: StrategyDecisionKind;
  readonly family: string;
  readonly target: StrategyPoint2;
  readonly components: StrategyScoreComponents;
  readonly score: number;
  readonly probability: number;
}

export interface StrategyProposal {
  readonly kind: StrategyDecisionKind;
  readonly side: TeamSide;
  readonly observationTick: number;
  readonly ticket: StrategyDrawTicket;
  readonly candidates: readonly ScoredStrategyCandidate[];
  readonly chosen: ScoredStrategyCandidate;
}
