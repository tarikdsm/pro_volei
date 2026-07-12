import { ACTION_WINDOWS } from '../../core/constants';
import type { InputCancelReason } from '../../core/input/InputFrame';
import type { ControlFrame } from './ControlFrame';
import type {
  ActionContext,
  ActionIntent,
  ActionMachineSnapshot,
  ActionTechnique,
} from './ActionIntent';
import { ActionButtonMachine } from './ActionButtonMachine';
import { resolveAction } from './ActionResolver';

export interface ActionControlRequest {
  readonly token: number;
  readonly context: ActionContext;
  readonly contactInTicks: number;
  readonly compatibleContact: boolean;
  readonly lockedIllegal: boolean;
}

export interface ActionControlSnapshot extends ActionMachineSnapshot {
  readonly pendingTechnique: ActionTechnique | null;
  readonly pendingToken: number | null;
  readonly lastTechnique: ActionTechnique | null;
  readonly lastGesture: ActionIntent['gesture'] | null;
  readonly lastCharge: number;
  readonly lastResolvedToken: number | null;
}

/** Adapta ControlFrame à máquina pura e mantém a intenção até o contato mecânico. */
export class ActionControl {
  private readonly machine = new ActionButtonMachine();
  private pending: ActionIntent | null = null;
  private lastResolved: ActionIntent | null = null;

  step(frame: ControlFrame, request: ActionControlRequest): ActionIntent | null {
    if (this.pending && this.pending.token !== request.token) this.pending = null;

    const gesture = this.machine.step({
      simulationTick: frame.simulationTick,
      token: request.token,
      context: request.context,
      legal:
        request.context === 'serve' || request.contactInTicks <= legalLeadTicks(request.context),
      compatibleContact: request.compatibleContact,
      lockedIllegal: request.lockedIllegal,
      actionDown: frame.actionDown,
      direction: frame.courtAxis,
      actionEdges: frame.actionEdges,
      cancellations: frame.cancellations,
    });
    if (!gesture) return null;

    this.pending = resolveAction(gesture);
    this.lastResolved = this.pending;
    return this.pending;
  }

  peek(): ActionIntent | null {
    return this.pending;
  }

  take(token: number, context?: ActionContext): ActionIntent | null {
    if (!this.pending || this.pending.token !== token) return null;
    if (context !== undefined && this.pending.context !== context) return null;
    const intent = this.pending;
    this.pending = null;
    return intent;
  }

  cancel(reason: InputCancelReason): void {
    this.pending = null;
    this.machine.resetAfterCancellation(reason);
  }

  snapshot(): ActionControlSnapshot {
    const machine = this.machine.snapshot();
    return Object.freeze({
      ...machine,
      pendingTechnique: this.pending?.technique ?? null,
      pendingToken: this.pending?.token ?? null,
      lastTechnique: this.lastResolved?.technique ?? null,
      lastGesture: this.lastResolved?.gesture ?? null,
      lastCharge: this.lastResolved?.charge ?? 0,
      lastResolvedToken: this.lastResolved?.token ?? null,
    });
  }
}

function legalLeadTicks(context: ActionContext): number {
  switch (context) {
    case 'receive':
      return ACTION_WINDOWS.receiveLeadTicks;
    case 'set':
      return ACTION_WINDOWS.setLeadTicks;
    case 'attack':
      return ACTION_WINDOWS.attackLeadTicks;
    case 'block':
      return ACTION_WINDOWS.blockLeadTicks;
    case 'freeball':
      return ACTION_WINDOWS.freeballLeadTicks;
    case 'serve':
      return Number.POSITIVE_INFINITY;
  }
}
