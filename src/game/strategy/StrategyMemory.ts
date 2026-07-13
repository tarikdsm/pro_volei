import type {
  StrategyDecisionKind,
  StrategyMemoryOutcome,
  StrategyMemorySnapshot,
  StrategyOptionId,
} from './StrategyTypes';

const OUTCOME_CAPACITY_PER_KIND = 6;
const CHOICE_CAPACITY_PER_KIND = 3;

export const STRATEGY_MEMORY_WEIGHTS = Object.freeze([1, 0.72, 0.52, 0.37, 0.27, 0.19]);

function optionKind(optionId: StrategyOptionId): StrategyDecisionKind {
  return optionId.slice(0, optionId.indexOf('.')) as StrategyDecisionKind;
}

function nextRevision(memory: StrategyMemorySnapshot): number {
  const revision = memory.revision + 1;
  if (!Number.isSafeInteger(revision)) throw new RangeError('revision da memória excedeu o limite');
  return revision;
}

function freezeMemory(
  revision: number,
  outcomes: readonly StrategyMemoryOutcome[],
  recentChoices: readonly StrategyOptionId[],
): StrategyMemorySnapshot {
  return Object.freeze({
    revision,
    outcomes: Object.freeze(outcomes.map((outcome) => Object.freeze({ ...outcome }))),
    recentChoices: Object.freeze([...recentChoices]),
  });
}

function appendCappedByKind<T>(
  source: readonly T[],
  value: T,
  kindOf: (entry: T) => StrategyDecisionKind,
  capacity: number,
): readonly T[] {
  const result = [...source, value];
  const kind = kindOf(value);
  if (result.filter((entry) => kindOf(entry) === kind).length > capacity) {
    result.splice(
      result.findIndex((entry) => kindOf(entry) === kind),
      1,
    );
  }
  return result;
}

export function createStrategyMemory(revision = 0): StrategyMemorySnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError('revision da memória deve ser inteiro seguro não negativo');
  }
  return freezeMemory(revision, [], []);
}

export function recordStrategyOutcome(
  memory: StrategyMemorySnapshot,
  outcome: StrategyMemoryOutcome,
): StrategyMemorySnapshot {
  if (optionKind(outcome.optionId) !== outcome.kind) {
    throw new RangeError('kind e optionId do outcome são incompatíveis');
  }
  if (
    !Number.isFinite(outcome.effectiveness) ||
    outcome.effectiveness < 0 ||
    outcome.effectiveness > 1
  ) {
    throw new RangeError('effectiveness deve estar em [0,1]');
  }
  return freezeMemory(
    nextRevision(memory),
    appendCappedByKind(memory.outcomes, outcome, (entry) => entry.kind, OUTCOME_CAPACITY_PER_KIND),
    memory.recentChoices,
  );
}

export function recordStrategyChoice(
  memory: StrategyMemorySnapshot,
  optionId: StrategyOptionId,
): StrategyMemorySnapshot {
  return freezeMemory(
    nextRevision(memory),
    memory.outcomes,
    appendCappedByKind(memory.recentChoices, optionId, optionKind, CHOICE_CAPACITY_PER_KIND),
  );
}

export function resetStrategyMemory(memory: StrategyMemorySnapshot): StrategyMemorySnapshot {
  void memory;
  return createStrategyMemory();
}
