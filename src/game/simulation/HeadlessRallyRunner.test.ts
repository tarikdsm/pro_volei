import { describe, expect, it, vi } from 'vitest';
import { TeamSide, otherSide } from '../../core/constants';
import { RandomHub } from '../../core/random';
import { isSetOver } from '../rules/scoring';
import { createHeadlessHooks } from './HeadlessHooks';
import {
  HeadlessRallyRunner,
  runHeadlessBatch,
  runHeadlessMatches,
  runHeadlessRally,
} from './HeadlessRallyRunner';

describe('runMatches', () => {
  it('roda uma partida completa 2.0 e resume sets, placar e duração', { timeout: 60_000 }, () => {
    const result = runHeadlessMatches({ seed: 0x3d20_0001, matches: 1 });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(match.sets[match.winner]).toBe(2);
    expect(match.setScores.length).toBeGreaterThanOrEqual(2);
    expect(match.setScores.length).toBeLessThanOrEqual(3);
    match.setScores.forEach(([h, a], index) => {
      const deciding = index === 2;
      expect(isSetOver(h, a, deciding ? 7 : 11, deciding ? 11 : 15)).toBe(true);
    });
    expect(match.points[0] + match.points[1]).toBe(match.rallies);
    expect(match.durationTicks).toBeGreaterThan(0);
    expect(match.durationSeconds).toBeCloseTo(match.durationTicks / 60, 10);
    expect(result.totalTicks).toBeGreaterThanOrEqual(match.durationTicks);
  });

  it('é determinístico por seed', { timeout: 120_000 }, () => {
    const first = runHeadlessMatches({ seed: 0x3d20_0002, matches: 2 });
    const second = runHeadlessMatches({ seed: 0x3d20_0002, matches: 2 });
    expect(second.matches).toEqual(first.matches);
  });

  it('recusa começar no meio de uma partida', { timeout: 60_000 }, () => {
    const runner = new HeadlessRallyRunner({ seed: 0x3d20_0003 });
    runner.run(1);
    expect(() => runner.runMatches(1)).toThrow(/fronteira de partida/);
  });
});

it('resume side-outs, classe do ponto e zonas de ataque por rally', () => {
  const batch = runHeadlessBatch({ seed: 0x3d00_00aa, rallies: 12 });
  const sideOuts: [number, number] = [0, 0];
  const unforced: [number, number] = [0, 0];
  const zoneTotals = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const rally of batch.rallies) {
    expect(typeof rally.sideOut).toBe('boolean');
    expect(rally.sideOut).toBe(rally.winner !== rally.serving);
    expect(['decisive', 'unforced']).toContain(rally.pointClass);
    if (rally.sideOut) sideOuts[rally.winner] += 1;
    if (rally.pointClass === 'unforced') unforced[otherSide(rally.winner)] += 1;
    for (const side of [0, 1]) {
      const zones = rally.attackZones[side];
      expect(zones[0] + zones[1] + zones[2]).toBe(rally.attacks[side]);
      for (let zone = 0; zone < 3; zone += 1) zoneTotals[side][zone] += zones[zone];
    }
  }
  expect(batch.sideOuts).toEqual(sideOuts);
  expect(batch.unforcedErrors).toEqual(unforced);
  expect(batch.attackZoneTotals).toEqual(zoneTotals);
});

