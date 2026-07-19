import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../../platform/save/SaveSchema';
import { cosmeticSelection, selectCosmetic } from './CosmeticProgress';

describe('CosmeticProgress', () => {
  it('aceita somente item existente, da categoria e já liberado', () => {
    const base = createDefaultSave().unlocks;
    expect(selectCosmetic(base, 'uniform', 'uniform.copa-saque')).toEqual(base);
    const unlocked = { ...base, unlocked: [...base.unlocked, 'uniform.copa-saque'] };
    expect(selectCosmetic(unlocked, 'uniform', 'uniform.copa-saque').selected.uniform).toBe(
      'uniform.copa-saque',
    );
    expect(selectCosmetic(unlocked, 'uniform', 'palette.copa-velocidade')).toEqual(unlocked);
  });

  it('cai nas quatro bases quando a seleção está ausente ou inválida', () => {
    expect(cosmeticSelection({ unlocked: [], selected: {} as never })).toEqual({
      uniform: 'uniform.base',
      palette: 'palette.base',
      court: 'court.base',
      effect: 'effect.base',
    });
  });
});
