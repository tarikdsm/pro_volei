import { describe, expect, it } from 'vitest';
import type { CameraFrame, SafeFrame, ScreenRect } from './CameraFrame';
import { solveBroadcastFrame } from './solveBroadcastFrame';

const bounds: CameraFrame['bounds'] = {
  min: { x: -10, y: 0, z: -5.5 },
  max: { x: 10, y: 9, z: 5.5 },
};

function cameraFrame(overrides: Partial<CameraFrame> = {}): CameraFrame {
  return {
    ball: { x: -6.2, y: 4.6, z: 2.5 },
    controlled: { x: -7.4, y: 1, z: 2.1 },
    destination: { x: 7.5, y: 1, z: -3.3 },
    bounds,
    phase: 'rally',
    contactIn: 0.7,
    ...overrides,
  };
}

function safeFrame(width: number, height: number, overlays: readonly ScreenRect[] = []): SafeFrame {
  return {
    viewport: { width, height },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    overlays,
  };
}

function expectInside(point: { x: number; y: number }, rect: ScreenRect, tolerance = 1e-6): void {
  expect(point.x).toBeGreaterThanOrEqual(rect.x - tolerance);
  expect(point.x).toBeLessThanOrEqual(rect.x + rect.width + tolerance);
  expect(point.y).toBeGreaterThanOrEqual(rect.y - tolerance);
  expect(point.y).toBeLessThanOrEqual(rect.y + rect.height + tolerance);
}

describe('solveBroadcastFrame — matriz responsiva', () => {
  const viewports = [
    [1920, 1080],
    [1280, 800],
    [844, 390],
    [667, 375],
    [568, 320],
    [1024, 768],
  ] as const;

  it.each(viewports)('mantém bola, controlada e destino legíveis em %dx%d', (width, height) => {
    const result = solveBroadcastFrame(cameraFrame(), safeFrame(width, height));

    expect(result.safeRect.x).toBe(12);
    expect(result.safeRect.y).toBe(12);
    expect(result.safeRect.width).toBe(width - 24);
    expect(result.safeRect.height).toBe(height - 24);
    expectInside(result.subjects.ball, result.safeRect);
    expectInside(result.subjects.controlled!, result.safeRect);
    expect(result.destinationIncluded).toBe(true);
    expectInside(result.subjects.destination!, result.safeRect);
  });
});

describe('solveBroadcastFrame — prioridades e safe frame', () => {
  it('remove insets e overlays de borda antes de aplicar a margem de 12 px', () => {
    const overlays: ScreenRect[] = [
      { x: 0, y: 240, width: 132, height: 80 },
      { x: 436, y: 240, width: 132, height: 80 },
    ];

    const result = solveBroadcastFrame(cameraFrame(), {
      viewport: { width: 568, height: 320 },
      insets: { top: 8, right: 6, bottom: 0, left: 6 },
      overlays,
    });

    expect(result.safeRect).toEqual({ x: 18, y: 20, width: 532, height: 208 });
    expectInside(result.subjects.ball, result.safeRect);
    expectInside(result.subjects.controlled!, result.safeRect);
  });

  it('degrada um destino extremo sem sacrificar bola e controlada', () => {
    const wideBounds: CameraFrame['bounds'] = {
      min: { x: -50, y: 0, z: -5.5 },
      max: { x: 50, y: 9, z: 5.5 },
    };
    const result = solveBroadcastFrame(
      cameraFrame({ destination: { x: 42, y: 1, z: 0 }, bounds: wideBounds }),
      safeFrame(568, 320),
    );

    expect(result.destinationIncluded).toBe(false);
    expect(result.subjects.destination).toBeUndefined();
    expectInside(result.subjects.ball, result.safeRect);
    expectInside(result.subjects.controlled!, result.safeRect);
  });

  it('prioriza apenas a bola quando não há atleta controlada', () => {
    const result = solveBroadcastFrame(
      cameraFrame({ controlled: undefined, destination: undefined }),
      safeFrame(667, 375),
    );

    expect(result.subjects.controlled).toBeUndefined();
    expect(result.subjects.destination).toBeUndefined();
    expectInside(result.subjects.ball, result.safeRect);
  });

  it('não deixa foco nem sujeitos obrigatórios escaparem dos bounds', () => {
    const result = solveBroadcastFrame(
      cameraFrame({
        ball: { x: -30, y: 14, z: 12 },
        controlled: { x: 30, y: -2, z: -12 },
      }),
      safeFrame(844, 390),
    );

    expect(result.focus.x).toBeGreaterThanOrEqual(bounds.min.x);
    expect(result.focus.x).toBeLessThanOrEqual(bounds.max.x);
    expect(result.focus.y).toBeGreaterThanOrEqual(bounds.min.y);
    expect(result.focus.y).toBeLessThanOrEqual(bounds.max.y);
    expect(result.focus.z).toBeGreaterThanOrEqual(bounds.min.z);
    expect(result.focus.z).toBeLessThanOrEqual(bounds.max.z);
    expectInside(result.subjects.ball, result.safeRect);
    expectInside(result.subjects.controlled!, result.safeRect);
  });
});

describe('solveBroadcastFrame — dead zone', () => {
  it('reutiliza centro e escala quando o movimento obrigatório fica dentro da zona morta', () => {
    const safe = safeFrame(1280, 800);
    const first = solveBroadcastFrame(cameraFrame(), safe);
    const second = solveBroadcastFrame(
      cameraFrame({ ball: { x: -6.1, y: 4.65, z: 2.5 } }),
      safe,
      first,
    );

    expect(second.deadZoneApplied).toBe(true);
    expect(second.projectedCenter).toEqual(first.projectedCenter);
    expect(second.pixelsPerMeter).toBe(first.pixelsPerMeter);
    expectInside(second.subjects.ball, second.safeRect);
    expectInside(second.subjects.controlled!, second.safeRect);
  });

  it('recalcula o centro quando a bola sai da zona morta', () => {
    const safe = safeFrame(1280, 800);
    const first = solveBroadcastFrame(cameraFrame(), safe);
    const second = solveBroadcastFrame(
      cameraFrame({ ball: { x: 1.5, y: 7.5, z: -2.5 } }),
      safe,
      first,
    );

    expect(second.deadZoneApplied).toBe(false);
    expect(second.projectedCenter).not.toEqual(first.projectedCenter);
    expectInside(second.subjects.ball, second.safeRect);
    expectInside(second.subjects.controlled!, second.safeRect);
  });
});

describe('solveBroadcastFrame — contrato puro', () => {
  it('é determinístico e não muta os DTOs de entrada', () => {
    const frame = cameraFrame();
    const safe = safeFrame(844, 390);
    const frameBefore = structuredClone(frame);
    const safeBefore = structuredClone(safe);

    const first = solveBroadcastFrame(frame, safe);
    const second = solveBroadcastFrame(frame, safe);

    expect(second).toEqual(first);
    expect(frame).toEqual(frameBefore);
    expect(safe).toEqual(safeBefore);
  });

  it('pode reutilizar um buffer explícito sem alterar a pureza da API padrão', () => {
    const output = solveBroadcastFrame(cameraFrame(), safeFrame(844, 390));
    const reused = solveBroadcastFrame(
      cameraFrame({ ball: { x: -5.8, y: 4.8, z: 2.2 } }),
      safeFrame(844, 390),
      output,
      output,
    );

    expect(reused).toBe(output);
    expectInside(reused.subjects.ball, reused.safeRect);
  });
});