describe('HeadlessRallyRunner', () => {
  it('produz o mesmo journal byte a byte para a mesma seed', () => {
    const first = runHeadlessRally({ seed: 1 });
    const replay = runHeadlessRally({ seed: 1 });

    expect(first.serializedJournal).toBe(replay.serializedJournal);
    expect(first.journalHash).toBe(replay.journalHash);
    expect(first.serializedTacticalTrace).toBe(replay.serializedTacticalTrace);
    expect(first.tacticalTraceHash).toBe(replay.tacticalTraceHash);
    expect(first.serializedStrategyTrace).toBe(replay.serializedStrategyTrace);
    expect(first.strategyTraceHash).toBe(replay.strategyTraceHash);
    expect(first).toMatchObject({
      winner: replay.winner,
      durationTicks: replay.durationTicks,
      contacts: replay.contacts,
      cause: replay.cause,
    });
    expect(first.journal[0].type).toBe('rally-start');
    expect(first.journal[1].type).toBe('serve');
    expect(first.journal.at(-1)?.type).toBe('rally-end');
  });

  it('seeds diferentes divergem em conteúdo estocástico', () => {
    const first = runHeadlessRally({ seed: 1 });
    const other = runHeadlessRally({ seed: 2 });

    expect(first.journal).not.toEqual(other.journal);
    expect(first.journalHash).not.toBe(other.journalHash);
  });

  it.each([30, 60, 120] as const)('mantém o resultado a %i Hz externo', (externalHz) => {
    const baseline = runHeadlessRally({ seed: 0x1234_abcd, externalHz: 60 });
    const sampled = runHeadlessRally({ seed: 0x1234_abcd, externalHz });

    expect(sampled.serializedJournal).toBe(baseline.serializedJournal);
    expect(sampled.journalHash).toBe(baseline.journalHash);
    expect(sampled.serializedTacticalTrace).toBe(baseline.serializedTacticalTrace);
    expect(sampled.tacticalTraceHash).toBe(baseline.tacticalTraceHash);
    expect(sampled.serializedStrategyTrace).toBe(baseline.serializedStrategyTrace);
    expect(sampled.strategyTraceHash).toBe(baseline.strategyTraceHash);
  });

  it.each([30, 120] as const)(
    'mantém um batch contínuo invariável a %i Hz externo',
    (externalHz) => {
      const baseline = runHeadlessBatch({ seed: 0x1234_abcd, externalHz: 60, rallies: 20 });
      const sampled = runHeadlessBatch({ seed: 0x1234_abcd, externalHz, rallies: 20 });

      expect(sampled.serializedJournal).toBe(baseline.serializedJournal);
      expect(sampled.serializedTacticalTrace).toBe(baseline.serializedTacticalTrace);
      expect(sampled.serializedStrategyTrace).toBe(baseline.serializedStrategyTrace);
      expect(sampled.rallies).toEqual(baseline.rallies);
    },
  );

  it.each([30, 120] as const)(
    'mantém a fronteira entre chamadas repetidas invariável a %i Hz externo',
    (externalHz) => {
      const baseline = new HeadlessRallyRunner({ seed: 2, externalHz: 60 });
      const sampled = new HeadlessRallyRunner({ seed: 2, externalHz });
      baseline.run(1);
      sampled.run(1);

      const expectedNext = baseline.run(1);
      const sampledNext = sampled.run(1);
      expect(sampledNext.serializedJournal).toBe(expectedNext.serializedJournal);
      expect(sampledNext.serializedTacticalTrace).toBe(expectedNext.serializedTacticalTrace);
      expect(sampledNext.serializedStrategyTrace).toBe(expectedNext.serializedStrategyTrace);
      expect(sampledNext.rallies).toEqual(expectedNext.rallies);
    },
  );

  it('executa batch contínuo de 100 rallies com agregados simétricos', () => {
    const started = performance.now();
    const runner = new HeadlessRallyRunner({ seed: 0x2026_0712 });
    const batch = runner.run(100);
    const elapsedMs = performance.now() - started;

    expect(batch.rallies).toHaveLength(100);
    expect(batch.points[0] + batch.points[1]).toBe(100);
    expect(batch.aces[0] + batch.aces[1]).toBe(batch.rallies.filter((rally) => rally.ace).length);
    expect(batch.blocks[0] + batch.blocks[1]).toBe(
      batch.rallies.reduce((sum, rally) => sum + rally.blocks[0] + rally.blocks[1], 0),
    );
    expect(batch.blockTouches[0] + batch.blockTouches[1]).toBe(
      batch.rallies.reduce((sum, rally) => sum + rally.blockTouches[0] + rally.blockTouches[1], 0),
    );
    expect(batch.blockTouches[0] + batch.blockTouches[1]).toBeGreaterThanOrEqual(
      batch.blocks[0] + batch.blocks[1],
    );
    const journalStuff = batch.journal.filter(
      (entry) => entry.type === 'block' && entry.data[1] === 'stuff',
    ).length;
    expect(batch.blocks[0] + batch.blocks[1]).toBe(journalStuff);
    expect(batch.attacks[0] + batch.attacks[1]).toBe(
      batch.rallies.reduce((sum, rally) => sum + rally.attacks[0] + rally.attacks[1], 0),
    );
    expect(batch.errors[0] + batch.errors[1]).toBe(
      batch.rallies.reduce((sum, rally) => sum + rally.errors[0] + rally.errors[1], 0),
    );
    expect(
      batch.rallies.some(
        (rally) => rally.cause === 'floor-in' && rally.errors[0] + rally.errors[1] === 1,
      ),
    ).toBe(true);
    expect(batch.journal.filter((entry) => entry.type === 'rally-end')).toHaveLength(100);
    expect(batch.totalTicks).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.violations).toBe(0);
    expect(batch.tacticalMetrics.engagedAthletes).toEqual([6, 6]);
    expect(batch.tacticalMetrics.phaseVisits.reception).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.phaseVisits['offense-transition']).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.phaseVisits['attack-coverage']).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.phaseVisits['block-defense']).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.singleBlocks + batch.tacticalMetrics.doubleBlocks).toBeGreaterThan(
      0,
    );
    expect(batch.tacticalMetrics.arrivedAssignments).toBeGreaterThan(0);
    expect(batch.tacticalMetrics.executedDoubleBlocks).toBeGreaterThan(0);
    expect(new Set(batch.strategyTrace.map((entry) => entry.side))).toEqual(new Set([0, 1]));
    expect(new Set(batch.strategyTrace.map((entry) => entry.chosenOptionId)).size).toBeGreaterThan(
      6,
    );
    expect(
      batch.strategyTrace.every(
        (entry) =>
          entry.outcome !== null &&
          entry.strategyDraws[1] - entry.strategyDraws[0] === 2 &&
          entry.candidates.some((candidate) => candidate.optionId === entry.chosenOptionId),
      ),
    ).toBe(true);
    const stochastic = runner.checkpointStochastic();
    for (const [side, name] of [
      [TeamSide.HOME, 'strategy.home'],
      [TeamSide.AWAY, 'strategy.away'],
    ] as const) {
      const stream = stochastic.random.streams.find((entry) => entry.name === name);
      expect(stream?.random.draws).toBe(stochastic.strategy.core.sequences[side] * 2);
    }
    expect(batch.strategyTrace).toHaveLength(
      stochastic.strategy.core.sequences[TeamSide.HOME] +
        stochastic.strategy.core.sequences[TeamSide.AWAY],
    );
    expect(new Set(batch.tacticalTrace.map((entry) => entry.rally)).size).toBe(100);
    expect(batch.tacticalTrace.every((entry) => entry.rally >= 0 && entry.rally < 100)).toBe(true);
    for (let rally = 0; rally < 100; rally++) {
      expect(
        batch.tacticalTrace.some((entry) => entry.rally === rally && entry.phase === 'hold'),
      ).toBe(true);
    }
    console.info(
      `HEADLESS_BATCH rallies=100 elapsedMs=${elapsedMs.toFixed(1)} ticks=${batch.totalTicks}`,
    );
  }, 30_000);

  // A matriz valida invariantes, não latência; sob coverage no runner compartilhado pode passar
  // de 30 s após o lifecycle estratégico completo, sem indicar regressão funcional.
  it('executa matriz informativa de 1.000 rallies sem violações táticas', () => {
    const started = performance.now();
    const points = [0, 0];
    let doubleBlocks = 0;
    let executedDoubleBlocks = 0;
    for (let seed = 0; seed < 20; seed++) {
      const batch = runHeadlessBatch({ seed: 0x3b00_0000 + seed, rallies: 50 });
      expect(batch.tacticalMetrics.violations).toBe(0);
      expect(batch.tacticalMetrics.engagedAthletes).toEqual([6, 6]);
      points[0] += batch.points[0];
      points[1] += batch.points[1];
      doubleBlocks += batch.tacticalMetrics.doubleBlocks;
      executedDoubleBlocks += batch.tacticalMetrics.executedDoubleBlocks;
    }
    const elapsedMs = performance.now() - started;

    expect(points[0] + points[1]).toBe(1_000);
    console.info(
      `TACTICAL_MATRIX rallies=1000 points=${points.join(':')} doubleBlocks=${doubleBlocks} executedDoubleBlocks=${executedDoubleBlocks} elapsedMs=${elapsedMs.toFixed(1)}`,
    );
  }, 60_000);

  it('falha com diagnóstico quando o watchdog de ticks é excedido', () => {
    const runner = new HeadlessRallyRunner({ seed: 1, maxTicksPerPoint: 1 });

    expect(() => runner.run(1)).toThrowError(/limite de ticks/);
  });

  it('falha com diagnóstico quando o orçamento de eventos é excedido', () => {
    const runner = new HeadlessRallyRunner({ seed: 1, maxEventsPerRally: 1 });

    expect(() => runner.run(1)).toThrowError(/limite de eventos/);
  });

  it('não usa timers de parede', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('setTimeout proibido');
    });
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => {
      throw new Error('setInterval proibido');
    });
    try {
      expect(() => runHeadlessRally({ seed: 3 })).not.toThrow();
    } finally {
      timeout.mockRestore();
      interval.mockRestore();
    }
  });

  it('variações cosméticas dos hooks não alteram o journal', () => {
    const noisy = createHeadlessHooks();
    let cosmeticCalls = 0;
    Object.assign(noisy.audio, {
      hitSoft: () => {
        cosmeticCalls += 1;
      },
      hitHard: () => {
        cosmeticCalls += 1;
      },
    });
    Object.assign(noisy.crowd, {
      excite: () => {
        cosmeticCalls += 1;
      },
    });

    const baseline = runHeadlessRally({ seed: 88 });
    const cosmetic = runHeadlessRally({ seed: 88, hooks: noisy });

    expect(cosmetic.serializedJournal).toBe(baseline.serializedJournal);
    expect(cosmeticCalls).toBeGreaterThan(0);
  });

  it('só permite checkpoint estocástico na fronteira de ponto', () => {
    const runner = new HeadlessRallyRunner({ seed: 5 });

    expect(() => runner.checkpointStochastic()).toThrow(/fronteira de ponto/);
    runner.run(1);
    const checkpoint = runner.checkpointStochastic();
    expect(() => runner.restoreStochastic(checkpoint)).not.toThrow();
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.fingerprint.homeSlots)).toBe(true);
  });

  it('restaura RNG e estratégia e reproduz byte a byte o rally seguinte', () => {
    const control = new HeadlessRallyRunner({ seed: 5 });
    const restored = new HeadlessRallyRunner({ seed: 5 });
    control.run(1);
    restored.run(1);
    const checkpoint = control.checkpointStochastic();
    const [homeMemory, awayMemory] = checkpoint.strategy.core.memories;

    const perturbation = new RandomHub(5);
    perturbation.restore(checkpoint.random);
    for (const name of ['rules', 'ai', 'contact', 'control']) {
      perturbation.stream(name).nextUint32();
    }
    const perturbed = {
      ...checkpoint,
      random: perturbation.snapshot(),
      strategy: {
        ...checkpoint.strategy,
        core: {
          ...checkpoint.strategy.core,
          memories: [{ ...homeMemory, revision: homeMemory.revision + 1 }, awayMemory] as const,
        },
      },
    };
    restored.restoreStochastic(perturbed);
    expect(restored.checkpointStochastic().random).toEqual(perturbed.random);
    expect(restored.checkpointStochastic().random).not.toEqual(checkpoint.random);
    expect(restored.checkpointStochastic().strategy).toEqual(perturbed.strategy);
    expect(restored.checkpointStochastic().strategy).not.toEqual(checkpoint.strategy);
    restored.restoreStochastic(checkpoint);
    expect(restored.checkpointStochastic()).toEqual(checkpoint);

    const expected = control.run(1);
    const replay = restored.run(1);
    expect(replay.serializedJournal).toBe(expected.serializedJournal);
    expect(replay.journalHash).toBe(expected.journalHash);
    expect(replay.serializedTacticalTrace).toBe(expected.serializedTacticalTrace);
    expect(replay.tacticalTraceHash).toBe(expected.tacticalTraceHash);
    expect(replay.serializedStrategyTrace).toBe(expected.serializedStrategyTrace);
    expect(replay.strategyTraceHash).toBe(expected.strategyTraceHash);
  });

  it('rollback transacional preserva RNG e estratégia quando o checkpoint é inválido', () => {
    const runner = new HeadlessRallyRunner({ seed: 0x3c_51 });
    runner.run(1);
    const before = runner.checkpointStochastic();
    const malformed = structuredClone(before);
    Object.assign(malformed.random, { streams: null });

    expect(() => runner.restoreStochastic(malformed as never)).toThrow(
      /checkpoint estocástico inválido/i,
    );
    expect(runner.checkpointStochastic()).toEqual(before);

    const perturbation = new RandomHub(0x3c_51);
    perturbation.restore(before.random);
    perturbation.stream('rules').nextUint32();
    const invalid = structuredClone(before);
    const changedMemories = invalid.strategy.core.memories.map((memory, index) =>
      index === 0 ? { ...memory, revision: memory.revision + 1 } : memory,
    );
    Object.assign(invalid, {
      random: perturbation.snapshot(),
      strategy: {
        ...invalid.strategy,
        core: { ...invalid.strategy.core, memories: changedMemories },
        offense: { ...invalid.strategy.offense, version: 99 },
      },
    });

    expect(() => runner.restoreStochastic(invalid as never)).toThrow(
      /fronteira ofensivo inválido/i,
    );
    expect(runner.checkpointStochastic()).toEqual(before);
  });

  it('checkpoint antigo não rebobina o estado físico após outro ponto', () => {
    const runner = new HeadlessRallyRunner({ seed: 0x3c_52 });
    runner.run(1);
    const stale = runner.checkpointStochastic();
    runner.run(1);
    const current = runner.checkpointStochastic();

    expect(() => runner.restoreStochastic(stale)).toThrow(/fingerprint/i);
    expect(runner.checkpointStochastic()).toEqual(current);
  });

  it('mantém journal, serialização e hash na mesma fatia em runs repetidos', () => {
    const runner = new HeadlessRallyRunner({ seed: 9 });
    runner.run(1);

    const second = runner.run(1);
    const envelope = JSON.parse(second.serializedJournal) as { events: unknown[] };
    const tacticalEnvelope = JSON.parse(second.serializedTacticalTrace) as { entries: unknown[] };
    const strategyEnvelope = JSON.parse(second.serializedStrategyTrace) as { entries: unknown[] };

    expect(envelope.events).toHaveLength(second.journal.length);
    expect(tacticalEnvelope.entries).toHaveLength(second.tacticalTrace.length);
    expect(strategyEnvelope.entries).toHaveLength(second.strategyTrace.length);
    expect(second.journal.every((entry) => entry.rally === 1)).toBe(true);
    expect(second.tacticalTrace.every((entry) => entry.rally === 1)).toBe(true);
    expect(second.strategyTrace.every((entry) => entry.rally === 1)).toBe(true);
  });

  it('run(2) equivale às duas fatias de run(1) sem perder o saque pré-rally', () => {
    const continuous = new HeadlessRallyRunner({ seed: 0x3c_50 });
    const sliced = new HeadlessRallyRunner({ seed: 0x3c_50 });

    const together = continuous.run(2);
    const first = sliced.run(1);
    const second = sliced.run(1);

    expect(together.strategyTrace).toEqual([...first.strategyTrace, ...second.strategyTrace]);
    expect(together.strategyTrace.filter((entry) => entry.kind === 'serve')).toHaveLength(2);
    expect(together.strategyTrace.every((entry) => entry.rally === 0 || entry.rally === 1)).toBe(
      true,
    );
  });
});
