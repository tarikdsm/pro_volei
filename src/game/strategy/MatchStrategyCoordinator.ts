import { TeamSide } from '../../core/constants';
import type { MatchBallPort } from '../simulation/BallSimulationPort';
import type { MechanicsBallContact, MechanicsCtx } from '../mechanics/context';
import { performStrategicServe } from '../mechanics/serve';
import type { PointResolvedEvent } from '../rules/SetMatch';
import type { RallyState, TouchPlan } from '../RallyState';
import type { Athlete, Team } from '../Team';
import type { MatchStrategyPort, MatchStrategyTickSource } from './MatchStrategyBridge';
import { serveReceptionEffectiveness, type ServeReceptionPoint2 } from './ServeReceptionOutcome';
import type { ServeEpochToken } from './StrategicServeSystem';
import type { AttackDecisionDraft, BoundAttackCommitment } from './StrategicAttackTypes';
import type {
  BoundSetCommitment,
  OffenseRallyRef,
  SetDecisionDraft,
  SetPlanIdentity,
} from './StrategicOffenseSystem';
import type { CpuTouchExecution } from './StrategicTouchExecution';
import type { StrategyBiasProfile, StrategyDifficulty, StrategyPhase } from './StrategyTypes';

export type MatchStrategyState = 'idle' | 'servePrep' | 'rally' | 'point' | 'setEnd' | 'matchEnd';

export interface MatchStrategyCoordinatorRuntime {
  readonly ball: MatchBallPort;
  readonly rally: RallyState;
  readonly home: Team;
  readonly away: Team;
  tick(): number;
  state(): MatchStrategyState;
  score(): readonly [number, number];
  serving(): TeamSide;
  difficulty(): StrategyDifficulty;
  mechanics(): MechanicsCtx;
  after(seconds: number, fn: () => void): void;
}

function strategyPhase(state: MatchStrategyState): StrategyPhase {
  switch (state) {
    case 'servePrep':
      return 'serve-prep';
    case 'setEnd':
      return 'set-end';
    case 'matchEnd':
      return 'match-end';
    default:
      return state;
  }
}

/** Integra o domínio estratégico ao lifecycle do Match sem expor seus sistemas internos. */
export class MatchStrategyCoordinator {
  private offenseRally?: OffenseRallyRef;
  private preparedSet?: SetDecisionDraft;
  private boundSet?: BoundSetCommitment;
  private preparedAttack?: AttackDecisionDraft;
  private boundAttack?: BoundAttackCommitment;
  private consumedAttack?: BoundAttackCommitment;

  constructor(
    private readonly strategy: MatchStrategyPort,
    private readonly runtime: MatchStrategyCoordinatorRuntime,
  ) {}

  startMatch(awayTacticalProfile?: Readonly<StrategyBiasProfile>): void {
    this.strategy.startMatch(awayTacticalProfile);
    this.clearOffenseState();
  }

  startSet(): void {
    this.strategy.startSet();
  }

  beginRally(): void {
    this.clearOffenseState();
    this.offenseRally = this.strategy.beginOffenseRally();
  }

  captureTick(): void {
    this.strategy.captureTick(this.tickSource());
  }

  beginServe(side: TeamSide, server: Athlete, cpu: boolean): void {
    const token = this.strategy.beginServe(side, server.index);
    if (!cpu) return;
    const delay = this.runtime.mechanics().random.ai.range(1.4, 2.4);
    this.runtime.after(delay, () => this.tryStrategicServe(token));
  }

