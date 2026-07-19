import type { SafeInsets, ScreenRect, ViewportSize } from '../systems/camera/CameraFrame';

export interface TouchLayout {
  readonly action: Readonly<ScreenRect>;
  readonly movement: Readonly<ScreenRect>;
  readonly stickRadius: number;
}

/** Divide o viewport seguro em duas zonas laterais e preserva o terço central para o jogo. */
export function solveTouchLayout(viewport: ViewportSize, insets: SafeInsets): TouchLayout {
  const third = Math.floor(viewport.width / 3);
  const safeHeight = Math.max(0, viewport.height - insets.top - insets.bottom);

  return Object.freeze({
    action: Object.freeze({
      x: insets.left,
      y: insets.top,
      width: Math.max(0, third - insets.left),
      height: safeHeight,
    }),
    movement: Object.freeze({
      x: viewport.width - third,
      y: insets.top,
      width: Math.max(0, third - insets.right),
      height: safeHeight,
    }),
    stickRadius: Math.max(36, Math.min(52, safeHeight * 0.14)),
  });
}
