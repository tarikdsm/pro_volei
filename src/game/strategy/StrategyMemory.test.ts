import { describe, expect, it } from 'vitest';
import {
  STRATEGY_MEMORY_WEIGHTS,
  createStrategyMemory,
  recordStrategyChoice,
  recordStrategyOutcome,
  resetStrategyMemory,
} from './StrategyMemory';

describe('StrategyMemory', () => {
  it('mantém no máximo seis outcomes por categoria em ordem cronológica', () => {
    let memory = createStrategyMemory();
    for (let index = 0; index < 8; index++) {
      memory = recordStrategyOutcome(memory, {
        kind: 'serve',
        optionId: 'serve.float-deep.center',
        effectiveness: index / 10,
      });
      memory = recordStrategyOutcome(memory, {
        kind: 'attack',
        optionId: 'attack.placed-line',
        effectiveness: index / 10,
      });
    }

    expect(
      memory.outcomes
        .filter((outcome) => outcome.kind === 'serve')
        .map((outcome) => outcome.effectiveness),
    ).toEqual([0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(memory.outcomes.filter((outcome) => outcome.kind === 'attack')).toHaveLength(6);
    expect(memory.revision).toBe(16);
  });

  it('mantém três escolhas por categoria sem perder repetições intercaladas', () => {
    let memory = createStrategyMemory();
    for (let index = 0; index < 4; index++) {
      memory = recordStrategyChoice(memory, 'attack.placed-line');
      memory = recordStrategyChoice(memory, index % 2 === 0 ? 'set.high-left' : 'set.high-right');
    }

    expect(memory.recentChoices.filter((choice) => choice.startsWith('attack.'))).toEqual([
      'attack.placed-line',
      'attack.placed-line',
      'attack.placed-line',
    ]);
    expect(memory.recentChoices.filter((choice) => choice.startsWith('set.'))).toHaveLength(3);
    expect(Object.isFrozen(memory)).toBe(true);
    expect(Object.isFrozen(memory.recentChoices)).toBe(true);
  });

  it('expõe os pesos canônicos na ordem do mais recente ao mais antigo', () => {
    expect(STRATEGY_MEMORY_WEIGHTS).toEqual([1, 0.72, 0.52, 0.37, 0.27, 0.19]);
    expect(Object.isFrozen(STRATEGY_MEMORY_WEIGHTS)).toBe(true);
  });

  it('zera conteúdo e revisão para uma nova partida', () => {
    const learned = recordStrategyOutcome(createStrategyMemory(), {
      kind: 'serve',
      optionId: 'serve.float-short.left',
      effectiveness: 0.75,
    });

    expect(resetStrategyMemory(learned)).toEqual({ revision: 0, outcomes: [], recentChoices: [] });
  });

  it('rejeita overflow da revisão sem produzir memória inválida', () => {
    const saturated = createStrategyMemory(Number.MAX_SAFE_INTEGER);
    expect(() => recordStrategyChoice(saturated, 'serve.float-deep.center')).toThrow(/revision/i);
    expect(() =>
      recordStrategyOutcome(saturated, {
        kind: 'serve',
        optionId: 'serve.float-deep.center',
        effectiveness: 1,
      }),
    ).toThrow(/revision/i);
  });
});
