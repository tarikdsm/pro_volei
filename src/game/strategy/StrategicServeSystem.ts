import { TeamSide } from '../../core/constants';
import type { ServeOptionId, StrategyDifficulty, StrategyPoint2 } from './StrategyTypes';
import { OpponentStrategySystem } from './OpponentStrategySystem';

export type StrategicServeFamily = 'float-short' | 'float-deep' | 'power-deep';
export type StrategicServeStage = 'committed' | 'in-flight';

export interface ServeEpochToken {
  readonly matchEpoch: number;
  readonly serveEpoch: number;
  readonly side: TeamSide;
  readonly serverAthleteId: number;
}

export interface ServeCommitmentRef extends ServeEpochToken {
  readonly decisionId: string;
  readonly optionId: ServeOptionId;
}

export interface StrategicServeDirective {
  readonly ref: ServeCommitmentRef;
  readonly family: StrategicServeFamily;
  readonly target: StrategyPoint2;
}

export interface StrategicServeRealization {
  readonly target: StrategyPoint2;
  readonly power: number;
  readonly clearance: number;
}

export interface ServeOutcomeToken {
  readonly matchEpoch: number;
  readonly serveEpoch: number;
}

export interface RealizedStrategicServe {
  readonly ref: ServeCommitmentRef;
  readonly outcomeToken: ServeOutcomeToken;
  readonly family: StrategicServeFamily;
  readonly target: StrategyPoint2;
  readonly power: number;
  readonly clearance: number;
  readonly stage: 'in-flight';
}

export interface StrategicServePointResult {
  readonly servingSide: TeamSide;
  readonly winner: TeamSide;
  readonly ace: boolean;
}

export type StrategicServeCommitResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'not-ready' }>
  | Readonly<{ status: 'committed'; directive: StrategicServeDirective }>;

export type StrategicServeLaunchResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'conflict' }>
  | Readonly<{ status: 'launched'; serve: RealizedStrategicServe }>;

type ServeLifecycleState = 'begun' | 'committed' | 'in-flight' | 'resolved' | 'revoked';

interface ActiveServe {
  readonly token: ServeEpochToken;
  state: ServeLifecycleState;
  directive?: StrategicServeDirective;
  commitResult?: Extract<StrategicServeCommitResult, { status: 'committed' }>;
  realized?: RealizedStrategicServe;
  launchResult?: Extract<StrategicServeLaunchResult, { status: 'launched' }>;
}

const STALE = Object.freeze({ status: 'stale' } as const);
const INVALID = Object.freeze({ status: 'invalid' } as const);
const CONFLICT = Object.freeze({ status: 'conflict' } as const);
const NOT_READY = Object.freeze({ status: 'not-ready' } as const);

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
}

