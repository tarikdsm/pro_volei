export interface CameraPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraBounds {
  readonly min: CameraPoint;
  readonly max: CameraPoint;
}

export type CameraPhase = 'serve' | 'rally' | 'spike' | 'point' | 'setEnd';

/** Snapshot neutro da simulação consumido pela apresentação. */
export interface CameraFrame {
  readonly ball: CameraPoint;
  readonly controlled?: CameraPoint;
  readonly destination?: CameraPoint;
  readonly bounds: CameraBounds;
  readonly phase: CameraPhase;
  /** Segundos até o contato previsto; `null` quando não há contato agendado. */
  readonly contactIn: number | null;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface SafeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Medidas de layout prontas; a leitura de DOM permanece fora do solver. */
export interface SafeFrame {
  readonly viewport: ViewportSize;
  readonly insets: SafeInsets;
  readonly overlays: readonly ScreenRect[];
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface BroadcastFrameSolution {
  readonly focus: CameraPoint;
  /** Centro no plano broadcast: horizontal=x; vertical=y-0,32*z. */
  readonly projectedCenter: ScreenPoint;
  readonly pixelsPerMeter: number;
  readonly safeRect: ScreenRect;
  readonly subjects: {
    readonly ball: ScreenPoint;
    readonly controlled?: ScreenPoint;
    readonly destination?: ScreenPoint;
  };
  readonly destinationIncluded: boolean;
  readonly deadZoneApplied: boolean;
}
