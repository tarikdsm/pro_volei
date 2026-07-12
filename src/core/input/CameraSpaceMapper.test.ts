import { describe, expect, it } from 'vitest';
import { mapScreenToCourt, type CameraGroundBasis } from './CameraSpaceMapper';

const BROADCAST_BASIS: CameraGroundBasis = {
  screenRight: { x: 1, z: 0 },
  screenUp: { x: 0, z: -1 },
  revision: 3,
};

const SERVE_BASIS: CameraGroundBasis = {
  screenRight: { x: 0, z: 1 },
  screenUp: { x: 1, z: 0 },
  revision: 7,
};

describe('mapScreenToCourt', () => {
  it('acompanha direita e cima do enquadramento broadcast', () => {
    expect(mapScreenToCourt({ right: 1, up: 0 }, BROADCAST_BASIS)).toEqual({ x: 1, z: 0 });
    expect(mapScreenToCourt({ right: 0, up: 1 }, BROADCAST_BASIS)).toEqual({ x: 0, z: -1 });
  });

  it('acompanha direita e cima do enquadramento de saque', () => {
    expect(mapScreenToCourt({ right: 1, up: 0 }, SERVE_BASIS)).toEqual({ x: 0, z: 1 });
    expect(mapScreenToCourt({ right: 0, up: 1 }, SERVE_BASIS)).toEqual({ x: 1, z: 0 });
  });

  it('normaliza diagonais sem alterar sua direcao', () => {
    const axis = mapScreenToCourt({ right: 1, up: 1 }, BROADCAST_BASIS);

    expect(axis.x).toBeCloseTo(Math.SQRT1_2);
    expect(axis.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('limita a magnitude mesmo se eixo e base vierem acima do intervalo', () => {
    const axis = mapScreenToCourt(
      { right: 4, up: -3 },
      {
        screenRight: { x: 2, z: 0 },
        screenUp: { x: 0, z: 5 },
        revision: 9,
      },
    );

    expect(Math.hypot(axis.x, axis.z)).toBeCloseTo(1);
    expect(axis.x).toBeCloseTo(0.8);
    expect(axis.z).toBeCloseTo(-0.6);
  });
});
