// Mapeamentos puros de timing → qualidade do controle humano (recepção e cortada).
// Determinísticos e testados; o resto do fluxo (aleatoriedade, banners, física) fica no
// HumanController.
import { clamp } from '../../core/math3d';
import { HUMAN_TIMING } from '../../core/constants';

/** Qualidade [0..1] do aperto de ESPAÇO na recepção — 1.0 no sweet-spot da recepção. */
export function receiveTimingQuality(contactIn: number): number {
  return clamp(
    1 - Math.abs(contactIn - HUMAN_TIMING.receiveSweet) * HUMAN_TIMING.receiveSlope,
    0,
    1,
  );
}

/** Qualidade [0..1] do timing do pulo no ataque — 1.0 no sweet-spot do pulo. */
export function jumpTimingQuality(contactIn: number): number {
  return clamp(1 - Math.abs(contactIn - HUMAN_TIMING.jumpSweet) * HUMAN_TIMING.jumpSlope, 0, 1);
}

/** Qualidade do toque humano dada a qualidade do timing; bola forte penaliza. */
export function humanContactQuality(timingQ: number, hard: boolean): number {
  return (
    (HUMAN_TIMING.contactBase + HUMAN_TIMING.contactSpan * timingQ) *
    (hard ? HUMAN_TIMING.hardPenalty : 1)
  );
}
