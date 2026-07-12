import { describe, it, expect, vi } from 'vitest';
import { camModeForTouch, CameraDirector } from './CameraDirector';
import type { TouchKind } from '../core/constants';
import type { CameraFrame, SafeFrame } from './camera/CameraFrame';

const cameraFrame: CameraFrame = {
  ball: { x: -4, y: 3, z: 1 },
  controlled: { x: -6, y: 1, z: 0 },
  destination: { x: 5, y: 1, z: -2 },
  bounds: { min: { x: -14, y: 0, z: -8 }, max: { x: 14, y: 10, z: 8 } },
  phase: 'rally',
  contactIn: 0.7,
};
const safeFrame: SafeFrame = {
  viewport: { width: 844, height: 390 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  overlays: [],
};

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

describe('CameraDirector — projeção sob demanda (B10)', () => {
  it('não recalcula a projeção com o FOV estável', () => {
    const d = new CameraDirector(16 / 9);
    const spy = vi.spyOn(d.camera, 'updateProjectionMatrix');
    // sem kickFov o fovKick fica em 0 e o FOV permanece no baseFov => nenhum recálculo
    for (let i = 0; i < 10; i++) d.update(0.016);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('recalcula a projeção quando kickFov altera o FOV', () => {
    const d = new CameraDirector(16 / 9);
    d.kickFov(8);
    const spy = vi.spyOn(d.camera, 'updateProjectionMatrix');
    d.update(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(d.camera.fov).toBeGreaterThan(55);
    expect(d.camera.fov).toBeLessThanOrEqual(61);
  });

  it('limita o punch a +6° e só recalcula acima do epsilon visual', () => {
    const d = new CameraDirector(16 / 9);
    d.kickFov(99);
    for (let i = 0; i < 8; i++) d.update(1 / 120);
    expect(d.camera.fov).toBeLessThanOrEqual(61);

    for (let i = 0; i < 180; i++) d.update(1 / 120);
    const spy = vi.spyOn(d.camera, 'updateProjectionMatrix');
    d.update(1 / 120);
    expect(spy).not.toHaveBeenCalled();
  });

  it('para de recalcular depois que o FOV punch decai a zero', () => {
    const d = new CameraDirector(16 / 9);
    d.kickFov(8);
    // fovKick decai 26/s a partir de 8 => ~0,31s (< 25 frames de 0,016s) para zerar
    for (let i = 0; i < 25; i++) d.update(0.016);
    const spy = vi.spyOn(d.camera, 'updateProjectionMatrix');
    for (let i = 0; i < 5; i++) d.update(0.016);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(d.camera.fov).toBeCloseTo(55);
  });
});

describe('CameraDirector — offset pré-alocado do screen shake (B10)', () => {
  it('preserva a posição convergida sem shake (o prealloc do offset não altera o resultado)', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('serveAway', { cut: false });
    // sem shake a câmera converge ao targetPos do modo serveAway (-15.5, 6.4, 0)
    for (let i = 0; i < 300; i++) d.update(0.016);
    expect(d.camera.position.x).toBeCloseTo(-15.5, 1);
    expect(d.camera.position.y).toBeCloseTo(6.4, 1);
  });

  it('ainda aplica o deslocamento do shake sobre a posição amortecida', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('serveAway', { cut: false });
    for (let i = 0; i < 300; i++) d.update(0.016);
    const semShake = d.camera.position.clone();
    d.addShake(1);
    d.update(0.016);
    expect(d.camera.position.distanceTo(semShake)).toBeGreaterThan(0.05);
  });

  it('shake é determinístico por dt e termina em até 300 ms', () => {
    const a = new CameraDirector(16 / 9);
    const b = new CameraDirector(16 / 9);
    a.setMode('serveAway', { cut: true });
    b.setMode('serveAway', { cut: true });
    a.addShake(1);
    b.addShake(1);

    for (let i = 0; i < 10; i++) {
      a.update(0.02);
      b.update(0.02);
      expect(a.camera.position.toArray()).toEqual(b.camera.position.toArray());
    }
    for (let i = 0; i < 5; i++) a.update(0.02);
    expect(a.camera.position.x).toBeCloseTo(-15.5, 5);
    expect(a.camera.position.y).toBeCloseTo(6.4, 5);
  });

  it('perfil reduzido zera shake, FOV e órbita decorativa', () => {
    const d = new CameraDirector(16 / 9, 'reduced');
    d.setMode('point', { cut: true, side: 0 });
    for (let i = 0; i < 300; i++) d.update(1 / 60);
    const settled = d.camera.position.clone();
    d.addShake(1);
    d.kickFov(6);
    for (let i = 0; i < 30; i++) d.update(1 / 60);

    expect(d.camera.fov).toBe(55);
    expect(d.camera.position.distanceTo(settled)).toBeLessThan(0.001);
  });
});

describe('CameraDirector — base de input no plano da quadra', () => {
  it('retorna um snapshot plano e normalizado dos eixos visuais da câmera', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('rally', { cut: true });
    d.update(0);

    const basis = d.inputBasis();

    expect(Math.hypot(basis.screenRight.x, basis.screenRight.z)).toBeCloseTo(1);
    expect(Math.hypot(basis.screenUp.x, basis.screenUp.z)).toBeCloseTo(1);
    expect(basis.screenRight.x).toBeGreaterThan(0.99);
    expect(basis.screenUp.z).toBeLessThan(-0.9);
    expect(Object.getPrototypeOf(basis.screenRight)).toBe(Object.prototype);
  });

  it('avança a revisão somente quando uma nova base válida muda', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('rally', { cut: true });
    d.update(0);
    const broadcast = d.inputBasis();

    expect(d.inputBasis().revision).toBe(broadcast.revision);

    d.servePos.set(-12, 0, 0);
    d.setMode('serveHome', { cut: true });
    d.update(0);
    const saque = d.inputBasis();

    expect(saque.revision).toBeGreaterThan(broadcast.revision);
    expect(Math.abs(saque.screenRight.z)).toBeGreaterThan(0.9);
    expect(saque.screenUp.x).toBeGreaterThan(0.9);
  });

  it('reutiliza a última base e revisão quando a projeção horizontal degenera', () => {
    const d = new CameraDirector(16 / 9);
    d.setMode('rally', { cut: true });
    d.update(0);
    const valida = d.inputBasis();

    d.camera.quaternion.set(0, 0, Math.SQRT1_2, Math.SQRT1_2);
    const fallback = d.inputBasis();

    expect(fallback).toEqual(valida);
  });
});

