import {
  BASE_COSMETICS,
  type CosmeticCategory,
  type CosmeticSelection,
  type UnlockState,
} from '../../platform/save/SaveSchema';
import { cosmeticById } from './CosmeticCatalog';

export function cosmeticSelection(unlocks: Readonly<UnlockState>): CosmeticSelection {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(BASE_COSMETICS) as CosmeticCategory[]).map((category) => {
        const selected = unlocks.selected[category];
        const definition = cosmeticById(selected);
        return [
          category,
          definition?.category === category && unlocks.unlocked.includes(selected)
            ? selected
            : BASE_COSMETICS[category],
        ];
      }),
    ) as Record<CosmeticCategory, string>,
  );
}

export function selectCosmetic(
  unlocks: Readonly<UnlockState>,
  category: CosmeticCategory,
  id: string,
): Readonly<UnlockState> {
  const definition = cosmeticById(id);
  if (!definition || definition.category !== category || !unlocks.unlocked.includes(id)) {
    return unlocks;
  }
  return Object.freeze({
    unlocked: Object.freeze([...unlocks.unlocked]),
    selected: Object.freeze({ ...cosmeticSelection(unlocks), [category]: id }),
  });
}
