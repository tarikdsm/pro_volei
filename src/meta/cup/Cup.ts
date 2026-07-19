import type { CupProgress } from '../../platform/save/SaveSchema';

export type CupResultStatus = 'retry' | 'next' | 'champion';

export interface CupTransition {
  readonly status: CupResultStatus;
  readonly progress: Readonly<CupProgress>;
}

export function normalizeCupProgress(value: unknown): Readonly<CupProgress> {
  const source = isRecord(value) ? value : {};
  const round = clampInteger(source.currentRound, 0, 4);
  const attemptsSource = Array.isArray(source.attempts) ? source.attempts : [];
  return Object.freeze({
    currentRound: round,
    completed: round === 4 || source.completed === true,
    attempts: Object.freeze(
      Array.from({ length: 4 }, (_, index) => nonNegativeInteger(attemptsSource[index])),
    ),
  });
}

export function advanceCup(progress: CupProgress, homeWon: boolean): CupTransition {
  const current = normalizeCupProgress(progress);
  if (current.completed) return Object.freeze({ status: 'champion', progress: current });

  if (!homeWon) {
    const attempts = [...current.attempts];
    attempts[current.currentRound]++;
    return Object.freeze({
      status: 'retry',
      progress: Object.freeze({ ...current, attempts: Object.freeze(attempts) }),
    });
  }

  const currentRound = current.currentRound + 1;
  const completed = currentRound === 4;
  return Object.freeze({
    status: completed ? 'champion' : 'next',
    progress: Object.freeze({ ...current, currentRound, completed }),
  });
}

export function restartCup(): Readonly<CupProgress> {
  return normalizeCupProgress(undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : min;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
