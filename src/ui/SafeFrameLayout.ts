import type {
  SafeFrame,
  SafeInsets,
  ScreenRect,
  ViewportSize,
} from '../systems/camera/CameraFrame';

/** Normaliza a leitura de layout em um DTO readonly; pode ser recalculado só em resize/visibilidade. */
export function createSafeFrame(
  viewport: ViewportSize,
  insets: SafeInsets,
  overlays: readonly ScreenRect[],
): Readonly<SafeFrame> {
  const visible = overlays
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  return Object.freeze({
    viewport: Object.freeze({ width: viewport.width, height: viewport.height }),
    insets: Object.freeze({ ...insets }),
    overlays: Object.freeze(visible),
  });
}