describe('CameraDirector — framing semântico', () => {
  it('consome o solver e só antecipa spike nos 350 ms finais', () => {
    const d = new CameraDirector(844 / 390);
    d.setMode('spike');
    d.setFrame(cameraFrame, safeFrame);
    d.update(1 / 60);
    expect(d.presentationSnapshot().activeMode).toBe('rally');
    expect(d.presentationSnapshot().solution?.destinationIncluded).toBe(true);

    d.setFrame({ ...cameraFrame, phase: 'spike', contactIn: 0.35 }, safeFrame);
    d.update(1 / 60);
    expect(d.presentationSnapshot().activeMode).toBe('spike');

    d.setFrame({ ...cameraFrame, phase: 'rally', contactIn: null }, safeFrame);
    d.update(1 / 60);
    expect(d.presentationSnapshot().activeMode).toBe('rally');
  });

  it('snapshot é readonly por valor e inclui pose apresentada', () => {
    const d = new CameraDirector(16 / 9);
    d.setFrame(cameraFrame, safeFrame);
    d.setMode('rally', { cut: true });
    d.update(0);

    const snapshot = d.presentationSnapshot();
    expect(snapshot.position).toEqual({
      x: d.camera.position.x,
      y: d.camera.position.y,
      z: d.camera.position.z,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('projeta os sujeitos reais dentro do safe frame assimétrico', () => {
    const d = new CameraDirector(844 / 390);
    const asymmetric: SafeFrame = {
      viewport: { width: 844, height: 390 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      overlays: [
        { x: 0, y: 260, width: 150, height: 130 },
        { x: 720, y: 260, width: 124, height: 130 },
        { x: 270, y: 0, width: 304, height: 82 },
      ],
    };
    d.setFrame(cameraFrame, asymmetric);
    d.setMode('rally', { cut: true });
    d.update(0);

    const snapshot = d.presentationSnapshot();
    const safe = snapshot.solution!.safeRect;
    for (const subject of [snapshot.actualSubjects!.ball, snapshot.actualSubjects!.controlled!]) {
      expect(subject.x).toBeGreaterThanOrEqual(safe.x);
      expect(subject.x).toBeLessThanOrEqual(safe.x + safe.width);
      expect(subject.y).toBeGreaterThanOrEqual(safe.y);
      expect(subject.y).toBeLessThanOrEqual(safe.y + safe.height);
    }
  });

  it('não inverte a base de input durante rally → spike → rally', () => {
    const d = new CameraDirector(16 / 9);
    d.setFrame(cameraFrame, safeFrame);
    d.setMode('rally', { cut: true });
    d.update(0);
    const initial = d.inputBasis();

    d.setMode('spike');
    d.setFrame({ ...cameraFrame, phase: 'spike', contactIn: 0.2 }, safeFrame);
    for (let i = 0; i < 30; i++) d.update(1 / 60);
    const spike = d.inputBasis();
    const rightDot =
      initial.screenRight.x * spike.screenRight.x + initial.screenRight.z * spike.screenRight.z;

    expect(rightDot).toBeGreaterThan(0.99);
    expect(spike.screenRight.x).toBeGreaterThan(0.99);
  });

  it('suaviza mudança de overlay sem corte seco de lente ou pose', () => {
    const d = new CameraDirector(844 / 390);
    d.setFrame(cameraFrame, safeFrame);
    d.setMode('rally', { cut: true });
    d.update(0);
    const beforeOffset = d.camera.view!.offsetY;
    const beforePosition = d.camera.position.clone();
    const withBottomOverlay: SafeFrame = {
      ...safeFrame,
      overlays: [{ x: 0, y: 260, width: 844, height: 130 }],
    };

    d.setFrame(cameraFrame, withBottomOverlay);
    expect(d.camera.view!.offsetY).toBe(beforeOffset);
    expect(d.camera.position.toArray()).toEqual(beforePosition.toArray());

    d.update(1 / 60);
    const targetOffset =
      390 / 2 -
      (d.presentationSnapshot().solution!.safeRect.y +
        d.presentationSnapshot().solution!.safeRect.height / 2);
    expect(d.camera.view!.offsetY).toBeGreaterThan(beforeOffset);
    expect(d.camera.view!.offsetY).toBeLessThan(targetOffset);
  });
});
