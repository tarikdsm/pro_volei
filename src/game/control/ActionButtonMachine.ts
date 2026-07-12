import { ACTION_BUTTON } from '../../core/constants';
import type { ActionEdge, InputCancellation, InputCancelReason } from '../../core/input/InputFrame';
import type {
  ActionContext,
  ActionDirection,
  ActionGestureEvent,
  ActionMachineSnapshot,
  ActionMachineStatus,
} from './ActionIntent';

interface TimedInputEvent {
  readonly atMs: number;
  readonly sequence: number;
}

export interface ActionButtonTick {
  readonly simulationTick: number;
  readonly token: number | null;
  readonly context: ActionContext | null;
  readonly legal: boolean;
  readonly compatibleContact: boolean;
  readonly lockedIllegal: boolean;
  readonly actionDown: boolean;
  readonly direction: ActionDirection;
  readonly actionEdges: readonly ActionEdge[];
  readonly cancellations: readonly InputCancellation[];
}

type OrderedInputEvent =
  | (ActionEdge & { readonly type: 'edge' })
  | (InputCancellation & { readonly type: 'cancellation' });

function compareInputEvents(left: TimedInputEvent, right: TimedInputEvent): number {
  return left.atMs - right.atMs || left.sequence - right.sequence;
}

function clampCharge(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Gramática temporal pura do botão de ação, avançada exclusivamente por ticks simulados. */
export class ActionButtonMachine {
  private token: number | null = null;
  private context: ActionContext | null = null;
  private status: ActionMachineStatus = 'idle';
  private pressedTick: number | null = null;
  private charge = 0;
  private consumed = false;
  private bufferedGesture: 'tap' | 'hold' | null = null;
  private bufferedCharge = 0;
  private needsRelease = false;
  private physicalDown = false;
  private lastCancellation: InputCancelReason | null = null;
  private lastSimulationTick = Number.NEGATIVE_INFINITY;

  step(input: ActionButtonTick): ActionGestureEvent | null {
    this.assertTick(input.simulationTick);
    this.bindToken(input);

    if (input.lockedIllegal) {
      this.cancel('plan-changed', input.actionDown);
      return null;
    }

    let resolved: ActionGestureEvent | null = null;
    for (const event of this.orderedEvents(input)) {
      if (event.type === 'cancellation') {
        // InputHub já zerou o ownership lógico; um release posterior não será emitido.
        this.cancel(event.reason, false);
      } else if (event.kind === 'press') {
        this.physicalDown = true;
        if (!resolved) this.onPress(input);
      } else {
        this.physicalDown = false;
        if (!resolved) resolved = this.onRelease(input);
      }
    }

    if (resolved) return resolved;

    if (this.status === 'buffered') {
      const age = this.pressAge(input.simulationTick);
      if (age > ACTION_BUTTON.bufferTicks) {
        this.clearGesture('idle');
      } else if (input.legal) {
        if (this.bufferedGesture) {
          return this.commit(input, this.bufferedGesture, this.bufferedCharge, 'buffer');
        }
        const gesture = age < ACTION_BUTTON.tapTicks ? 'tap' : 'hold';
        return this.commit(input, gesture, this.chargeAt(age), 'buffer');
      }
    } else {
      this.refreshCharge(input.simulationTick);
    }

    if (input.legal && input.compatibleContact && this.status === 'charging' && !this.consumed) {
      return this.commit(input, 'hold', this.charge, 'contact');
    }

    return null;
  }

  snapshot(): ActionMachineSnapshot {
    return Object.freeze({
      token: this.token,
      context: this.context,
      status: this.status,
      charge: this.charge,
      consumed: this.consumed,
      lastCancellation: this.lastCancellation,
    });
  }

  private bindToken(input: ActionButtonTick): void {
    if (input.token === this.token) {
      this.context = input.context;
      return;
    }

    const hadToken = this.token !== null;
    const wasPhysicalDown = this.physicalDown;
    if (hadToken) this.cancel('plan-changed', wasPhysicalDown);
    else this.clearGesture(input.actionDown ? 'blocked' : 'idle');

    this.token = input.token;
    this.context = input.context;
    this.consumed = false;
    this.needsRelease = hadToken && wasPhysicalDown;
    this.status = this.needsRelease ? 'blocked' : 'idle';
  }

  private orderedEvents(input: ActionButtonTick): OrderedInputEvent[] {
    return [
      ...input.actionEdges.map((event) => ({ ...event, type: 'edge' as const })),
      ...input.cancellations.map((event) => ({ ...event, type: 'cancellation' as const })),
    ].sort(compareInputEvents);
  }

  private onPress(input: ActionButtonTick): void {
    if (this.needsRelease || this.consumed || this.token === null || this.context === null) return;
    if (this.status !== 'idle') return;

    this.pressedTick = input.simulationTick;
    this.charge = 0;
    this.bufferedGesture = null;
    this.bufferedCharge = 0;
    this.status = input.legal ? 'pressed' : 'buffered';
  }

  private onRelease(input: ActionButtonTick): ActionGestureEvent | null {
    if (this.needsRelease) {
      this.needsRelease = false;
      this.clearGesture(this.consumed ? 'committed' : 'idle');
      return null;
    }
    if (this.consumed || this.pressedTick === null) return null;

    const age = this.pressAge(input.simulationTick);
    const gesture = age < ACTION_BUTTON.tapTicks ? 'tap' : 'hold';
    const charge = this.chargeAt(age);

    if (this.status === 'buffered' && !input.legal) {
      this.bufferedGesture = gesture;
      this.bufferedCharge = charge;
      this.charge = charge;
      return null;
    }

    return this.commit(input, gesture, charge, 'release');
  }

  private refreshCharge(simulationTick: number): void {
    if (this.pressedTick === null || this.status === 'idle' || this.status === 'blocked') return;
    if (this.status === 'buffered') return;

    const age = this.pressAge(simulationTick);
    if (age < ACTION_BUTTON.tapTicks) {
      this.status = 'pressed';
      this.charge = 0;
      return;
    }

    this.status = 'charging';
    this.charge = this.chargeAt(age);
  }

  private chargeAt(age: number): number {
    return clampCharge((age - ACTION_BUTTON.tapTicks) / ACTION_BUTTON.fullChargeTicks);
  }

  private commit(
    input: ActionButtonTick,
    gesture: 'tap' | 'hold',
    charge: number,
    cause: ActionGestureEvent['cause'],
  ): ActionGestureEvent | null {
    if (
      this.consumed ||
      this.token === null ||
      this.context === null ||
      this.pressedTick === null
    ) {
      return null;
    }

    const event: ActionGestureEvent = Object.freeze({
      token: this.token,
      context: this.context,
      gesture,
      charge: gesture === 'tap' ? 0 : clampCharge(charge),
      direction: Object.freeze({ x: input.direction.x, z: input.direction.z }),
      pressedTick: this.pressedTick,
      resolvedTick: input.simulationTick,
      cause,
    });

    this.consumed = true;
    this.pressedTick = null;
    this.bufferedGesture = null;
    this.bufferedCharge = 0;
    this.charge = event.charge;
    this.status = 'committed';
    return event;
  }

  private cancel(reason: InputCancelReason, actionDown: boolean): void {
    this.lastCancellation = reason;
    this.physicalDown = actionDown;
    this.needsRelease = !this.consumed && actionDown;
    this.clearGesture(this.consumed ? 'committed' : this.needsRelease ? 'blocked' : 'idle');
  }

  private clearGesture(status: ActionMachineStatus): void {
    this.status = status;
    this.pressedTick = null;
    this.charge = 0;
    this.bufferedGesture = null;
    this.bufferedCharge = 0;
  }

  private pressAge(simulationTick: number): number {
    return this.pressedTick === null ? 0 : simulationTick - this.pressedTick;
  }

  private assertTick(simulationTick: number): void {
    if (!Number.isInteger(simulationTick) || simulationTick < this.lastSimulationTick) {
      throw new RangeError('ActionButtonMachine exige simulationTick inteiro e monotônico');
    }
    this.lastSimulationTick = simulationTick;
  }
}
