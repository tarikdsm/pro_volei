import { describe, expect, it } from 'vitest';
import { Athlete } from './Team';
import { TeamSide } from '../core/constants';
import type { CharLook, CharVisual } from '../entities/PlayerCharacter';

// Dublê que captura o que o Athlete envia ao visual (canal novo da Fase 4B).
function makeSpyChar() {
  const planar: Array<[number, number, boolean]> = [];
  const aims: Array<[number, number, number, number]> = [];
  const char: CharVisual = {
    root: { position: { set: () => {} }, rotation: {} } as unknown as CharVisual['root'],
    moveSpeed: 0,
    jumpY: 0,
    setAction: () => {},
    update: () => {},
    setPlanarMotion: (f, l, b) => planar.push([f, l, b]),
    setContactAim: (x, y, z, s) => aims.push([x, y, z, s]),
  };
  return { char, planar, aims };
}

const LOOK: CharLook = { jersey: 0, shorts: 0, skin: 0, hair: 0, number: 1 };

describe('Athlete → CharVisual (locomoção direcional e alvo de contato)', () => {
  it('movimento na direção do facing produz forward dominante', () => {
    const spy = makeSpyChar();
    const athlete = new Athlete(TeamSide.HOME, 0, LOOK, () => spy.char);
    athlete.faceNet = false;
    athlete.moveTo(10, 0); // corre para +x; facing acompanha a velocidade
    for (let i = 0; i < 60; i += 1) athlete.update(1 / 60, 5.6);

    const [forward, lateral] = spy.planar.at(-1)!;
    expect(forward).toBeGreaterThan(4.5);
    expect(Math.abs(lateral)).toBeLessThan(0.6);
  });

  it('encarando a rede, correr para +z mundial vira passada lateral direita (lateral<0)', () => {
    const spy = makeSpyChar();
    const athlete = new Athlete(TeamSide.HOME, 0, LOOK, () => spy.char);
    athlete.faceNet = true; // HOME encara +x (facing → π/2)
    for (let i = 0; i < 30; i += 1) athlete.update(1 / 60, 5.6); // assenta o facing
    athlete.moveTo(0, 10); // +z mundial = direita de quem encara a rede no lado HOME
    for (let i = 0; i < 30; i += 1) athlete.update(1 / 60, 5.6);

    const [forward, lateral] = spy.planar.at(-1)!;
    expect(lateral).toBeLessThan(-3);
    expect(Math.abs(forward)).toBeLessThan(1.2);
  });

  it('aimContact converte mundo → referencial do root pelo facing', () => {
    const spy = makeSpyChar();
    const athlete = new Athlete(TeamSide.HOME, 0, LOOK, () => spy.char);
    athlete.warpTo(2, 3);
    athlete.facing = Math.PI / 2; // frente local = +x mundial
    athlete.aimContact({ x: 3, y: 1.05, z: 3 }, 0.4);

    const [x, y, z, inSeconds] = spy.aims.at(-1)!;
    expect(x).toBeCloseTo(0, 6); // sem componente lateral
    expect(y).toBeCloseTo(1.05, 6);
    expect(z).toBeCloseTo(1, 6); // 1 m à frente
    expect(inSeconds).toBeCloseTo(0.4, 6);
  });
});
