import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import type {
  CommittedStrategyDecision,
  StrategyOutboxEvent,
  StrategyOutcomeRecord,
} from './OpponentStrategySystem';
import {
  STRATEGY_TRACE_HASH,
  STRATEGY_TRACE_SCHEMA,
  StrategyTraceCollector,
} from './StrategyTrace';

function decision(sequence = 1, side = TeamSide.AWAY): CommittedStrategyDecision {
  return {
    decisionId: `3:${side === TeamSide.HOME ? 'home' : 'away'}:${sequence}`,
    matchEpoch: 3,
    side,
    sequence,
    kind: 'attack',
    decisionTick: 120,
    observationTick: 108,
    memoryRevision: 7,
    ownership: `attack:${sequence}`,
    attackOriginZ: 1.25,
    attackBasis: { kind: 'executed-set' },
    proposal: {
      kind: 'attack',
      side,
      observationTick: 108,
      ticket: { selection: 0x1234_5678, variation: 0x8765_4321 },
      candidates: [
        {
          optionId: 'attack.tip-short-left',
          kind: 'attack',
          family: 'tip',
          target: { x: -1.2345, z: 2.3455 },
          components: { variety: 0.25125, openCourt: 0.81234 },
          score: 0.81234,
          probability: 0.37555,
        },
        {
          optionId: 'attack.placed-cross',
          kind: 'attack',
          family: 'placed',
          target: { x: -7.25, z: -1.125 },
          components: { variety: 0.5, openCourt: 0.75 },
          score: 0.75,
          probability: 0.62445,
        },
      ],
      chosen: {
        optionId: 'attack.tip-short-left',
        kind: 'attack',
        family: 'tip',
        target: { x: -1.2345, z: 2.3455 },
        components: { variety: 0.25125, openCourt: 0.81234 },
        score: 0.81234,
        probability: 0.37555,
      },
    },
  };
}

function committed(source = decision()): StrategyOutboxEvent {
  return { type: 'decision-committed', decision: source };
}

function terminal(
  source: CommittedStrategyDecision,
  status: StrategyOutcomeRecord['status'] = 'resolved',
  effectiveness = 0.67895,
): StrategyOutboxEvent {
  return {
    type: 'outcome-terminal',
    outcome: {
      decisionId: source.decisionId,
      status,
      side: source.side,
      kind: source.kind,
      optionId: source.proposal.chosen.optionId,
      ...(status === 'resolved' ? { effectiveness } : {}),
    },
  };
}

describe('StrategyTraceCollector', () => {
  it('copia e quantiza a decisão com candidatos em ordem canônica', () => {
    const collector = new StrategyTraceCollector();
    const source = decision(3);
    collector.record(committed(source), 4);

    (source.proposal.candidates[0].target as { x: number }).x = 99;
    (source.proposal.candidates[0].components as Record<string, number>).openCourt = 0;

    expect(collector.entries).toEqual([
      {
        rally: 4,
        decisionId: '3:away:3',
        matchEpoch: 3,
        side: TeamSide.AWAY,
        sequence: 3,
        kind: 'attack',
        decisionTick: 120,
        observationTick: 108,
        memoryRevision: 7,
        candidates: [
          {
            optionId: 'attack.placed-cross',
            family: 'placed',
            targetMm: [-7_250, -1_125],
            componentsBps: { openCourt: 7_500, variety: 5_000 },
            scoreBps: 7_500,
            probabilityBps: 6_244,
          },
          {
            optionId: 'attack.tip-short-left',
            family: 'tip',
            targetMm: [-1_234, 2_346],
            componentsBps: { openCourt: 8_123, variety: 2_512 },
            scoreBps: 8_123,
            probabilityBps: 3_756,
          },
        ],
        chosenOptionId: 'attack.tip-short-left',
        ticket: [0x1234_5678, 0x8765_4321],
        strategyDraws: [4, 6],
        outcome: null,
      },
    ]);
    expect(Object.isFrozen(collector.entries)).toBe(true);
    expect(Object.isFrozen(collector.entries[0])).toBe(true);
    expect(Object.isFrozen(collector.entries[0].candidates)).toBe(true);
    expect(Object.isFrozen(collector.entries[0].candidates[0].componentsBps)).toBe(true);
  });

  it('anexa o outcome terminal à decisão e preserva o rally atribuído no commit', () => {
    const collector = new StrategyTraceCollector();
    const source = decision();
    collector.record(committed(source), 2);
    collector.record(terminal(source), 9);

    expect(collector.entries[0].rally).toBe(2);
    expect(collector.entries[0].outcome).toEqual({
      status: 'resolved',
      effectivenessBps: 6_790,
    });
    expect(Object.isFrozen(collector.entries[0].outcome)).toBe(true);
  });

  it('filtra por rally sem expor o armazenamento mutável', () => {
    const collector = new StrategyTraceCollector();
    collector.record(committed(decision(1, TeamSide.HOME)), 2);
    collector.record(committed(decision(1, TeamSide.AWAY)), 3);
    collector.record(committed(decision(2, TeamSide.HOME)), 3);

    expect(collector.entriesForRally(3).map((entry) => entry.decisionId)).toEqual([
      '3:away:1',
      '3:home:2',
    ]);
    expect(Object.isFrozen(collector.entriesForRally(3))).toBe(true);
  });

  it('serializa e calcula hash estável sensível ao outcome', () => {
    const first = new StrategyTraceCollector();
    const same = new StrategyTraceCollector();
    const source = decision();
    first.record(committed(source), 0);
    same.record(committed(decision()), 0);

    expect(JSON.parse(first.serialize())).toMatchObject({
      schema: STRATEGY_TRACE_SCHEMA,
      hashAlgorithm: STRATEGY_TRACE_HASH,
    });
    expect(first.serialize()).toBe(same.serialize());
    expect(first.hash()).toBe(same.hash());
    expect(first.hash()).toMatch(/^[0-9a-f]{8}$/);

    first.record(terminal(source, 'revoked'), 0);
    expect(first.hash()).not.toBe(same.hash());
  });

  it('rejeita terminal desconhecido, pendente, divergente ou duplicado sem mutar o trace', () => {
    const collector = new StrategyTraceCollector();
    const source = decision();
    collector.record(committed(source), 1);
    const before = collector.serialize();

    expect(() => collector.record(terminal(decision(2)), 1)).toThrow(/desconhecid/i);
    expect(() => collector.record(terminal(source, 'pending'), 1)).toThrow(/terminal/i);
    const divergent = terminal(source);
    if (divergent.type !== 'outcome-terminal') throw new Error('fixture inválida');
    expect(() =>
      collector.record(
        {
          type: 'outcome-terminal',
          outcome: { ...divergent.outcome, optionId: 'attack.placed-cross' },
        } as StrategyOutboxEvent,
        1,
      ),
    ).toThrow(/diverge/i);
    expect(collector.serialize()).toBe(before);

    collector.record(terminal(source), 1);
    expect(() => collector.record(terminal(source), 1)).toThrow(/duplicado/i);
  });
});
