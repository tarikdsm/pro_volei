export type InputSource = 'keyboard' | 'touch';

export interface ScreenAxis {
  readonly right: number;
  readonly up: number;
}

export type ActionEdgeKind = 'press' | 'release';

export interface ActionEdge {
  readonly kind: ActionEdgeKind;
  readonly source: InputSource;
  readonly atMs: number;
  readonly sequence: number;
}

export type InputCancelReason =
  'blur' | 'pause' | 'portrait' | 'point-end' | 'plan-changed' | 'stall' | 'pointer-cancel';

export interface InputCancellation {
  readonly reason: InputCancelReason;
  readonly atMs: number;
  readonly sequence: number;
}

export interface InputFrame {
  readonly sampledAtMs: number;
  readonly screenAxis: ScreenAxis;
  readonly actionDown: boolean;
  readonly actionEdges: readonly ActionEdge[];
  readonly cancellations: readonly InputCancellation[];
}

export interface InputSink {
  setMove(source: InputSource, axis: ScreenAxis, atMs: number): void;
  setAction(source: InputSource, down: boolean, atMs: number): void;
  cancel(reason: InputCancelReason, atMs: number): void;
}
