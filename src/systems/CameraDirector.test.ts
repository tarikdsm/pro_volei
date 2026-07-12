import { describe, it, expect, vi } from 'vitest';
import { camModeForTouch, CameraDirector } from './CameraDirector';
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
    // performance.now determinístico para evitar flakiness na fase do shake senoidal
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
    d.addShake(1);
    d.update(0.016);
    expect(d.camera.position.distanceTo(semShake)).toBeGreaterThan(0.05);
    nowSpy.mockRestore();
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
