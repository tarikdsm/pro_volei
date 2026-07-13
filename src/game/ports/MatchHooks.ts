import type * as THREE from 'three';
import type { TeamSide } from '../../core/constants';
import type { CamMode } from '../camera/CameraMode';
import type { FeedbackPort } from '../feedback/TimingFeedback';

export interface MatchStats {
  /** Métricas históricas do lado HOME (o jogador no modo browser). */
  aces: number;
  blocks: number;
  longestRally: number;
  points: [number, number];
}

export interface AudioPort {
  excite(intensity: number): void;
  whistle(): void;
  whistleLong(): void;
  hitHard(): void;
  hitSoft(): void;
  bounce(): void;
  netTouch(): void;
  block(): void;
  cheer(big?: boolean): void;
  applause(duration?: number): void;
  scoreJingle(home: boolean): void;
  victoryFanfare(): void;
}

export interface EffectsPort {
  burst(at: THREE.Vector3, color: number, count?: number, speed?: number): void;
  confetti(centerX: number): void;
  showLanding(point: THREE.Vector3 | null): void;
  showAim(point: THREE.Vector3 | null): void;
}

export interface CameraPort {
  readonly ballPos: THREE.Vector3;
  readonly servePos: THREE.Vector3;
  setMode(mode: CamMode, options?: { cut?: boolean; side?: TeamSide }): void;
  addShake(amount: number): void;
  kickFov(amount?: number): void;
}

export interface CrowdPort {
  excite(amount: number): void;
  startWave(): void;
}

export interface RefereePort {
  signalPoint(side: TeamSide): void;
}

export interface ArenaPort {
  updateScoreboard(
    home: number,
    away: number,
    homeSets: number,
    awaySets: number,
    setNumber: number,
  ): void;
}

export interface MatchHooks {
  banner(text: string, sub?: string): void;
  hint(text: string): void;
  setScore(h: number, a: number, hs: number, as: number, setNum: number, serving: TeamSide): void;
  serveMeter(visible: boolean, value?: number): void;
  zoneHint(zone: number | null): void;
  slowMo(scale: number, duration: number): void;
  matchEnd(homeWon: boolean, stats: MatchStats, scoreline: string): void;
  readonly feedback: FeedbackPort;
  readonly audio: AudioPort;
  readonly effects: EffectsPort;
  readonly camera: CameraPort;
  readonly crowd: CrowdPort;
  readonly referee: RefereePort;
  readonly arena: ArenaPort;
}
