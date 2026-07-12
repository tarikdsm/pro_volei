import { describe, expect, it } from 'vitest';
import { createSafeFrame } from './SafeFrameLayout';

describe('createSafeFrame', () => {
  it('filtra overlays invisíveis e cria snapshot independente das entradas', () => {
    const viewport = { width: 844, height: 390 };
    const insets = { top: 4, right: 8, bottom: 6, left: 10 };
    const overlays = [
      { x: 0, y: 0, width: 200, height: 64 },
      { x: 20, y: 20, width: 0, height: 30 },
    ];

    const frame = createSafeFrame(viewport, insets, overlays);
    overlays[0]!.x = 99;

    expect(frame).toEqual({
      viewport,
      insets,
      overlays: [{ x: 0, y: 0, width: 200, height: 64 }],
    });
    expect(Object.isFrozen(frame)).toBe(true);
  });
});
