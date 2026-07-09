// Rodízio de posições do vôlei — lógica pura, extraída de Team.ts.

/**
 * Formação inicial de rodízio: cada slot i contém o atleta de índice i.
 * Retorna um array NOVO a cada chamada (nunca compartilhar a referência, pois
 * o rodízio muta os slots do Team ao longo do jogo).
 */
export function initialSlots(): number[] {
  return [0, 1, 2, 3, 4, 5];
}

/**
 * Rodízio no sentido horário: cada slot passa a conter quem estava no slot anterior.
 * Retorna um novo array (não muta a entrada).
 */
export function rotateSlots(slots: readonly number[]): number[] {
  const n = slots.length;
  return slots.map((_, i) => slots[(i + n - 1) % n]);
}
