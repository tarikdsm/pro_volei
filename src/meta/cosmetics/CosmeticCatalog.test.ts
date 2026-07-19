import { describe, expect, it } from 'vitest';
import { COSMETIC_CATALOG, cosmeticById, cosmeticFallback } from './CosmeticCatalog';

describe('CosmeticCatalog', () => {
  it('contém quatro bases e quatro recompensas com IDs únicos', () => {
    expect(COSMETIC_CATALOG).toHaveLength(8);
    expect(new Set(COSMETIC_CATALOG.map((entry) => entry.id)).size).toBe(8);
    for (const category of ['uniform', 'palette', 'court', 'effect'] as const) {
      expect(cosmeticFallback(category).id).toBe(`${category}.base`);
      expect(COSMETIC_CATALOG.filter((entry) => entry.category === category)).toHaveLength(2);
    }
  });

  it('é integralmente local e não contém campos de gameplay', () => {
    const serialized = JSON.stringify(COSMETIC_CATALOG);
    expect(serialized).not.toMatch(
      /https?:|url|gravity|speed|jump|reach|difficulty|timing|physics|rules/i,
    );
    expect(cosmeticById('uniform.inexistente')).toBeUndefined();
  });
});
