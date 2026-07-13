import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { OpponentBrain } from './OpponentBrain';
import {
  PERCEPTION_DELAY_TICKS,
  PERCEPTION_RING_CAPACITY,
  TERMINAL_HISTORY_CAPACITY_PER_SIDE,
  OpponentStrategySystem,
  type OpponentStrategySnapshot,
  type StrategyDecisionRequest,
} from './OpponentStrategySystem';
import type { StrategyObservation, StrategyProposal } from './StrategyTypes';

function observation(tick: number, movement = 0): StrategyObservation {
  const athletes = [TeamSide.HOME, TeamSide.AWAY].flatMap((side) => {
    const sign = side === TeamSide.HOME ? 1 : -1;
    return Array.from({ length: 6 }, (_, id) => ({
      side,
      id,
      slot: id,
      row: id <= 2 ? ('back' as const) : ('front' as const),
      position: {
        x: sign * (id <= 2 ? -6 : -2) + (side === TeamSide.AWAY ? movement : 0),
        z: sign * ((id % 3) - 1) * 3,
      },
      velocity: { x: side === TeamSide.AWAY ? movement : 0, z: 0 },
      airborne: false,
    }));
  });
  return {
    tick,
    score: [0, 0],
    phase: 'rally',
    possessionSide: TeamSide.HOME,
    servingSide: TeamSide.HOME,
    possessionTouches: 1,
    ball: {
      position: { x: -5, y: 2.2, z: 0 },
      velocity: { x: 5, y: 1, z: 0 },
      inFlight: true,
      lastVisibleContactTick: tick === 0 ? null : tick - 1,
    },
    athletes,
  };
}

function streams(homeValues = [1, 2, 3, 4, 5, 6], awayValues = [11, 12, 13, 14]) {
  return {
    home: new SequenceRandom(homeValues),
    away: new SequenceRandom(awayValues),
  };
}

function serveRequest(
  side: TeamSide = TeamSide.HOME,
  decisionTick = 6,
  matchEpoch = 0,
): StrategyDecisionRequest {
  return {
    matchEpoch,
    side,
    kind: 'serve',
    difficulty: 2,
    decisionTick,
    ownership: `serve:${side}:${decisionTick}`,
  };
}

function committed(system: OpponentStrategySystem, request = serveRequest()) {
  const result = system.commitDecision(request);
  if (result.status !== 'committed') throw new Error(`esperava commit, recebeu ${result.status}`);
  return result.decision;
}

describe('OpponentStrategySystem perception', () => {
  it('mantém ring 48, aceita gaps, ignora tick duplicado e rejeita regressão', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(1));
    system.captureFrame(observation(10));
    system.captureFrame({ ...observation(10), score: [9, 9] });
    expect(system.snapshot().perceptionFrames.map((frame) => frame.tick)).toEqual([1, 10]);
    expect(system.snapshot().perceptionFrames[1].score).toEqual([0, 0]);
    expect(() => system.captureFrame(observation(9))).toThrow(/regressivo|tick/i);

    for (let tick = 11; tick <= 60; tick++) system.captureFrame(observation(tick));
    const ticks = system.snapshot().perceptionFrames.map((frame) => frame.tick);
    expect(ticks).toHaveLength(PERCEPTION_RING_CAPACITY);
    expect(ticks[0]).toBe(13);
    expect(ticks.at(-1)).toBe(60);
  });

  it('usa latest <= cutoff por dificuldade e retorna not-ready sem criar frame', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(10));
    system.captureFrame(observation(20));
    system.captureFrame(observation(40));

    expect(PERCEPTION_DELAY_TICKS).toEqual([30, 15, 6]);
    expect(system.perceive(TeamSide.HOME, 0, 50)).toMatchObject({
      status: 'ready',
      observation: { tick: 20 },
    });
    expect(system.perceive(TeamSide.HOME, 1, 50)).toMatchObject({
      status: 'ready',
      observation: { tick: 20 },
    });
    expect(system.perceive(TeamSide.AWAY, 2, 50)).toMatchObject({
      status: 'ready',
      observation: { tick: 40 },
    });

    const before = system.snapshot();
    expect(system.perceive(TeamSide.HOME, 0, 29)).toEqual({ status: 'not-ready' });
    expect(system.snapshot()).toEqual(before);
  });

  it('não deixa movimento posterior ao cutoff alterar proposta nem budget', () => {
    const leftStreams = streams();
    const rightStreams = streams();
    const withFuture = new OpponentStrategySystem({ streams: leftStreams });
    const withoutFuture = new OpponentStrategySystem({ streams: rightStreams });
    withFuture.captureFrame(observation(0));
    withFuture.captureFrame(observation(5, 7));
    withoutFuture.captureFrame(observation(0));

    const first = committed(withFuture);
    const second = committed(withoutFuture);
    expect(first.proposal).toEqual(second.proposal);
    expect(first.observationTick).toBe(0);
    expect(leftStreams.home.draws).toBe(2);
    expect(rightStreams.home.draws).toBe(2);
  });

  it('rejeita phase e flags booleanas inválidas sem capturar frame', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    const base = observation(0);
    const invalid = [
      { ...base, phase: 'future' as StrategyObservation['phase'] },
      { ...base, ball: { ...base.ball, inFlight: 1 as unknown as boolean } },
      {
        ...base,
        athletes: base.athletes.map((athlete, index) =>
          index === 0 ? { ...athlete, airborne: 1 as unknown as boolean } : athlete,
        ),
      },
    ];

    for (const frame of invalid) expect(() => system.captureFrame(frame)).toThrow();
    expect(system.snapshot().perceptionFrames).toHaveLength(0);
  });
});

