import { BALL_RADIUS } from '../../core/constants';
import { Ball } from '../../entities/Ball';
import { AiController } from '../ai/AiController';
import type { MechanicsCtx } from '../mechanics/context';
import type { RallyState, TouchPlan } from '../RallyState';
import {
  consumeTimelineEvent,
  selectNextTimelineEvent,
  type EventTimelineCandidate,
  type EventTimelineToken,
} from './EventTimeline';

interface PendingEvent {
  at: number;
  sequence: number;
  fn: () => void;
}

interface MatchTimelineCandidate extends EventTimelineCandidate {
  resolve(): void;
}

export interface MatchTimelinePort {
  rally: RallyState;
  ball: Ball;
  ai: AiController;
  mechanics: MechanicsCtx;
  isRally(): boolean;
  advanceWorld(seconds: number): void;
  resolveContact(plan: TouchPlan): void;
  resolveNet(): void;
  resolveAntenna(): void;
  resolveFloor(): void;
}

const PRIORITY = { scheduled: 0, contact: 10, net: 20, antenna: 30, floor: 40 } as const;
const MAX_EVENTS_PER_TICK = 64;

/** Timeline segmentada de um Match: ordena eventos; o port executa as regras concretas. */
export class MatchTimeline {
  private simulationTime = 0;
  private events: PendingEvent[] = [];
  private nextEventSequence = 0;
  private planToken = 0;
  private trajectoryToken = 0;

  constructor(private readonly port: MatchTimelinePort) {}

  after(seconds: number, fn: () => void): void {
    this.events.push({
      at: this.simulationTime + Math.max(0, seconds),
      sequence: this.nextEventSequence++,
      fn,
    });
  }

  clearScheduled(): void {
    this.events = [];
  }

  beginPlan(): void {
    this.planToken += 1;
  }

  beginTrajectory(): void {
    this.trajectoryToken += 1;
  }

  step(dt: number): void {
    let cursor = 0;
    let consumedTokens: ReadonlySet<EventTimelineToken> = new Set();

    for (let guard = 0; guard < MAX_EVENTS_PER_TICK; guard++) {
      const remaining = Math.max(0, dt - cursor);
      const selection = selectNextTimelineEvent(this.candidates(cursor), {
        at: cursor,
        remaining,
        consumedTokens,
      });
      if (!selection) {
        this.advanceContinuous(remaining);
        return;
      }

      if (selection.timeFromCursor > 0) {
        this.advanceContinuous(selection.timeFromCursor);
        cursor = selection.at;
      }
      consumedTokens = consumeTimelineEvent(consumedTokens, selection);
      selection.event.resolve();
    }

    this.advanceContinuous(Math.max(0, dt - cursor));
  }

  private candidates(cursor: number): MatchTimelineCandidate[] {
    const candidates = this.scheduledCandidates(cursor);
    const { rally } = this.port;
    const plan = rally.plan;

    if (this.port.isRally() && plan && !plan.done) {
      const token = this.planToken;
      candidates.push({
        kind: 'contact',
        timeWithinTick: cursor + Math.max(0, plan.contactIn),
        priority: PRIORITY.contact,
        sequence: token,
        token: `contact:${token}`,
        resolve: () => {
          if (rally.plan === plan && !plan.done) this.port.resolveContact(plan);
        },
      });
    }

    if (this.port.isRally() && rally.netEventIn !== null) {
      const token = this.trajectoryToken;
      candidates.push({
        kind: 'net',
        timeWithinTick: cursor + Math.max(0, rally.netEventIn),
        priority: PRIORITY.net,
        sequence: token,
        token: `net:${token}`,
        resolve: () => {
          if (token !== this.trajectoryToken) return;
          rally.netEventIn = null;
          this.port.resolveNet();
        },
      });
    }

    if (this.port.isRally() && rally.outAntennaIn !== null) {
      const token = this.trajectoryToken;
      candidates.push({
        kind: 'antenna',
        timeWithinTick: cursor + Math.max(0, rally.outAntennaIn),
        priority: PRIORITY.antenna,
        sequence: token,
        token: `antenna:${token}`,
        resolve: () => {
          if (token !== this.trajectoryToken) return;
          rally.outAntennaIn = null;
          this.port.resolveAntenna();
        },
      });
    }

    this.addJumpCandidates(candidates, cursor);
    this.addFloorCandidate(candidates, cursor);
    return candidates;
  }

