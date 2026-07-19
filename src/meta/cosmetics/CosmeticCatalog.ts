import type { CosmeticCategory } from '../../platform/save/SaveSchema';

interface CosmeticBase {
  readonly id: string;
  readonly category: CosmeticCategory;
  readonly name: string;
  readonly requirement: string;
}

export interface UniformCosmetic extends CosmeticBase {
  readonly category: 'uniform';
  readonly presentation: Readonly<{ jersey: number; shorts: number }>;
}

export interface PaletteCosmetic extends CosmeticBase {
  readonly category: 'palette';
  readonly presentation: Readonly<{
    background: number;
    steps: number;
    faces: number;
    wall: number;
    ceiling: number;
    accent: number;
  }>;
}

export interface CourtCosmetic extends CosmeticBase {
  readonly category: 'court';
  readonly presentation: Readonly<{ free: number; floor: number; zone: number; lines: number }>;
}

export interface EffectCosmetic extends CosmeticBase {
  readonly category: 'effect';
  readonly presentation: Readonly<{ landing: number; aim: number; cue: number }>;
}

export type CosmeticDefinition = UniformCosmetic | PaletteCosmetic | CourtCosmetic | EffectCosmetic;

function cosmetic<T extends CosmeticDefinition>(definition: T): Readonly<T> {
  return Object.freeze({
    ...definition,
    presentation: Object.freeze({ ...definition.presentation }),
  }) as Readonly<T>;
}

export const COSMETIC_CATALOG: readonly Readonly<CosmeticDefinition>[] = Object.freeze([
  cosmetic({
    id: 'uniform.base',
    category: 'uniform',
    name: 'Uniforme Pró Volei',
    requirement: 'Liberado desde o início',
    presentation: { jersey: 0x1565e8, shorts: 0x0c2f6b },
  }),
  cosmetic({
    id: 'uniform.copa-saque',
    category: 'uniform',
    name: 'Uniforme Ondas',
    requirement: 'Vença Ondas do Saque',
    presentation: { jersey: 0x00a8a8, shorts: 0x092b4c },
  }),
  cosmetic({
    id: 'palette.base',
    category: 'palette',
    name: 'Arena Broadcast',
    requirement: 'Liberado desde o início',
    presentation: {
      background: 0x0b1420,
      steps: 0x2a3644,
      faces: 0x202c3a,
      wall: 0x152030,
      ceiling: 0x101823,
      accent: 0x1c4a52,
    },
  }),
  cosmetic({
    id: 'palette.copa-velocidade',
    category: 'palette',
    name: 'Arena Elétrica',
    requirement: 'Vença Raio Veloz',
    presentation: {
      background: 0x07142a,
      steps: 0x253b62,
      faces: 0x182747,
      wall: 0x101f3d,
      ceiling: 0x071126,
      accent: 0x5b3fd6,
    },
  }),
  cosmetic({
    id: 'court.base',
    category: 'court',
    name: 'Quadra Coral',
    requirement: 'Liberado desde o início',
    presentation: {
      free: 0x1f6f6a,
      floor: 0xe0704a,
      zone: 0xd4603c,
      lines: 0xf7f5f0,
    },
  }),
  cosmetic({
    id: 'court.copa-bloqueio',
    category: 'court',
    name: 'Quadra Muralha',
    requirement: 'Vença Muralha Central',
    presentation: { free: 0x102f35, floor: 0x157a78, zone: 0x116561, lines: 0xf4f7df },
  }),
  cosmetic({
    id: 'effect.base',
    category: 'effect',
    name: 'Efeito Clássico',
    requirement: 'Liberado desde o início',
    presentation: {
      landing: 0xffe14f,
      aim: 0x66e0ff,
      cue: 0xeaffff,
    },
  }),
  cosmetic({
    id: 'effect.copa-leitura',
    category: 'effect',
    name: 'Efeito Visão Tática',
    requirement: 'Vença Visão Tática',
    presentation: { landing: 0xff72c6, aim: 0x70fff1, cue: 0xff72c6 },
  }),
]);

export function cosmeticById(id: string): Readonly<CosmeticDefinition> | undefined {
  return COSMETIC_CATALOG.find((entry) => entry.id === id);
}

export function cosmeticFallback(category: CosmeticCategory): Readonly<CosmeticDefinition> {
  return COSMETIC_CATALOG.find((entry) => entry.id === `${category}.base`)!;
}
