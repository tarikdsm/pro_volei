import { describe, expect, it, vi } from 'vitest';
import { bindAudioUnlock } from './AudioUnlock';

describe('bindAudioUnlock', () => {
  it('inicializa o áudio no primeiro gesto e remove os dois listeners', () => {
    const target = new EventTarget();
    const init = vi.fn();

    const dispose = bindAudioUnlock(target, { init });
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));

    expect(init).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('aceita o teclado como primeiro gesto permitido', () => {
    const target = new EventTarget();
    const init = vi.fn();

    bindAudioUnlock(target, { init });
    target.dispatchEvent(new Event('keydown'));

    expect(init).toHaveBeenCalledTimes(1);
  });
});
