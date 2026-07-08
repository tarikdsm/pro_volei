import { describe, it, expect } from 'vitest';
import { rotateSlots } from './rotation';

describe('rotateSlots', () => {
  it('gira uma posição no sentido do rodízio (horário)', () => {
    expect(rotateSlots([0, 1, 2, 3, 4, 5])).toEqual([5, 0, 1, 2, 3, 4]);
  });

  it('seis rodízios voltam à formação inicial', () => {
    let s = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < 6; i++) s = rotateSlots(s);
    expect(s).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('preserva o conjunto de jogadores (é uma permutação)', () => {
    const s = rotateSlots([2, 5, 0, 3, 1, 4]);
    expect([...s].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('não muta o array original', () => {
    const s = [0, 1, 2, 3, 4, 5];
    rotateSlots(s);
    expect(s).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
