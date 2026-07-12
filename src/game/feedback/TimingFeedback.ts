import { ACTION_WINDOWS, TIMING_FEEDBACK } from '../../core/constants';
import type { ActionContext, ActionIntent } from '../control/ActionIntent';

export type TimingContext = Exclude<ActionContext, 'serve'>;
export type TimingTier = 'perfect' | 'good' | 'off';
export type TimingPhase = 'early' | 'on-time' | 'late';

export interface TimingEvaluation {
  readonly idealLeadTicks: number;
  readonly measuredLeadTicks: number;
  readonly errorTicks: number;
  readonly quality: number;
  readonly phase: TimingPhase;
  readonly tier: TimingTier;
}

export interface TimingFeedbackEvent extends TimingEvaluation {
  readonly kind: 'timing';
  readonly token: number;
  readonly simulationTick: number;
  readonly context: TimingContext;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
}

export function timingTier(quality: number): TimingTier {
  if (!Number.isFinite(quality)) return 'off';
  if (quality >= TIMING_FEEDBACK.perfectMin) return 'perfect';
  if (quality >= TIMING_FEEDBACK.goodMin) return 'good';
  return 'off';
}

/** Avalia o mesmo timing por ticks usado pela física humana; saque usa carga e é rejeitado. */
export function evaluateTiming(
  intent: ActionIntent,
  contactInTicks = 0,
): Readonly<TimingEvaluation> {
  if (intent.context === 'serve') throw new RangeError('Saque não possui sweet spot de timing.');

  const context = intent.context;
  const idealLeadTicks = idealLead(context);
  const lead = Number.isFinite(contactInTicks) ? Math.max(0, contactInTicks) : 0;
  const heldTicks = Math.max(0, intent.resolvedTick - intent.pressedTick);
  const measuredLeadTicks = context === 'attack' || context === 'block' ? lead + heldTicks : lead;
  const errorTicks = measuredLeadTicks - idealLeadTicks;
  const quality = clamp01(1 - Math.abs(errorTicks) / Math.max(12, idealLeadTicks));
  const phase: TimingPhase =
    Math.abs(errorTicks) <= TIMING_FEEDBACK.onTimeToleranceTicks
      ? 'on-time'
      : errorTicks > 0
        ? 'early'
        : 'late';

  return Object.freeze({
    idealLeadTicks,
    measuredLeadTicks,
    errorTicks,
    quality,
    phase,
    tier: timingTier(quality),
  });
}

function idealLead(context: TimingContext): number {
  switch (context) {
    case 'receive':
      return ACTION_WINDOWS.receiveIdealTicks;
    case 'set':
      return ACTION_WINDOWS.setIdealTicks;
    case 'attack':
      return ACTION_WINDOWS.attackIdealTicks;
    case 'block':
      return ACTION_WINDOWS.blockIdealTicks;
    case 'freeball':
      return ACTION_WINDOWS.freeballIdealTicks;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
