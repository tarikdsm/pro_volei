import { describe, expect, it } from 'vitest';
import type { SafeInsets, ViewportSize } from '../systems/camera/CameraFrame';
import { solveTouchLayout } from './TouchLayout';

const ZERO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('solveTouchLayout', () => {
  it.each<ViewportSize>([
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ])('reserva os terços laterais e mantém o centro livre em $width×$height', (viewport) => {
    const layout = solveTouchLayout(viewport, ZERO_INSETS);
    const third = Math.floor(viewport.width / 3);

    expect(layout.action).toEqual({ x: 0, y: 0, width: third, height: viewport.height });
    expect(layout.movement).toEqual({
      x: viewport.width - third,
      y: 0,
      width: third,
      height: viewport.height,
    });
    expect(layout.action.x + layout.action.width).toBeLessThanOrEqual(layout.movement.x);
    expect(layout.stickRadius).toBeGreaterThanOrEqual(36);
    expect(layout.stickRadius).toBeLessThanOrEqual(52);
  });

  it('desconta as safe areas sem deslocar a fronteira central', () => {
    const layout = solveTouchLayout(
      { width: 844, height: 390 },
      { top: 12, right: 28, bottom: 18, left: 24 },
    );

    expect(layout.action).toEqual({ x: 24, y: 12, width: 257, height: 360 });
    expect(layout.movement).toEqual({ x: 563, y: 12, width: 253, height: 360 });
  });

  it('limita o raio do joystick pela altura útil em telas muito baixas', () => {
    const layout = solveTouchLayout(
      { width: 568, height: 200 },
      { top: 20, right: 0, bottom: 20, left: 0 },
    );

    expect(layout.stickRadius).toBe(36);
  });
});
