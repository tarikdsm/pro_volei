// Converte a avaliação de timing por ticks em qualidade física de contato.
// A avaliação única vive em game/feedback/TimingFeedback.ts.
import { HUMAN_TIMING } from '../../core/constants';

/** Qualidade do toque humano dada a qualidade do timing; bola forte penaliza. */
export function humanContactQuality(timingQ: number, hard: boolean): number {
  return (
    (HUMAN_TIMING.contactBase + HUMAN_TIMING.contactSpan * timingQ) *
    (hard ? HUMAN_TIMING.hardPenalty : 1)
  );
}
