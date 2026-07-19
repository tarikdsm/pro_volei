import { TIMING_FEEDBACK } from '../core/constants';
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';

type Vibrate = (pattern: number[]) => unknown;

/** Haptic opcional: nunca condiciona gameplay nem propaga falha do dispositivo. */
export class Haptics {
  private enabled = true;

  constructor(private readonly vibrate: Vibrate | null = detectVibrate()) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  timingCue(event: Readonly<TimingFeedbackEvent>): void {
    if (!this.enabled || !this.vibrate) return;
    try {
      this.vibrate([...TIMING_FEEDBACK.haptics[event.tier]]);
    } catch {
      // Alguns browsers expõem a API, mas a bloqueiam sem gesto/permissão.
    }
  }
}

function detectVibrate(): Vibrate | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (pattern) => navigator.vibrate(pattern);
}
