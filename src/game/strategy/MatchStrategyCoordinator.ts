import { TeamSide } from '../../core/constants';
import type { MatchBallPort } from '../simulation/BallSimulationPort';
import type { MechanicsBallContact, MechanicsCtx } from '../mechanics/context';
import { performStrategicServe } from '../mechanics/serve';
import type { PointResolvedEvent } from '../rules/SetMatch';
import type { RallyState } from '../RallyState';
import type { Athlete, Team } from '../Team';
import type { MatchStrategyPort, MatchStrategyTickSource } from './MatchStrategyBridge';
import type { ServeEpochToken } from './StrategicServeSystem';
import type { StrategyDifficulty, StrategyPhase } from './StrategyTypes';

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
  constructor(
    private readonly strategy: MatchStrategyPort,
    private readonly runtime: MatchStrategyCoordinatorRuntime,
  ) {}

  startMatch(): void {
    this.strategy.startMatch();
  }

  startSet(): void {
    this.strategy.startSet();
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
  }

  onPoint(point: PointResolvedEvent): void {
    const rally = this.runtime.rally;
    const resolved = this.strategy.onPoint({
      outcomeToken: rally.serveOutcomeToken,
      servingSide: point.servingSide,
      winner: point.winner,
      ace: point.ace,
    });
    if (resolved) rally.serveOutcomeToken = null;
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
