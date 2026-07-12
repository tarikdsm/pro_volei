import type { InputCancelReason } from '../../core/input/InputFrame';

export type ActionContext = 'serve' | 'receive' | 'set' | 'attack' | 'block' | 'freeball';

export type ActionGesture = 'tap' | 'hold';

export type ActionTechnique =
  | 'float-serve'
  | 'power-serve'
  | 'platform-pass'
  | 'emergency-dive'
  | 'high-set'
  | 'quick-set'
  | 'tip'
  | 'placed-shot'
  | 'power-spike'
  | 'quick-block'
  | 'penetrating-block'
  | 'safe-save'
  | 'reaching-freeball';

export type ActionResolutionCause = 'release' | 'contact' | 'buffer';

export interface ActionDirection {
  readonly x: number;
  readonly z: number;
}

/** Gesto temporal produzido uma única vez pela máquina, ainda sem técnica/física. */
export interface ActionGestureEvent {
  readonly token: number;
  readonly context: ActionContext;
  readonly gesture: ActionGesture;
  readonly charge: number;
  readonly direction: ActionDirection;
  readonly pressedTick: number;
  readonly resolvedTick: number;
  readonly cause: ActionResolutionCause;
}

/** Intenção semântica neutra consumida pelas mecânicas no contato. */
export interface ActionIntent extends ActionGestureEvent {
  readonly technique: ActionTechnique;
  readonly power: number;
  readonly reach: number;
  readonly precision: number;
  readonly penetration: number;
}

export type ActionMachineStatus =
  'idle' | 'pressed' | 'charging' | 'buffered' | 'committed' | 'blocked';

export interface ActionMachineSnapshot {
  readonly token: number | null;
  readonly context: ActionContext | null;
  readonly status: ActionMachineStatus;
  readonly charge: number;
  readonly consumed: boolean;
  readonly lastCancellation: InputCancelReason | null;
}
