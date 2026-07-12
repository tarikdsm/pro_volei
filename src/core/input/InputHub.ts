import type {
  ActionEdge,
  InputCancellation,
  InputCancelReason,
  InputFrame,
  InputSink,
  InputSource,
  ScreenAxis,
} from './InputFrame';

const SOURCES: readonly InputSource[] = ['keyboard', 'touch'];
const NEUTRAL_AXIS: ScreenAxis = Object.freeze({ right: 0, up: 0 });
// DOMHighResTimeStamp e cutoffs calculados podem divergir por ruído sub-nanossegundo.
const CLOCK_EPSILON_MS = 1e-7;

interface SourceState {
  actionDown: boolean;
  axis: ScreenAxis;
  lastMoveAtMs: number;
  lastMoveSequence: number;
}

interface TimedEventBase {
  readonly atMs: number;
  readonly sequence: number;
}

interface MoveEvent extends TimedEventBase {
  readonly type: 'move';
  readonly source: InputSource;
  readonly axis: ScreenAxis;
}

interface ActionEvent extends TimedEventBase {
  readonly type: 'action';
  readonly source: InputSource;
  readonly down: boolean;
}

interface CancelEvent extends TimedEventBase {
  readonly type: 'cancel';
  readonly reason: InputCancelReason;
}

type InputEvent = MoveEvent | ActionEvent | CancelEvent;

function normalizeAxis(axis: ScreenAxis): ScreenAxis {
  if (!Number.isFinite(axis.right) || !Number.isFinite(axis.up)) return NEUTRAL_AXIS;
  const magnitude = Math.hypot(axis.right, axis.up);
  if (magnitude === 0) return NEUTRAL_AXIS;

  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return Object.freeze({ right: axis.right * scale, up: axis.up * scale });
}

function sameAxis(left: ScreenAxis, right: ScreenAxis): boolean {
  return left.right === right.right && left.up === right.up;
}

function compareEvents(left: InputEvent, right: InputEvent): number {
  return left.atMs - right.atMs || left.sequence - right.sequence;
}

/** Fila pura que converte eventos de adaptadores em frames semânticos determinísticos. */
export class InputHub implements InputSink {
  private readonly states = new Map<InputSource, SourceState>(
    SOURCES.map((source) => [source, this.createSourceState()]),
  );
  private readonly pending: InputEvent[] = [];
  private nextSequence = 0;
  private lastConsumedAtMs = Number.NEGATIVE_INFINITY;

  setMove(source: InputSource, axis: ScreenAxis, atMs: number): void {
    this.assertEventTime(atMs);
    this.pending.push({
      type: 'move',
      source,
      axis: normalizeAxis(axis),
      atMs,
      sequence: this.nextSequence++,
    });
  }

  setAction(source: InputSource, down: boolean, atMs: number): void {
    this.assertEventTime(atMs);
    this.pending.push({
      type: 'action',
      source,
      down,
      atMs,
      sequence: this.nextSequence++,
    });
  }

  cancel(reason: InputCancelReason, atMs: number): void {
    this.assertEventTime(atMs);
    this.pending.push({
      type: 'cancel',
      reason,
      atMs,
      sequence: this.nextSequence++,
    });
  }

  consumeUntil(atMs: number): InputFrame {
    if (!Number.isFinite(atMs) || atMs < this.lastConsumedAtMs) {
      throw new RangeError('InputHub.consumeUntil exige timestamps monotônicos');
    }
    this.lastConsumedAtMs = atMs;

    this.pending.sort(compareEvents);
    const actionEdges: ActionEdge[] = [];
    const cancellations: InputCancellation[] = [];
    let consumedCount = 0;

    for (const event of this.pending) {
      if (event.atMs - atMs > CLOCK_EPSILON_MS) break;
      consumedCount += 1;
      this.applyEvent(event, actionEdges, cancellations);
    }

    if (consumedCount > 0) this.pending.splice(0, consumedCount);

    return Object.freeze({
      sampledAtMs: atMs,
      screenAxis: this.currentAxis(),
      actionDown: this.isActionDown(),
      actionEdges: Object.freeze(actionEdges),
      cancellations: Object.freeze(cancellations),
    });
  }

  private applyEvent(
    event: InputEvent,
    actionEdges: ActionEdge[],
    cancellations: InputCancellation[],
  ): void {
    if (event.type === 'move') {
      const state = this.stateFor(event.source);
      if (sameAxis(state.axis, event.axis)) return;
      state.axis = event.axis;
      state.lastMoveAtMs = event.atMs;
      state.lastMoveSequence = event.sequence;
      return;
    }

    if (event.type === 'cancel') {
      for (const source of SOURCES) this.resetSource(this.stateFor(source));
      cancellations.push(
        Object.freeze({ reason: event.reason, atMs: event.atMs, sequence: event.sequence }),
      );
      return;
    }

    const wasDown = this.isActionDown();
    const state = this.stateFor(event.source);
    if (state.actionDown === event.down) return;
    state.actionDown = event.down;

    const isDown = this.isActionDown();
    if (wasDown === isDown) return;
    actionEdges.push(
      Object.freeze({
        kind: isDown ? 'press' : 'release',
        source: event.source,
        atMs: event.atMs,
        sequence: event.sequence,
      }),
    );
  }

  private currentAxis(): ScreenAxis {
    let active: SourceState | undefined;
    for (const source of SOURCES) {
      const candidate = this.stateFor(source);
      if (candidate.axis === NEUTRAL_AXIS) continue;
      if (
        !active ||
        candidate.lastMoveAtMs > active.lastMoveAtMs ||
        (candidate.lastMoveAtMs === active.lastMoveAtMs &&
          candidate.lastMoveSequence > active.lastMoveSequence)
      ) {
        active = candidate;
      }
    }
    return active?.axis ?? NEUTRAL_AXIS;
  }

  private isActionDown(): boolean {
    return SOURCES.some((source) => this.stateFor(source).actionDown);
  }

  private stateFor(source: InputSource): SourceState {
    return this.states.get(source)!;
  }

  private assertEventTime(atMs: number): void {
    if (!Number.isFinite(atMs) || atMs < this.lastConsumedAtMs) {
      throw new RangeError('InputHub exige eventos no relógio monotônico atual');
    }
  }

  private createSourceState(): SourceState {
    return {
      actionDown: false,
      axis: NEUTRAL_AXIS,
      lastMoveAtMs: Number.NEGATIVE_INFINITY,
      lastMoveSequence: -1,
    };
  }

  private resetSource(state: SourceState): void {
    state.actionDown = false;
    state.axis = NEUTRAL_AXIS;
    state.lastMoveAtMs = Number.NEGATIVE_INFINITY;
    state.lastMoveSequence = -1;
  }
}
