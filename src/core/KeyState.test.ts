import { describe, it, expect } from 'vitest';
import { KeyState } from './KeyState';

describe('KeyState — detecção de borda', () => {
  it('wasPressed é true na frame do keyDown e false após endFrame()', () => {
    const k = new KeyState();
    k.keyDown('Space');
    expect(k.wasPressed('Space')).toBe(true);
    expect(k.isDown('Space')).toBe(true);

    k.endFrame();
    expect(k.wasPressed('Space')).toBe(false); // a borda foi consumida
    expect(k.isDown('Space')).toBe(true); // o estado contínuo persiste
  });

  it('keyDown com repeat=true NÃO marca pressed (auto-repeat do SO é ignorado)', () => {
    const k = new KeyState();
    k.keyDown('Escape', true);
    expect(k.wasPressed('Escape')).toBe(false);
    expect(k.isDown('Escape')).toBe(false);
  });

  it('keyUp marca wasReleased e limpa isDown', () => {
    const k = new KeyState();
    k.keyDown('Space');
    k.endFrame(); // zera a borda de pressionar
    k.keyUp('Space');
    expect(k.wasReleased('Space')).toBe(true);
    expect(k.isDown('Space')).toBe(false);

    k.endFrame();
    expect(k.wasReleased('Space')).toBe(false); // a borda de soltar também é por-frame
  });

  it('blur() limpa todas as teclas pressionadas (foco perdido)', () => {
    const k = new KeyState();
    k.keyDown('KeyW');
    k.keyDown('KeyD');
    expect(k.isDown('KeyW')).toBe(true);
    expect(k.isDown('KeyD')).toBe(true);

    k.blur();
    expect(k.isDown('KeyW')).toBe(false);
    expect(k.isDown('KeyD')).toBe(false);
  });
});

describe('KeyState.moveAxis — normalização', () => {
  it('W+S simultâneos se cancelam no eixo x', () => {
    const k = new KeyState();
    k.keyDown('KeyW');
    k.keyDown('KeyS');
    expect(k.moveAxis().x).toBe(0);
  });

  it('A+D simultâneos se cancelam no eixo z', () => {
    const k = new KeyState();
    k.keyDown('KeyA');
    k.keyDown('KeyD');
    expect(k.moveAxis().z).toBe(0);
  });

  it('diagonal W+D é normalizada para módulo 1', () => {
    const k = new KeyState();
    k.keyDown('KeyW');
    k.keyDown('KeyD');
    const { x, z } = k.moveAxis();
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
  });

  it('as setas equivalem ao WASD (ArrowUp == KeyW, ArrowRight == KeyD)', () => {
    const arrows = new KeyState();
    arrows.keyDown('ArrowUp');
    expect(arrows.moveAxis()).toEqual({ x: 1, z: 0 });

    const both = new KeyState();
    both.keyDown('ArrowRight');
    both.keyDown('KeyD'); // seta + WASD na mesma direção não somam além de 1
    expect(both.moveAxis()).toEqual({ x: 0, z: 1 });
  });
});
