import * as THREE from 'three';
import type { TeamSide } from '../../core/constants';
import type { TimingFeedbackEvent } from '../feedback/TimingFeedback';
import type { MatchHooks, MatchStats } from '../ports/MatchHooks';

export interface HeadlessScoreSnapshot {
  readonly home: number;
  readonly away: number;
  readonly homeSets: number;
  readonly awaySets: number;
  readonly setNumber: number;
  readonly serving: TeamSide;
}

export interface HeadlessMatchResult {
  readonly homeWon: boolean;
  readonly homeStats: Readonly<MatchStats>;
  readonly scoreline: string;
}

const noop = (): void => undefined;

/** Null Object de apresentação; conserva somente sinais úteis ao runner e à telemetria. */
export class HeadlessHooks implements MatchHooks {
  result: HeadlessMatchResult | null = null;
  lastScore: HeadlessScoreSnapshot | null = null;
  readonly feedbackEvents: Readonly<TimingFeedbackEvent>[] = [];

  readonly feedback = {
    emit: (event: Readonly<TimingFeedbackEvent>): void => {
      this.feedbackEvents.push(event);
    },
  };

  readonly audio = {
    excite: noop,
    whistle: noop,
    whistleLong: noop,
    hitHard: noop,
    hitSoft: noop,
    bounce: noop,
    netTouch: noop,
    block: noop,
    cheer: noop,
    applause: noop,
    scoreJingle: noop,
    victoryFanfare: noop,
  };

  readonly effects = {
    burst: noop,
    confetti: noop,
    showLanding: noop,
    showAim: noop,
  };

  readonly camera = {
    ballPos: new THREE.Vector3(),
    servePos: new THREE.Vector3(),
    setMode: noop,
    addShake: noop,
    kickFov: noop,
  };

  readonly crowd = { excite: noop, startWave: noop };
  readonly referee = { signalPoint: noop };
  readonly arena = { updateScoreboard: noop };

  banner(_text: string, _sub?: string): void {}
  hint(_text: string): void {}
  serveMeter(_visible: boolean, _value?: number): void {}
  zoneHint(_zone: number | null): void {}
  slowMo(_scale: number, _duration: number): void {}

  setScore(
    home: number,
    away: number,
    homeSets: number,
    awaySets: number,
    setNumber: number,
    serving: TeamSide,
  ): void {
    this.lastScore = Object.freeze({ home, away, homeSets, awaySets, setNumber, serving });
  }

  matchEnd(homeWon: boolean, stats: MatchStats, scoreline: string): void {
    const homeStats = Object.freeze({ ...stats, points: [...stats.points] as [number, number] });
    this.result = Object.freeze({ homeWon, homeStats, scoreline });
  }
}

export function createHeadlessHooks(): HeadlessHooks {
  return new HeadlessHooks();
}
