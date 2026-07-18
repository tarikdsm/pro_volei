import { describe, expect, it } from 'vitest';
import { AWAY_ROSTER, HOME_ROSTER } from './roster';

describe('elenco 2.0', () => {
  it('tem 6 atletas por lado com números e nomes únicos', () => {
    expect(HOME_ROSTER).toHaveLength(6);
    expect(AWAY_ROSTER).toHaveLength(6);
    expect(new Set(HOME_ROSTER.map((a) => a.number)).size).toBe(6);
    expect(new Set(AWAY_ROSTER.map((a) => a.number)).size).toBe(6);
    const names = [...HOME_ROSTER, ...AWAY_ROSTER].map((a) => a.name);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(12);
    expect(HOME_ROSTER.map((a) => a.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(AWAY_ROSTER.map((a) => a.number)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('escalas visuais ficam dentro das faixas do plano', () => {
    for (const athlete of [...HOME_ROSTER, ...AWAY_ROSTER]) {
      expect(athlete.heightScale ?? 1).toBeGreaterThanOrEqual(0.94);
      expect(athlete.heightScale ?? 1).toBeLessThanOrEqual(1.06);
      expect(athlete.buildScale ?? 1).toBeGreaterThanOrEqual(0.92);
      expect(athlete.buildScale ?? 1).toBeLessThanOrEqual(1.1);
    }
  });

  it('preserva os looks canônicos de Elisa, Heloisa e Isabela', () => {
    const [elisa, heloisa, isabela] = HOME_ROSTER;
    expect(elisa).toMatchObject({
      name: 'ELISA',
      hair: 0xa87848,
      hairstyle: 'ponytail',
      skin: 0xe8b98a,
    });
    expect(heloisa).toMatchObject({
      name: 'HELOISA',
      hair: 0x121212,
      hairstyle: 'long',
      skin: 0xd6a77a,
    });
    expect(isabela).toMatchObject({
      name: 'ISABELA',
      hair: 0xe8c66b,
      hairstyle: 'ponytail',
      skin: 0xf1c9a0,
    });
  });

  it('varia silhuetas: pelo menos 4 penteados e 4 alturas distintas por elenco completo', () => {
    const all = [...HOME_ROSTER, ...AWAY_ROSTER];
    expect(new Set(all.map((a) => a.hairstyle)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(all.map((a) => a.heightScale ?? 1)).size).toBeGreaterThanOrEqual(4);
  });
});
