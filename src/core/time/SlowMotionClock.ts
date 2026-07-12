const NORMAL_SCALE = 1;

/** Relógio puro de câmera lenta, medido somente em tempo real ativo. */
export class SlowMotionClock {
  private currentScale = NORMAL_SCALE;
  private remainingRealSeconds = 0;

  get scale(): number {
    return this.currentScale;
  }

  get secondsUntilBoundary(): number {
    return this.remainingRealSeconds > 0 ? this.remainingRealSeconds : Number.POSITIVE_INFINITY;
  }

  trigger(scale: number, durationRealSeconds: number): void {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new RangeError('A escala da câmera lenta deve ser positiva e finita.');
    }
    if (!Number.isFinite(durationRealSeconds) || durationRealSeconds < 0) {
      throw new RangeError('A duração da câmera lenta deve ser finita e não negativa.');
    }

    if (durationRealSeconds === 0) {
      this.currentScale = NORMAL_SCALE;
      this.remainingRealSeconds = 0;
      return;
    }

    this.currentScale = scale;
    this.remainingRealSeconds = durationRealSeconds;
  }

  advanceActiveReal(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError('O avanço real ativo deve ser finito e não negativo.');
    }
    if (this.remainingRealSeconds === 0 || seconds === 0) return;

    this.remainingRealSeconds = Math.max(0, this.remainingRealSeconds - seconds);
    if (this.remainingRealSeconds === 0) this.currentScale = NORMAL_SCALE;
  }
}
