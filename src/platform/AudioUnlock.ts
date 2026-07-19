export interface GestureAudio {
  init(): void;
}

/** Cria/retoma o AudioContext somente dentro do primeiro gesto permitido pelo browser. */
export function bindAudioUnlock(target: EventTarget, audio: GestureAudio): () => void {
  let active = true;
  const dispose = (): void => {
    if (!active) return;
    active = false;
    target.removeEventListener('pointerdown', unlock, true);
    target.removeEventListener('keydown', unlock, true);
  };
  const unlock = (): void => {
    if (!active) return;
    audio.init();
    dispose();
  };

  target.addEventListener('pointerdown', unlock, true);
  target.addEventListener('keydown', unlock, true);
  return dispose;
}
