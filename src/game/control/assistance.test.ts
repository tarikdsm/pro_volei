import { describe, expect, it } from 'vitest';
import { AUTO_SELECTOR, COURT, TeamSide } from '../../core/constants';
import { assistedTarget } from './assistance';

describe('assistedTarget', () => {
  it('não altera alvo que já coincide com o contato', () => {
    expect(assistedTarget({ x: -4, z: 1 }, { x: -4, z: 1 }, TeamSide.HOME)).toEqual({
      x: -4,
      z: 1,
    });
  });

  it('limita correção diagonal ao raio de 0,65 m', () => {
    const manual = { x: -6, z: 0 };
    const target = assistedTarget(manual, { x: -3, z: 4 }, TeamSide.HOME);

    expect(Math.hypot(target.x - manual.x, target.z - manual.z)).toBeCloseTo(
      AUTO_SELECTOR.assistanceRadius,
      12,
    );
  });

  it('não cruza a rede e respeita a zona livre', () => {
    const home = assistedTarget({ x: -0.2, z: 0 }, { x: 2, z: 0 }, TeamSide.HOME);
    const away = assistedTarget({ x: 0.2, z: 0 }, { x: -2, z: 0 }, TeamSide.AWAY);
    const edge = assistedTarget(
      { x: -5, z: COURT.halfWidth + COURT.freeZone - 0.1 },
      { x: -5, z: 30 },
      TeamSide.HOME,
    );

    expect(home.x).toBeLessThanOrEqual(-AUTO_SELECTOR.netMargin);
    expect(away.x).toBeGreaterThanOrEqual(AUTO_SELECTOR.netMargin);
    expect(edge.z).toBeLessThanOrEqual(COURT.halfWidth + COURT.freeZone);
  });

  it('parte sempre da âncora manual e não acumula drift entre chamadas', () => {
    const manual = { x: -6, z: 0 };
    const contact = { x: -3, z: 0 };

    const first = assistedTarget(manual, contact, TeamSide.HOME);
    const repeated = assistedTarget(manual, contact, TeamSide.HOME);

    expect(repeated).toEqual(first);
    expect(first.x).toBeCloseTo(manual.x + AUTO_SELECTOR.assistanceRadius);
  });
});
