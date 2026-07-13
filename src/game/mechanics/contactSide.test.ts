import { describe, expect, it } from 'vitest';
import { TeamSide, otherSide } from '../../core/constants';
import { contactSideAt } from './contactSide';

describe('contactSideAt', () => {
  it('usa a posição fora do plano da rede', () => {
    expect(contactSideAt(-0.1, 10, TeamSide.AWAY)).toBe(TeamSide.HOME);
    expect(contactSideAt(0.1, -10, TeamSide.HOME)).toBe(TeamSide.AWAY);
  });

  it('desempata x zero pela direção e depois pelo fallback', () => {
    expect(contactSideAt(0, -2, TeamSide.AWAY)).toBe(TeamSide.HOME);
    expect(contactSideAt(0, 2, TeamSide.HOME)).toBe(TeamSide.AWAY);
    expect(contactSideAt(0, 0, TeamSide.HOME)).toBe(TeamSide.HOME);
  });

  it.each([
    [-2, 4, TeamSide.HOME],
    [2, -4, TeamSide.AWAY],
    [0, 3, TeamSide.HOME],
    [0, 0, TeamSide.AWAY],
  ] as const)('preserva a reflexão para x=%s, vx=%s', (x, velocityX, fallback) => {
    const original = contactSideAt(x, velocityX, fallback);
    const mirrored = contactSideAt(-x, -velocityX, otherSide(fallback));
    expect(mirrored).toBe(otherSide(original));
  });
});