  onBallContact(contact: MechanicsBallContact): void {
    const team = this.teamOf(contact.side);
    const setterSpot = team.setterSpot();
    const contactAthlete = team.athletes[contact.athleteId];
    const setter =
      (this.runtime.rally.setterHold?.side === contact.side
        ? this.runtime.rally.setterHold
        : null) ?? team.nearestTo(setterSpot.x, setterSpot.z, contactAthlete);
    const ball = this.runtime.ball;
    const resolved = this.strategy.onBallContact({
      matchEpoch: this.strategy.matchEpoch,
      tick: this.runtime.tick(),
      outcomeToken: contact.outcomeToken,
      side: contact.side,
      ballAfter: {
        position: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z },
        velocity: { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z },
        inFlight: ball.inFlight,
      },
      setterPosition: { x: setter.pos.x, z: setter.pos.z },
    });
    if (resolved) this.runtime.rally.serveOutcomeToken = null;
    this.resolveAttackBeforeObservation(contact, { x: setter.pos.x, z: setter.pos.z });
    this.observeCpuOffenseContact(contact);
  }

  onPoint(point: PointResolvedEvent): void {
    const rally = this.runtime.rally;
    if (this.offenseRally) {
      this.strategy.resolveOffensePoint(this.offenseRally, point.winner);
    }
    const resolved = this.strategy.onPoint({
      outcomeToken: rally.serveOutcomeToken,
      servingSide: point.servingSide,
      winner: point.winner,
      ace: point.ace,
    });
    if (resolved) rally.serveOutcomeToken = null;
    if (this.offenseRally) this.strategy.endOffenseRally(this.offenseRally);
    this.clearOffenseState();
  }

  plannedCpuAthlete(kind: 'set' | 'spike', side: TeamSide): number | null {
    if (this.runtime.mechanics().isHumanSide(side)) return null;
    if (kind === 'set' && this.preparedSet?.ref.side === side) {
      return this.preparedSet.setterAthleteId;
    }
    if (kind === 'spike' && this.preparedAttack?.decisionContact.side === side) {
      return this.preparedAttack.attackerAthleteId;
    }
    return null;
  }

  bindCpuPlan(
    plan: Pick<TouchPlan, 'planId' | 'side' | 'athlete' | 'kind' | 'isHuman' | 'tacticalRevision'>,
  ): void {
    if (
      plan.isHuman ||
      this.runtime.mechanics().isHumanSide(plan.side) ||
      plan.athlete.side !== plan.side ||
      (plan.kind !== 'set' && plan.kind !== 'spike')
    ) {
      return;
    }
    const identity = this.planIdentity(plan);
    if (!identity) return;
    if (plan.kind === 'set') {
      const draft = this.preparedSet;
      if (!draft || draft.ref.side !== plan.side) return;
      const result = this.strategy.bindOffenseSet(draft.ref, identity);
      this.boundSet = result.status === 'bound' ? result.commitment : undefined;
      if (result.status !== 'bound') this.preparedSet = undefined;
      return;
    }
    const draft = this.preparedAttack;
    if (!draft || draft.decisionContact.side !== plan.side) return;
    const result = this.strategy.bindOffenseAttack(draft, identity);
    this.boundAttack = result.status === 'bound' ? result.commitment : undefined;
    if (result.status !== 'bound') this.preparedAttack = undefined;
  }

  consumeCpuTouch(
    plan: Pick<TouchPlan, 'planId' | 'side' | 'athlete' | 'kind' | 'isHuman' | 'tacticalRevision'>,
  ): CpuTouchExecution | null {
    if (
      plan.isHuman ||
      this.runtime.mechanics().isHumanSide(plan.side) ||
      plan.athlete.side !== plan.side ||
      (plan.kind !== 'set' && plan.kind !== 'spike')
    ) {
      return null;
    }
    const identity = this.planIdentity(plan);
    if (!identity) return null;
    if (plan.kind === 'set') {
      const commitment = this.boundSet;
      if (!commitment || commitment.ref.side !== plan.side) return null;
      const result = this.strategy.consumeOffenseSet(commitment, identity);
      if (result.status !== 'consumed') return null;
      return Object.freeze({
        kind: 'set' as const,
        execution: result.execution,
        attackerAthleteId: commitment.draft.plannedAttackerAthleteId,
      });
    }
    const commitment = this.boundAttack;
    if (!commitment || commitment.draft.decisionContact.side !== plan.side) return null;
    const result = this.strategy.consumeOffenseAttack(commitment, identity);
    if (result.status !== 'consumed') return null;
    this.consumedAttack = commitment;
    return Object.freeze({ kind: 'spike' as const, execution: result.execution });
  }

  flush(): void {
    this.strategy.flush();
  }

  private tryStrategicServe(token: ServeEpochToken): void {
    const side = this.runtime.serving();
    if (
      this.runtime.state() !== 'servePrep' ||
      token.matchEpoch !== this.strategy.matchEpoch ||
      token.side !== side ||
      this.teamOf(token.side).server().index !== token.serverAthleteId
    ) {
      return;
    }
    const result = this.strategy.commitServe(token, this.runtime.difficulty(), this.runtime.tick());
    if (result.status === 'not-ready') {
      this.runtime.after(1 / 60, () => this.tryStrategicServe(token));
      return;
    }
    if (result.status !== 'committed') return;

    const server = this.teamOf(token.side).server();
    performStrategicServe(this.runtime.mechanics(), server, result.directive, {
      guard: (ref, stage) => {
        const serving = this.runtime.serving();
        return this.strategy.guardServe(ref, stage, {
          phase: strategyPhase(this.runtime.state()),
          servingSide: serving,
          serverAthleteId: this.teamOf(serving).server().index,
        });
      },
      onLaunched: (ref, realization) => {
        const launched = this.strategy.markServeLaunched(ref, realization);
        if (launched.status !== 'launched') return false;
        this.runtime.rally.serveOutcomeToken = launched.serve.outcomeToken;
        return true;
      },
    });
  }

  private resolveAttackBeforeObservation(
    contact: MechanicsBallContact,
    setterPosition: ServeReceptionPoint2,
  ): void {
    const commitment = this.consumedAttack;
    if (!commitment || contact.side === commitment.draft.decisionContact.side) return;
    let resolved = false;
    if (contact.kind === 'block') {
      resolved = this.strategy.resolveOffenseBlock(commitment);
    } else if (contact.kind === 'pass' || contact.kind === 'dig') {
      const ball = this.runtime.ball;
      const effectiveness = serveReceptionEffectiveness({
        ballAfter: {
          position: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z },
          velocity: { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z },
          inFlight: ball.inFlight,
        },
        setterPosition,
      });
      resolved = this.strategy.resolveOffenseDefense(commitment, effectiveness);
    }
    if (resolved) this.consumedAttack = undefined;
  }

  private observeCpuOffenseContact(contact: MechanicsBallContact): void {
    const rally = this.offenseRally;
    if (
      !rally ||
      this.runtime.mechanics().isHumanSide(contact.side) ||
      (contact.kind !== 'pass' && contact.kind !== 'dig' && contact.kind !== 'set')
    ) {
      return;
    }
    const touches = this.runtime.rally.possessionTouches;
    if (touches !== 1 && touches !== 2 && touches !== 3) return;
    const team = this.teamOf(contact.side);
    const ball = this.runtime.ball;
    const ownAthletes = team.slots.map((athleteId, slot) => {
      const athlete = team.athletes[athleteId];
      return {
        side: contact.side,
        id: athleteId,
        slot,
        row: slot <= 2 ? ('back' as const) : ('front' as const),
        position: { x: athlete.pos.x, z: athlete.pos.z },
        velocity: { x: athlete.velocity.x, z: athlete.velocity.z },
        airborne: athlete.isAirborne,
      };
    });
    const observed = this.strategy.observeOffenseContact(
      rally,
      {
        tick: this.runtime.tick(),
        side: contact.side,
        kind: contact.kind,
        athleteId: contact.athleteId,
        ballAfter: {
          position: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z },
          velocity: { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z },
          inFlight: ball.inFlight,
        },
        ownAthletes,
      },
      touches,
    );
    if (observed.status !== 'observed') return;

    if (contact.kind === 'pass' || contact.kind === 'dig') {
      this.preparedSet = undefined;
      this.boundSet = undefined;
      this.preparedAttack = undefined;
      this.boundAttack = undefined;
      if (touches >= 3) return;
      const prepared = this.strategy.prepareOffenseSet(observed.contact, this.runtime.difficulty());
      if (prepared.status !== 'prepared') return;
      this.preparedSet = prepared.draft;
      this.runtime.rally.setterHold = team.athletes[prepared.draft.setterAthleteId] ?? null;
      this.runtime.rally.plannedAttacker =
        prepared.draft.plannedAttackerAthleteId === null
          ? null
          : (team.athletes[prepared.draft.plannedAttackerAthleteId] ?? null);
      return;
    }

    this.preparedAttack = undefined;
    this.boundAttack = undefined;
    const prepared = this.strategy.prepareOffenseAttack(
      observed.contact,
      this.runtime.difficulty(),
    );
    if (prepared.status !== 'prepared') return;
    this.preparedAttack = prepared.draft;
    this.runtime.rally.plannedAttacker = team.athletes[prepared.draft.attackerAthleteId] ?? null;
  }

  private planIdentity(
    plan: Pick<TouchPlan, 'planId' | 'athlete' | 'tacticalRevision'>,
  ): SetPlanIdentity | null {
    if (plan.tacticalRevision === undefined) return null;
    return Object.freeze({
      planId: plan.planId,
      tacticalRevision: plan.tacticalRevision,
      athleteId: plan.athlete.index,
    });
  }

  private clearOffenseState(): void {
    this.offenseRally = undefined;
    this.preparedSet = undefined;
    this.boundSet = undefined;
    this.preparedAttack = undefined;
    this.boundAttack = undefined;
    this.consumedAttack = undefined;
  }

  private tickSource(): MatchStrategyTickSource {
    const ball = this.runtime.ball;
    const score = this.runtime.score();
    const athletes: MatchStrategyTickSource['athletes'][number][] = [];
    for (const team of [this.runtime.home, this.runtime.away]) {
      for (let slot = 0; slot < team.slots.length; slot++) {
        const athleteId = team.slots[slot];
        const athlete = team.athletes[athleteId];
        athletes.push({
          side: team.side,
          id: athleteId,
          slot,
          position: { x: athlete.pos.x, z: athlete.pos.z },
          velocity: { x: athlete.velocity.x, z: athlete.velocity.z },
          airborne: athlete.isAirborne,
        });
      }
    }
    return {
      tick: this.runtime.tick(),
      score: [score[0], score[1]],
      phase: strategyPhase(this.runtime.state()),
      possessionSide: this.runtime.rally.possessionTeam,
      servingSide: this.runtime.serving(),
      possessionTouches: this.runtime.rally.possessionTouches,
      ball: {
        position: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z },
        velocity: { x: ball.vel.x, y: ball.vel.y, z: ball.vel.z },
        inFlight: ball.inFlight,
      },
      athletes,
    };
  }

  private teamOf(side: TeamSide): Team {
    return side === TeamSide.HOME ? this.runtime.home : this.runtime.away;
  }
}