describe('OpponentStrategySystem transaction and lifecycle', () => {
  it('consome exatamente dois uint32 somente no stream do lado aceito', () => {
    const random = streams();
    const system = new OpponentStrategySystem({ streams: random });
    system.captureFrame(observation(0));

    expect(system.commitDecision({ ...serveRequest(), ownership: '' })).toEqual({
      status: 'invalid-request',
    });
    expect(
      system.commitDecision({
        ...serveRequest(),
        kind: 'set',
        ownership: 'set:sem-levantadora',
      }),
    ).toEqual({ status: 'invalid-request' });
    expect(random.home.draws).toBe(0);
    const home = committed(system);
    const away = committed(system, serveRequest(TeamSide.AWAY));

    expect(random.home.draws).toBe(2);
    expect(random.away.draws).toBe(2);
    expect(home.sequence).toBe(1);
    expect(away.sequence).toBe(1);
    expect(home.decisionId).not.toBe(away.decisionId);
    expect(system.snapshot().sequences).toEqual([1, 1]);
    expect(system.snapshot().outbox).toHaveLength(0);
  });

  it('rejeita ownership já comprometido e epoch stale antes de percepção e RNG', () => {
    const random = streams();
    const system = new OpponentStrategySystem({ streams: random });
    system.captureFrame(observation(0));
    const request = serveRequest();
    const existing = committed(system, request);
    const beforeDuplicate = system.snapshot();

    expect(system.commitDecision(request)).toEqual({
      status: 'invalid-request',
      existingDecisionId: existing.decisionId,
    });
    expect(random.home.draws).toBe(2);
    expect(system.snapshot()).toEqual(beforeDuplicate);

    system.startMatch();
    const beforeStale = system.snapshot();
    expect(system.commitDecision(request)).toEqual({ status: 'invalid-request' });
    expect(random.home.draws).toBe(2);
    expect(system.snapshot()).toEqual(beforeStale);
  });

  it('not-ready e SequenceRandom exaurido consomem zero e não mutam sistema', () => {
    const notReadyStreams = streams();
    const notReady = new OpponentStrategySystem({ streams: notReadyStreams });
    notReady.captureFrame(observation(10));
    const beforeNotReady = notReady.snapshot();
    expect(notReady.commitDecision(serveRequest(TeamSide.HOME, 10))).toEqual({
      status: 'not-ready',
    });
    expect(notReadyStreams.home.draws).toBe(0);
    expect(notReady.snapshot()).toEqual(beforeNotReady);

    const short = streams([77], [88]);
    const exhausted = new OpponentStrategySystem({ streams: short });
    exhausted.captureFrame(observation(0));
    const beforeFailure = exhausted.snapshot();
    expect(() => exhausted.commitDecision(serveRequest())).toThrow(/exhausted/i);
    expect(short.home.draws).toBe(0);
    expect(exhausted.snapshot()).toEqual(beforeFailure);
  });

  it('restaura stream e estado integral quando a proposal é inválida após os draws', () => {
    const random = streams();
    const realBrain = new OpponentBrain();
    const invalidBrain = {
      decide(context: Parameters<OpponentBrain['decide']>[0]): StrategyProposal {
        const proposal = realBrain.decide(context);
        return { ...proposal, side: TeamSide.AWAY };
      },
    };
    const system = new OpponentStrategySystem({ streams: random, brain: invalidBrain });
    system.captureFrame(observation(0));
    const before = system.snapshot();

    expect(() => system.commitDecision(serveRequest())).toThrow(/proposal/i);
    expect(random.home.draws).toBe(0);
    expect(system.snapshot()).toEqual(before);
  });

  it('rollback de nova proposal preserva ownership já comprometido', () => {
    const random = streams();
    const realBrain = new OpponentBrain();
    let fail = false;
    const brain = {
      decide(context: Parameters<OpponentBrain['decide']>[0]): StrategyProposal {
        const proposal = realBrain.decide(context);
        return fail ? { ...proposal, side: TeamSide.AWAY } : proposal;
      },
    };
    const system = new OpponentStrategySystem({ streams: random, brain });
    system.captureFrame(observation(0));
    committed(system);
    fail = true;
    const before = system.snapshot();

    expect(() =>
      system.commitDecision({
        ...serveRequest(TeamSide.HOME, 7),
        ownership: 'serve:segunda',
      }),
    ).toThrow(/proposal/i);
    expect(random.home.draws).toBe(2);
    expect(system.snapshot()).toEqual(before);
    expect(system.snapshot().ownerships).toHaveLength(1);
  });

  it.each([
    ['família', (candidate: StrategyProposal['chosen']) => ({ ...candidate, family: 'forjada' })],
    ['zona', (candidate: StrategyProposal['chosen']) => ({ ...candidate, target: { x: 0, z: 0 } })],
    [
      'quadra',
      (candidate: StrategyProposal['chosen']) => ({ ...candidate, target: { x: 99, z: 99 } }),
    ],
  ] as const)('rejeita proposal cuja opção viola %s canônica com rollback', (_label, corrupt) => {
    const random = streams();
    const realBrain = new OpponentBrain();
    const invalidBrain = {
      decide(context: Parameters<OpponentBrain['decide']>[0]): StrategyProposal {
        const proposal = realBrain.decide(context);
        const chosen = corrupt(proposal.chosen);
        return {
          ...proposal,
          chosen,
          candidates: proposal.candidates.map((candidate) =>
            candidate.optionId === chosen.optionId ? chosen : candidate,
          ),
        };
      },
    };
    const system = new OpponentStrategySystem({ streams: random, brain: invalidBrain });
    system.captureFrame(observation(0));
    const before = system.snapshot();

    expect(() => system.commitDecision(serveRequest())).toThrow(/proposal/i);
    expect(random.home.draws).toBe(0);
    expect(system.snapshot()).toEqual(before);
  });

  it('mantém outcome pending até um único resolved ou revoked terminal', () => {
    const system = new OpponentStrategySystem({ streams: streams([1, 2, 3, 4]) });
    system.captureFrame(observation(0));
    const resolved = committed(system);
    expect(system.outcomeState(resolved.decisionId)).toBe('pending');
    system.resolveOutcome(resolved.decisionId, 0.8);
    expect(system.outcomeState(resolved.decisionId)).toBe('resolved');
    expect(system.memory(TeamSide.HOME).outcomes.at(-1)).toMatchObject({
      optionId: resolved.proposal.chosen.optionId,
      effectiveness: 0.8,
    });
    expect(system.memory(TeamSide.HOME).recentChoices).toEqual([resolved.proposal.chosen.optionId]);
    expect(() => system.revokeDecision(resolved.decisionId)).toThrow(/terminal/i);

    const revoked = committed(system, { ...serveRequest(), decisionTick: 7, ownership: 'serve:2' });
    const learned = system.memory(TeamSide.HOME).outcomes.length;
    system.revokeDecision(revoked.decisionId);
    expect(system.outcomeState(revoked.decisionId)).toBe('revoked');
    expect(system.memory(TeamSide.HOME).outcomes).toHaveLength(learned);
    expect(system.memory(TeamSide.HOME).recentChoices).toEqual([resolved.proposal.chosen.optionId]);
    expect(() => system.resolveOutcome(revoked.decisionId, 1)).toThrow(/terminal/i);
  });

  it('não aplica terminal parcialmente quando a memória não pode avançar', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(0));
    const decision = committed(system);
    const saturated = system.snapshot();
    system.restore({
      ...saturated,
      memories: [
        { ...saturated.memories[TeamSide.HOME], revision: Number.MAX_SAFE_INTEGER },
        saturated.memories[TeamSide.AWAY],
      ],
    });
    const before = system.snapshot();

    expect(() => system.resolveOutcome(decision.decisionId, 1)).toThrow(/revision/i);
    expect(system.outcomeState(decision.decisionId)).toBe('pending');
    expect(system.snapshot()).toEqual(before);
  });

  it('limita tombstones terminais sem limitar sequências monotônicas', () => {
    const values = Array.from({ length: 120 }, (_, index) => index + 1);
    const system = new OpponentStrategySystem({ streams: streams(values) });
    system.captureFrame(observation(0));
    for (let index = 0; index < 60; index++) {
      const decision = committed(system, {
        ...serveRequest(),
        decisionTick: 6 + index,
        ownership: `serve:${index}`,
      });
      system.resolveOutcome(decision.decisionId, 0.5);
    }

    const snapshot = system.snapshot();
    expect(snapshot.decisions.length).toBeLessThanOrEqual(48);
    expect(snapshot.outcomes.length).toBeLessThanOrEqual(48);
    expect(snapshot.sequences).toEqual([60, 0]);
  });

  it('nova partida incrementa epoch, revoga pendentes e zera memória; novo set persiste', () => {
    const system = new OpponentStrategySystem({ streams: streams([1, 2, 3, 4, 5, 6]) });
    system.captureFrame(observation(0));
    const learned = committed(system);
    system.resolveOutcome(learned.decisionId, 1);
    const pending = committed(system, {
      ...serveRequest(),
      decisionTick: 7,
      ownership: 'serve:pending',
    });
    const memoryBeforeSet = system.memory(TeamSide.HOME);
    system.startSet();
    expect(system.memory(TeamSide.HOME)).toEqual(memoryBeforeSet);

    system.startMatch();
    expect(system.matchEpoch).toBe(1);
    expect(system.snapshot().ownerships).toEqual([]);
    expect(system.outcomeState(pending.decisionId)).toBe('revoked');
    expect(system.memory(TeamSide.HOME)).toEqual({ revision: 0, outcomes: [], recentChoices: [] });
    system.captureFrame(observation(0));
    const next = committed(system, serveRequest(TeamSide.HOME, 6, 1));
    expect(next.sequence).toBe(3);
    expect(next.matchEpoch).toBe(1);
  });

  it('entrega outbox só após commit e desativa sink falho sem reverter gameplay', () => {
    let calls = 0;
    const random = streams();
    const system = new OpponentStrategySystem({
      streams: random,
      sink: () => {
        calls++;
        throw new Error('sink offline');
      },
    });
    system.captureFrame(observation(0));
    const decision = committed(system);
    expect(calls).toBe(0);
    expect(system.snapshot().outbox).toHaveLength(1);

    expect(() => system.flushOutbox()).not.toThrow();
    expect(calls).toBe(1);
    expect(system.snapshot().outbox).toHaveLength(0);
    expect(system.outcomeState(decision.decisionId)).toBe('pending');
    expect(random.home.draws).toBe(2);
    system.flushOutbox();
    expect(calls).toBe(1);
  });

  it('emite eventos autocontidos de decisão e outcome em ordem após commit', () => {
    const events: unknown[] = [];
    const system = new OpponentStrategySystem({
      streams: streams(),
      sink: (event) => events.push(event),
    });
    system.captureFrame(observation(0));
    const decision = committed(system);
    system.resolveOutcome(decision.decisionId, 0.75);
    system.flushOutbox();

    expect(events).toEqual([
      { type: 'decision-committed', decision },
      {
        type: 'outcome-terminal',
        outcome: {
          decisionId: decision.decisionId,
          status: 'resolved',
          side: decision.side,
          kind: decision.kind,
          optionId: decision.proposal.chosen.optionId,
          effectiveness: 0.75,
        },
      },
    ]);
  });
});