  private scheduledCandidates(cursor: number): MatchTimelineCandidate[] {
    return this.events.map((event) => ({
      kind: 'scheduled',
      timeWithinTick: cursor + Math.max(0, event.at - this.simulationTime),
      priority: PRIORITY.scheduled,
      sequence: event.sequence,
      token: `scheduled:${event.sequence}`,
      resolve: () => {
        const index = this.events.findIndex((pending) => pending.sequence === event.sequence);
        if (index < 0) return;
        const [pending] = this.events.splice(index, 1);
        pending.fn();
      },
    }));
  }

  private addJumpCandidates(candidates: MatchTimelineCandidate[], cursor: number): void {
    const { rally, ai, mechanics } = this.port;
    const plan = rally.plan;
    if (!this.port.isRally() || !plan) return;
    if (plan.jumpScheduledIn !== undefined) {
      candidates.push({
        kind: 'scheduled',
        timeWithinTick: cursor + Math.max(0, plan.jumpScheduledIn),
        priority: PRIORITY.scheduled,
        sequence: 1_000_000 + this.planToken,
        token: `jump:attack:${this.planToken}`,
        resolve: () => {
          if (rally.plan === plan && plan.jumpScheduledIn !== undefined) {
            plan.jumpScheduledIn = 0;
          }
          ai.resolveScheduledJumps(mechanics);
        },
      });
    }
    for (const blocker of rally.blockers) {
      if (blocker.jumped) continue;
      candidates.push({
        kind: 'scheduled',
        timeWithinTick: cursor + Math.max(0, blocker.jumpIn),
        priority: PRIORITY.scheduled,
        sequence: 2_000_000 + blocker.athlete.index,
        token: `jump:block:${this.planToken}:${blocker.athlete.index}`,
        resolve: () => {
          if (!blocker.jumped) blocker.jumpIn = 0;
          ai.resolveScheduledJumps(mechanics);
        },
      });
    }
  }

  private addFloorCandidate(candidates: MatchTimelineCandidate[], cursor: number): void {
    const { ball } = this.port;
    if (!this.port.isRally() || !ball.inFlight) return;
    const floorIn =
      ball.pos.y <= BALL_RADIUS && ball.vel.y < 0 ? 0 : ball.timeToDescend(BALL_RADIUS);
    if (floorIn < 0) return;
    const token = this.trajectoryToken;
    candidates.push({
      kind: 'floor',
      timeWithinTick: cursor + floorIn,
      priority: PRIORITY.floor,
      sequence: token,
      token: `floor:${token}`,
      resolve: () => {
        if (token === this.trajectoryToken && this.port.isRally()) this.port.resolveFloor();
      },
    });
  }

  private advanceContinuous(seconds: number): void {
    if (seconds <= 0) return;
    const { ball, rally, ai, mechanics } = this.port;
    ball.step(seconds);
    this.port.advanceWorld(seconds);
    ai.advanceScheduledJumpTimers(seconds, mechanics);
    this.simulationTime += seconds;

    if (this.port.isRally() && rally.plan && !rally.plan.done) {
      rally.plan.contactIn -= seconds;
    }
    if (this.port.isRally() && rally.netEventIn !== null) rally.netEventIn -= seconds;
    if (this.port.isRally() && rally.outAntennaIn !== null) rally.outAntennaIn -= seconds;
  }
}