function otherSide(side: TeamSide): TeamSide {
  return side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function sameToken(left: ServeEpochToken, right: ServeEpochToken): boolean {
  return (
    left.matchEpoch === right.matchEpoch &&
    left.serveEpoch === right.serveEpoch &&
    left.side === right.side &&
    left.serverAthleteId === right.serverAthleteId
  );
}

function sameOutcomeToken(active: ServeEpochToken, token: ServeOutcomeToken): boolean {
  return active.matchEpoch === token.matchEpoch && active.serveEpoch === token.serveEpoch;
}

function validFamily(family: string): family is StrategicServeFamily {
  return family === 'float-short' || family === 'float-deep' || family === 'power-deep';
}

function freezeRealization(realization: StrategicServeRealization): StrategicServeRealization {
  if (!Number.isFinite(realization.target.x) || !Number.isFinite(realization.target.z)) {
    throw new RangeError('target físico deve ser finito');
  }
  if (!Number.isFinite(realization.power) || realization.power < 0 || realization.power > 1) {
    throw new RangeError('power físico deve estar em [0,1]');
  }
  if (!Number.isFinite(realization.clearance)) {
    throw new RangeError('clearance físico deve ser finito');
  }
  return Object.freeze({
    target: Object.freeze({
      x: canonicalNumber(realization.target.x),
      z: canonicalNumber(realization.target.z),
    }),
    power: canonicalNumber(realization.power),
    clearance: canonicalNumber(realization.clearance),
  });
}

function sameRealization(
  realized: RealizedStrategicServe,
  candidate: StrategicServeRealization,
): boolean {
  return (
    realized.target.x === candidate.target.x &&
    realized.target.z === candidate.target.z &&
    realized.power === candidate.power &&
    realized.clearance === candidate.clearance
  );
}

export class StrategicServeSystem {
  private serveEpoch = 0;
  private active?: ActiveServe;

  constructor(private readonly strategy: OpponentStrategySystem) {}

  beginServe(side: TeamSide, serverAthleteId: number): ServeEpochToken {
    if (!validSide(side)) throw new RangeError('lado do saque inválido');
    if (!Number.isSafeInteger(serverAthleteId) || serverAthleteId < 0) {
      throw new RangeError('serverAthleteId inválido');
    }
    this.revokeActive();
    const nextEpoch = this.serveEpoch + 1;
    if (!Number.isSafeInteger(nextEpoch)) throw new RangeError('serveEpoch excedeu o limite');
    this.serveEpoch = nextEpoch;
    const token = Object.freeze({
      matchEpoch: this.strategy.matchEpoch,
      serveEpoch: this.serveEpoch,
      side,
      serverAthleteId,
    });
    this.active = { token, state: 'begun' };
    return token;
  }

  startMatch(): void {
    this.strategy.startMatch();
    this.active = undefined;
  }

  commit(
    token: ServeEpochToken,
    difficulty: StrategyDifficulty,
    decisionTick: number,
  ): StrategicServeCommitResult {
    if (![0, 1, 2].includes(difficulty)) throw new RangeError('dificuldade inválida');
    if (!Number.isSafeInteger(decisionTick) || decisionTick < 0) {
      throw new RangeError('decisionTick inválido');
    }
    const active = this.active;
    if (
      !active ||
      !sameToken(active.token, token) ||
      token.matchEpoch !== this.strategy.matchEpoch ||
      active.state === 'resolved' ||
      active.state === 'revoked'
    ) {
      return STALE;
    }
    if (active.commitResult) return active.commitResult;

    const result = this.strategy.commitDecision({
      matchEpoch: token.matchEpoch,
      side: token.side,
      kind: 'serve',
      difficulty,
      decisionTick,
      ownership: `serve:${token.matchEpoch}:${token.serveEpoch}:${token.side}:${token.serverAthleteId}`,
    });
    if (result.status === 'not-ready') return NOT_READY;
    if (result.status === 'invalid-request') {
      if (
        result.existingDecisionId !== undefined &&
        this.strategy.outcomeState(result.existingDecisionId) === 'pending'
      ) {
        this.strategy.revokeDecision(result.existingDecisionId);
      }
      active.state = 'revoked';
      return INVALID;
    }
    const chosen = result.decision.proposal.chosen;
    if (!validFamily(chosen.family) || !chosen.optionId.startsWith('serve.')) {
      this.strategy.revokeDecision(result.decision.decisionId);
      throw new Error('decisão de saque incompatível com o domínio');
    }
    const ref = Object.freeze({
      ...token,
      decisionId: result.decision.decisionId,
      optionId: chosen.optionId as ServeOptionId,
    });
    const target = Object.freeze({
      x: canonicalNumber(chosen.target.x),
      z: canonicalNumber(chosen.target.z),
    });
    const directive = Object.freeze({ ref, family: chosen.family, target });
    const committed = Object.freeze({ status: 'committed' as const, directive });
    active.directive = directive;
    active.commitResult = committed;
    active.state = 'committed';
    return committed;
  }

  markLaunched(
    ref: ServeCommitmentRef,
    realization: StrategicServeRealization,
  ): StrategicServeLaunchResult {
    const active = this.active;
    if (
      !active ||
      !active.directive ||
      !this.matchesRef(active, ref) ||
      (active.state !== 'committed' && active.state !== 'in-flight')
    ) {
      return STALE;
    }
    const physical = freezeRealization(realization);
    if (
      active.state === 'in-flight' &&
      active.realized !== undefined &&
      active.launchResult !== undefined
    ) {
      return sameRealization(active.realized, physical) ? active.launchResult : CONFLICT;
    }
    if (active.state !== 'committed') return STALE;
    const realized = Object.freeze({
      ref: active.directive.ref,
      outcomeToken: Object.freeze({
        matchEpoch: active.token.matchEpoch,
        serveEpoch: active.token.serveEpoch,
      }),
      family: active.directive.family,
      target: physical.target,
      power: physical.power,
      clearance: physical.clearance,
      stage: 'in-flight' as const,
    });
    const launched = Object.freeze({ status: 'launched' as const, serve: realized });
    active.realized = realized;
    active.launchResult = launched;
    active.state = 'in-flight';
    return launched;
  }

  isActive(ref: ServeCommitmentRef, stage: StrategicServeStage): boolean {
    const active = this.active;
    return Boolean(active && this.matchesRef(active, ref) && active.state === stage);
  }

  resolveReception(
    token: ServeOutcomeToken,
    receivingSide: TeamSide,
    effectiveness: number,
  ): boolean {
    const active = this.active;
    if (
      !active ||
      !active.directive ||
      active.state !== 'in-flight' ||
      !sameOutcomeToken(active.token, token)
    ) {
      return false;
    }
    if (!validSide(receivingSide)) throw new RangeError('lado da recepcao invalido');
    if (!Number.isFinite(effectiveness) || effectiveness < 0 || effectiveness > 1) {
      throw new RangeError('effectiveness da recepção deve estar em [0,1]');
    }
    if (receivingSide !== otherSide(active.token.side)) {
      return false;
    }
    this.strategy.resolveOutcome(active.directive.ref.decisionId, effectiveness);
    active.state = 'resolved';
    return true;
  }

  resolvePoint(token: ServeOutcomeToken, point: StrategicServePointResult): boolean {
    const active = this.active;
    if (
      !active ||
      !active.directive ||
      active.state !== 'in-flight' ||
      !sameOutcomeToken(active.token, token)
    ) {
      return false;
    }
    if (!validSide(point.servingSide) || !validSide(point.winner)) {
      throw new RangeError('lados do resultado do saque são inválidos');
    }
    if (typeof point.ace !== 'boolean') throw new RangeError('ace deve ser booleano');
    if (point.ace && point.winner !== point.servingSide) {
      throw new RangeError('ace exige vitória do lado sacador');
    }
    if (point.servingSide !== active.token.side) {
      return false;
    }
    this.strategy.resolveOutcome(
      active.directive.ref.decisionId,
      point.winner === point.servingSide ? 1 : 0,
    );
    active.state = 'resolved';
    return true;
  }

  revoke(ref: ServeCommitmentRef): boolean {
    const active = this.active;
    if (
      !active ||
      !active.directive ||
      !this.matchesRef(active, ref) ||
      (active.state !== 'committed' && active.state !== 'in-flight')
    ) {
      return false;
    }
    this.strategy.revokeDecision(active.directive.ref.decisionId);
    active.state = 'revoked';
    return true;
  }

  private matchesRef(active: ActiveServe, ref: ServeCommitmentRef): boolean {
    return (
      Boolean(active.directive) &&
      sameToken(active.token, ref) &&
      active.directive!.ref.decisionId === ref.decisionId &&
      active.directive!.ref.optionId === ref.optionId
    );
  }

  private revokeActive(): void {
    const active = this.active;
    if (!active) return;
    if (
      (active.state === 'committed' || active.state === 'in-flight') &&
      active.directive !== undefined
    ) {
      this.strategy.revokeDecision(active.directive.ref.decisionId);
    }
    active.state = 'revoked';
  }
}