describe('OpponentStrategySystem snapshot', () => {
  it('rejeita excesso de terminais desprotegidos e conta proteção uma vez por decisionId', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(0));
    committed(system);
    const baseline = system.snapshot();
    const count = TERMINAL_HISTORY_CAPACITY_PER_SIDE + 1;
    const decisions = Array.from({ length: count }, (_, index) => {
      const sequence = index + 1;
      return {
        ...baseline.decisions[0],
        decisionId: `0:home:${sequence}`,
        sequence,
        ownership: `serve:forjado:${sequence}`,
      };
    });
    const outcomes = decisions.map((decision) => ({
      ...baseline.outcomes[0],
      decisionId: decision.decisionId,
      status: 'revoked' as const,
    }));
    const ownerships = decisions.map((decision) => ({
      matchEpoch: 0,
      side: TeamSide.HOME,
      kind: 'serve' as const,
      ownership: decision.ownership,
    }));
    const overCapacity: OpponentStrategySnapshot = {
      ...baseline,
      sequences: [count, 0],
      decisions,
      outcomes,
      ownerships,
      outbox: [],
    };

    expect(() => system.restore(overCapacity)).toThrow(/cap|terminal|histórico/i);
    expect(system.snapshot()).toEqual(baseline);

    const protectedIndex = count - 1;
    const protectedSnapshot: OpponentStrategySnapshot = {
      ...overCapacity,
      outbox: [
        { type: 'decision-committed', decision: decisions[protectedIndex] },
        { type: 'outcome-terminal', outcome: outcomes[protectedIndex] },
      ],
    };
    expect(() => system.restore(protectedSnapshot)).not.toThrow();
    expect(system.snapshot().decisions).toHaveLength(count);
  });

  it('valida máquina de estados do outbox e aceita terminal isolado', () => {
    const source = new OpponentStrategySystem({ streams: streams(), sink: () => undefined });
    source.captureFrame(observation(0));
    const decision = committed(source);
    source.resolveOutcome(decision.decisionId, 1);
    const valid = source.snapshot();
    const commitEvent = valid.outbox[0];
    const terminalEvent = valid.outbox[1];
    const target = new OpponentStrategySystem({ streams: streams(), sink: () => undefined });

    expect(() => target.restore({ ...valid, outbox: [] })).not.toThrow();
    target.restore({ ...valid, outbox: [terminalEvent] });
    const baseline = target.snapshot();
    const invalid = [
      { ...valid, outbox: [commitEvent] },
      { ...valid, outbox: [commitEvent, commitEvent] },
      { ...valid, outbox: [terminalEvent, terminalEvent] },
      { ...valid, outbox: [terminalEvent, commitEvent] },
    ] as const;
    for (const candidate of invalid) {
      expect(() => target.restore(candidate)).toThrow(/outbox|evento|ordem|duplicado/i);
      expect(target.snapshot()).toEqual(baseline);
    }
  });

  it('preserva ordem cronológica H,A,H no snapshot, outbox e restore', () => {
    const delivered: unknown[] = [];
    const system = new OpponentStrategySystem({
      streams: streams(),
      sink: (event) => delivered.push(event),
    });
    system.captureFrame(observation(0));
    const first = committed(system, serveRequest(TeamSide.HOME));
    const second = committed(system, serveRequest(TeamSide.AWAY));
    const third = committed(system, {
      ...serveRequest(TeamSide.HOME, 7),
      ownership: 'serve:home:segundo',
    });
    const snapshot = system.snapshot();
    expect(snapshot.decisions.map((decision) => decision.decisionId)).toEqual([
      first.decisionId,
      second.decisionId,
      third.decisionId,
    ]);

    const restored = new OpponentStrategySystem({ streams: streams(), sink: () => undefined });
    restored.restore(JSON.parse(JSON.stringify(snapshot)) as OpponentStrategySnapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    restored.flushOutbox();
    expect(restored.snapshot().outbox).toEqual([]);
  });

  it('é versionado, serializável, profundamente congelado e restaura estado válido', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(0));
    committed(system);
    const snapshot = system.snapshot();
    expect(snapshot.version).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.perceptionFrames)).toBe(true);
    expect(Object.isFrozen(snapshot.perceptionFrames[0].athletes[0].position)).toBe(true);

    const serialized = JSON.stringify(snapshot);
    system.startMatch();
    system.restore(JSON.parse(serialized) as OpponentStrategySnapshot);
    expect(system.snapshot()).toEqual(snapshot);
  });

  it('rejeita snapshot inválido por versão, finitude, capacidade, ticks ou refs sem mutar', () => {
    const system = new OpponentStrategySystem({ streams: streams() });
    system.captureFrame(observation(0));
    committed(system);
    const baseline = system.snapshot();
    const plain = () => structuredClone(baseline) as OpponentStrategySnapshot;
    const badIdBase = plain();
    const badId: OpponentStrategySnapshot = {
      ...badIdBase,
      decisions: [{ ...badIdBase.decisions[0], decisionId: 'id-forjado' }],
      outcomes: [{ ...badIdBase.outcomes[0], decisionId: 'id-forjado' }],
      outbox: badIdBase.outbox.map((event) => ({ ...event, decisionId: 'id-forjado' })),
    };
    const badTerminalBase = plain();
    const badTerminalRef: OpponentStrategySnapshot = {
      ...badTerminalBase,
      outbox: [
        {
          type: 'outcome-terminal',
          outcome: {
            ...badTerminalBase.outcomes[0],
            status: 'resolved',
            effectiveness: 1,
          },
        },
      ],
    };
    const badTicketBase = plain();
    const badTicket: OpponentStrategySnapshot = {
      ...badTicketBase,
      decisions: [
        {
          ...badTicketBase.decisions[0],
          proposal: {
            ...badTicketBase.decisions[0].proposal,
            ticket: {
              ...badTicketBase.decisions[0].proposal.ticket,
              selection: -1,
            },
          },
        },
      ],
    };
    const invalid: OpponentStrategySnapshot[] = [
      { ...plain(), version: 2 },
      { ...plain(), perceptionFrames: Array.from({ length: 49 }, (_, tick) => observation(tick)) },
      { ...plain(), perceptionFrames: [observation(2), observation(2)] },
      {
        ...plain(),
        perceptionFrames: [
          {
            ...observation(0),
            ball: { ...observation(0).ball, position: { x: Infinity, y: 1, z: 0 } },
          },
        ],
      },
      {
        ...plain(),
        outcomes: [
          {
            decisionId: 'desconhecida',
            status: 'pending',
            side: TeamSide.HOME,
            kind: 'serve',
            optionId: 'serve.float-deep.center',
          },
        ],
      },
      badId,
      badTerminalRef,
      badTicket,
      { ...plain(), matchEpoch: 1, ownerships: [] },
      { ...plain(), sequences: [2, 0] },
      {
        ...plain(),
        memories: [
          {
            ...plain().memories[0],
            outcomes: Array.from({ length: 7 }, () => ({
              kind: 'serve' as const,
              optionId: 'serve.float-deep.center' as const,
              effectiveness: 1,
            })),
          },
          plain().memories[1],
        ],
      },
    ];

    for (const [index, candidate] of invalid.entries()) {
      expect(() => system.restore(candidate), `snapshot inválido #${index}`).toThrow();
      expect(system.snapshot()).toEqual(baseline);
    }
  });
});
