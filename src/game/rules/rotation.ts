// Rodízio de posições do vôlei — lógica pura, extraída de Team.ts.

/**
 * Rodízio no sentido horário: cada slot passa a conter quem estava no slot anterior.
 * Retorna um novo array (não muta a entrada).
 */
export function rotateSlots(slots: readonly number[]): number[] {
  const n = slots.length;
  return slots.map((_, i) => slots[(i + n - 1) % n]);
}
