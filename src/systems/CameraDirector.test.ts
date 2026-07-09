import { describe, it, expect } from 'vitest';
import { camModeForTouch } from './CameraDirector';
import type { TouchKind } from '../core/constants';

describe('camModeForTouch', () => {
  it('cortada usa o enquadramento dramático (spike)', () => {
    expect(camModeForTouch('spike')).toBe('spike');
  });

  it('todo contato que não é cortada volta ao broadcast (rally)', () => {
    // trava o mapeamento: qualquer ramo que deixe de resetar para rally quebra este teste
    const naoCortada: TouchKind[] = ['serve', 'pass', 'set', 'block', 'freeball', 'dig'];
    for (const kind of naoCortada) {
      expect(camModeForTouch(kind)).toBe('rally');
    }
  });
});
