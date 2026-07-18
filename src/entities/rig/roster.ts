// Elenco fictício 2.0 (Fase 4C): 12 atletas nomeadas com identidades visuais distintas —
// penteado, tom de pele, cabelo, altura e porte. Cores de uniforme vêm do time (COLORS.*).
// Elisa, Heloisa e Isabela preservam os looks canônicos da v1.1 (§5.2 do design).
import type { CharLook } from '../PlayerCharacter';

export type RosterEntry = Omit<CharLook, 'jersey' | 'shorts'>;

export const HOME_ROSTER: readonly RosterEntry[] = Object.freeze([
  {
    name: 'ELISA',
    number: 1,
    hair: 0xa87848, // castanho claro
    hairstyle: 'ponytail',
    skin: 0xe8b98a,
    female: true,
  },
  {
    name: 'HELOISA',
    number: 2,
    hair: 0x121212, // preto liso
    hairstyle: 'long',
    skin: 0xd6a77a,
    female: true,
    heightScale: 1.04,
    buildScale: 0.96,
  },
  {
    name: 'ISABELA',
    number: 3,
    hair: 0xe8c66b, // loira
    hairstyle: 'ponytail',
    skin: 0xf1c9a0,
    female: true,
    heightScale: 0.97,
  },
  {
    name: 'MARINA', // central alta e forte
    number: 4,
    hair: 0x2b1b12,
    hairstyle: 'bun',
    skin: 0x8d5524,
    female: true,
    heightScale: 1.06,
    buildScale: 1.06,
  },
  {
    name: 'CAROL', // líbero baixinha e ágil
    number: 5,
    hair: 0x4e342e,
    hairstyle: 'braid',
    skin: 0xc68642,
    female: true,
    heightScale: 0.94,
    buildScale: 0.94,
  },
  {
    name: 'TAINÁ',
    number: 6,
    hair: 0x101010,
    hairstyle: 'short',
    skin: 0xb07b52,
    female: true,
    heightScale: 1.02,
    buildScale: 1.04,
  },
]);

export const AWAY_ROSTER: readonly RosterEntry[] = Object.freeze([
  {
    name: 'VALQUIRIA',
    number: 7,
    hair: 0x1a1a1a,
    hairstyle: 'long',
    skin: 0x8d5524,
    female: true,
    heightScale: 1.05,
    buildScale: 1.02,
  },
  {
    name: 'REGINA', // oposta de força
    number: 8,
    hair: 0x3e2723,
    hairstyle: 'short',
    skin: 0xe0ac69,
    female: true,
    buildScale: 1.08,
  },
  {
    name: 'JULIA',
    number: 9,
    hair: 0x6d4c41,
    hairstyle: 'braid',
    skin: 0xf1c27d,
    female: true,
    heightScale: 0.96,
    buildScale: 0.95,
  },
  {
    name: 'KAUANE',
    number: 10,
    hair: 0x101010,
    hairstyle: 'bun',
    skin: 0xb07b52,
    female: true,
    heightScale: 1.03,
  },
  {
    name: 'SOFIA',
    number: 11,
    hair: 0x4e342e,
    hairstyle: 'ponytail',
    skin: 0xd6a77a,
    female: true,
    heightScale: 0.98,
    buildScale: 0.97,
  },
  {
    name: 'BRUNA', // ponteira alta
    number: 12,
    hair: 0xe8c66b,
    hairstyle: 'long',
    skin: 0xf1c9a0,
    female: true,
    heightScale: 1.06,
    buildScale: 1.05,
  },
]);
