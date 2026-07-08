// Mapeamentos puros de timing → qualidade do controle humano (recepção e cortada).
// Determinísticos e testados; o resto do fluxo (aleatoriedade, banners, física) fica no
// HumanController.
import { clamp } from '../../core/math3d';

/** Qualidade [0..1] do aperto de ESPAÇO na recepção — 1.0 a 0.08s do contato. */
export function receiveTimingQuality(contactIn: number): number {
  return clamp(1 - Math.abs(contactIn - 0.08) * 3.2, 0, 1);
}

/** Qualidade [0..1] do timing do pulo no ataque — 1.0 a 0.26s do contato. */
export function jumpTimingQuality(contactIn: number): number {
  return clamp(1 - Math.abs(contactIn - 0.26) * 2.8, 0, 1);
}

/** Qualidade do toque humano dada a qualidade do timing; bola forte penaliza 20%. */
export function humanContactQuality(timingQ: number, hard: boolean): number {
  return (0.45 + 0.55 * timingQ) * (hard ? 0.8 : 1);
}
