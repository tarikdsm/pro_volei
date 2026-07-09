// Estado explícito da tela do app — máquina de estado pura, testável em Node.
// Substitui os booleans soltos `playing`/`paused` do bootstrap (main.ts) por um único
// estado, deixando as transições verificáveis e fechando os buracos do achado M7:
//  - Escape após o fim da partida ('ended') não reabre a pausa (togglePause é ignorado).
//  - togglePause alterna somente entre jogo e pausa, nunca sai do title/ended.
export type AppState = 'title' | 'playing' | 'paused' | 'ended';

export type AppEvent = 'start' | 'togglePause' | 'resume' | 'matchEnded';

/**
 * Reducer puro do estado do app. Regras:
 *  - 'start': inicia a partida → 'playing'.
 *  - 'togglePause': alterna somente entre 'playing' ⇄ 'paused'; qualquer outro estado
 *    (inclusive 'ended') permanece inalterado — Escape é ignorado fora do jogo.
 *  - 'resume': de 'paused' volta a 'playing'; nos demais estados, inalterado (idempotente).
 *  - 'matchEnded': encerra a partida a partir de qualquer estado → 'ended'.
 */
export function nextAppState(state: AppState, ev: AppEvent): AppState {
  switch (ev) {
    case 'start':
      return 'playing';
    case 'togglePause':
      if (state === 'playing') return 'paused';
      if (state === 'paused') return 'playing';
      return state;
    case 'resume':
      return state === 'paused' ? 'playing' : state;
    case 'matchEnded':
      return 'ended';
  }
}
