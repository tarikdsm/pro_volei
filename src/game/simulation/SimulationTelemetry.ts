import type { TeamSide, TouchKind } from '../../core/constants';

export interface SimulationDrawCounts {
  readonly rules: number;
  readonly ai: number;
  readonly contact: number;
  readonly control: number;
}

export interface TelemetryPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type BlockOutcome = 'stuff' | 'soft' | 'out';
export type PointCause = 'ace' | 'serve-net' | 'antenna' | 'floor-in' | 'floor-out' | 'other';

export type SimulationEventDraft =
  | { readonly type: 'rally-start'; readonly serving: TeamSide }
  | {
      readonly type: 'serve';
      readonly side: TeamSide;
      readonly athlete: number;
      readonly power: number;
      readonly target: TelemetryPoint3;
      readonly clearance: number;
    }
  | {
      readonly type: 'contact';
      readonly side: TeamSide;
      readonly kind: TouchKind;
      readonly athlete: number;
      readonly possessionTouch: number;
      readonly rallyTouch: number;
      readonly quality: number;
      readonly point: TelemetryPoint3;
      readonly target: TelemetryPoint3;
    }
  | {
      readonly type: 'block';
      readonly side: TeamSide;
      readonly outcome: BlockOutcome;
      readonly point: TelemetryPoint3;
    }
  | {
      readonly type: 'point';
      readonly winner: TeamSide;
      readonly cause: PointCause;
      readonly ace: boolean;
      readonly score: readonly [number, number];
      readonly lastTouchSide: TeamSide | null;
      readonly lastKind: TouchKind | null;
    }
  | {
      readonly type: 'rally-end';
      readonly winner: TeamSide;
      readonly cause: PointCause;
      readonly touches: number;
    };

export type SimulationTelemetryEvent = SimulationEventDraft & {
  readonly tick: number;
  readonly draws: SimulationDrawCounts;
};

export interface SimulationTelemetryPort {
  emit(event: Readonly<SimulationTelemetryEvent>): void;
}

export type SimulationTelemetryEmitter = (event: Readonly<SimulationEventDraft>) => void;
