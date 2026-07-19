import {
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  type AudioSettings,
} from '../../core/audio/AudioSettings';

export const SAVE_VERSION = 1 as const;
export const BASE_COSMETICS = Object.freeze({
  uniform: 'uniform.base',
  palette: 'palette.base',
  court: 'court.base',
  effect: 'effect.base',
} as const);

export type ColorPreset = 'default' | 'protan-deutan' | 'tritan';
export type TimingAssist = 'normal' | 'wide';
export type HudScale = 0.85 | 1 | 1.15;
export type CosmeticCategory = keyof typeof BASE_COSMETICS;

export interface Preferences {
  readonly difficulty: 0 | 1 | 2;
  readonly format: 0 | 1 | 2;
  readonly hudScale: HudScale;
  readonly colorPreset: ColorPreset;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
  readonly shakeEnabled: boolean;
  readonly replayEnabled: boolean;
  readonly captionsEnabled: boolean;
  readonly hapticsEnabled: boolean;
  readonly timingAssist: TimingAssist;
  readonly audio: Readonly<AudioSettings>;
}

export interface CupProgress {
  readonly currentRound: number;
  readonly completed: boolean;
  readonly attempts: readonly number[];
}

export interface CareerStats {
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly aces: number;
  readonly blocks: number;
  readonly longestRally: number;
}

export type CosmeticSelection = Readonly<Record<CosmeticCategory, string>>;

export interface UnlockState {
  readonly unlocked: readonly string[];
  readonly selected: CosmeticSelection;
}

export interface ProVoleiSaveV1 {
  readonly version: typeof SAVE_VERSION;
  readonly preferences: Readonly<Preferences>;
  readonly cup: Readonly<CupProgress>;
  readonly stats: Readonly<CareerStats>;
  readonly unlocks: Readonly<UnlockState>;
}

export function createDefaultSave(): Readonly<ProVoleiSaveV1> {
  return freezeSave({
    version: SAVE_VERSION,
    preferences: {
      difficulty: 1,
      format: 0,
      hudScale: 1,
      colorPreset: 'default',
      highContrast: false,
      reducedMotion: false,
      shakeEnabled: true,
      replayEnabled: true,
      captionsEnabled: true,
      hapticsEnabled: true,
      timingAssist: 'normal',
      audio: { ...DEFAULT_AUDIO_SETTINGS },
    },
    cup: { currentRound: 0, completed: false, attempts: [0, 0, 0, 0] },
    stats: emptyStats(),
    unlocks: {
      unlocked: Object.values(BASE_COSMETICS),
      selected: { ...BASE_COSMETICS },
    },
  });
}

export function normalizeSaveV1(value: unknown): Readonly<ProVoleiSaveV1> {
  if (!isRecord(value)) return createDefaultSave();
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  const cup = isRecord(value.cup) ? value.cup : {};
  const stats = isRecord(value.stats) ? value.stats : {};
  const unlocks = isRecord(value.unlocks) ? value.unlocks : {};
  const matches = nonNegativeInteger(stats.matches);
  const wins = Math.min(matches, nonNegativeInteger(stats.wins));
  const losses = Math.min(Math.max(0, matches - wins), nonNegativeInteger(stats.losses));
  const currentRound = clampInteger(cup.currentRound, 0, 4, 0);
  const unlocked = normalizeUnlocks(unlocks.unlocked);

  return freezeSave({
    version: SAVE_VERSION,
    preferences: {
      difficulty: enumNumber(preferences.difficulty, [0, 1, 2] as const, 1),
      format: enumNumber(preferences.format, [0, 1, 2] as const, 0),
      hudScale: normalizeHudScale(preferences.hudScale),
      colorPreset: enumString(
        preferences.colorPreset,
        ['default', 'protan-deutan', 'tritan'] as const,
        'default',
      ),
      highContrast: booleanOr(preferences.highContrast, false),
      reducedMotion: booleanOr(preferences.reducedMotion, false),
      shakeEnabled: booleanOr(preferences.shakeEnabled, true),
      replayEnabled: booleanOr(preferences.replayEnabled, true),
      captionsEnabled: booleanOr(preferences.captionsEnabled, true),
      hapticsEnabled: booleanOr(preferences.hapticsEnabled, true),
      timingAssist: enumString(preferences.timingAssist, ['normal', 'wide'] as const, 'normal'),
      audio: normalizeAudioSettings(preferences.audio),
    },
    cup: {
      currentRound,
      completed: currentRound === 4 || booleanOr(cup.completed, false),
      attempts: normalizeAttempts(cup.attempts),
    },
    stats: {
      matches,
      wins,
      losses,
      pointsFor: nonNegativeInteger(stats.pointsFor),
      pointsAgainst: nonNegativeInteger(stats.pointsAgainst),
      aces: nonNegativeInteger(stats.aces),
      blocks: nonNegativeInteger(stats.blocks),
      longestRally: nonNegativeInteger(stats.longestRally),
    },
    unlocks: {
      unlocked,
      selected: normalizeSelection(unlocks.selected, unlocked),
    },
  });
}

function emptyStats(): CareerStats {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    aces: 0,
    blocks: 0,
    longestRally: 0,
  };
}

function normalizeAttempts(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 4 }, (_, index) => nonNegativeInteger(source[index]));
}

function normalizeUnlocks(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && /^(uniform|palette|court|effect)\.[a-z0-9-]+$/.test(item),
      )
    : [];
  return [...new Set([...Object.values(BASE_COSMETICS), ...candidates])];
}

function normalizeSelection(value: unknown, unlocked: readonly string[]): CosmeticSelection {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    (Object.keys(BASE_COSMETICS) as CosmeticCategory[]).map((category) => {
      const candidate = source[category];
      return [
        category,
        typeof candidate === 'string' &&
        candidate.startsWith(`${category}.`) &&
        unlocked.includes(candidate)
          ? candidate
          : BASE_COSMETICS[category],
      ];
    }),
  ) as Record<CosmeticCategory, string>;
}

function freezeSave(save: ProVoleiSaveV1): Readonly<ProVoleiSaveV1> {
  const audio = Object.freeze({ ...save.preferences.audio });
  const preferences = Object.freeze({ ...save.preferences, audio });
  const cup = Object.freeze({ ...save.cup, attempts: Object.freeze([...save.cup.attempts]) });
  const stats = Object.freeze({ ...save.stats });
  const selected = Object.freeze({ ...save.unlocks.selected });
  const unlocks = Object.freeze({
    unlocked: Object.freeze([...save.unlocks.unlocked]),
    selected,
  });
  return Object.freeze({ version: SAVE_VERSION, preferences, cup, stats, unlocks });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHudScale(value: unknown): HudScale {
  return value === 0.85 || value === 1 || value === 1.15 ? value : 1;
}

function enumNumber<const T extends readonly number[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'number' && allowed.includes(value) ? value : fallback;
}

function enumString<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}
