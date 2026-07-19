/** Converte offsets relativos em instantes absolutos seguros do relógio Web Audio. */
export function scheduleSequence(now: number, offsets: readonly number[]): number[] {
  const start = Number.isFinite(now) ? now : 0;
  return offsets.map((offset) => start + (Number.isFinite(offset) ? Math.max(0, offset) : 0));
}
