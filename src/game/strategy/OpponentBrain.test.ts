import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  OpponentBrain,
  STRATEGY_PROFILES,
  attackNetCrossZ,
  readVisibleBall,
  redistributeBestCandidateCap,
  strategyProbabilitiesForScores,
} from './OpponentBrain';
import type {
  AthleteStrategySnapshot,
  StrategyDecisionContext,
  StrategyDecisionKind,
  StrategyMemorySnapshot,
  StrategyObservation,
} from './StrategyTypes';
import { buildOwnContactRead } from './OwnContactRead';

const EMPTY_MEMORY: StrategyMemorySnapshot = Object.freeze({
  revision: 0,
  outcomes: Object.freeze([]),
  recentChoices: Object.freeze([]),
});

function athletes(side: TeamSide): AthleteStrategySnapshot[] {
  const sign = side === TeamSide.HOME ? 1 : -1;
  return Array.from({ length: 6 }, (_, id) => ({
    side,
    id,
    slot: id,
    row: id <= 2 ? 'back' : 'front',
    position: { x: sign * (id <= 2 ? -6 : -2), z: sign * ((id % 3) - 1) * 3 },
    velocity: { x: 0, z: 0 },
    airborne: false,
  }));
}

function observation(): StrategyObservation {
  return {
    tick: 120,
    score: [8, 7],
    phase: 'rally',
    possessionSide: TeamSide.HOME,
    servingSide: TeamSide.AWAY,
    possessionTouches: 1,
    ball: {
      position: { x: -5, y: 2.2, z: 0.4 },
      velocity: { x: 5.4, y: 1.1, z: 0.1 },
      inFlight: true,
      lastVisibleContactTick: 116,
    },
    athletes: [...athletes(TeamSide.HOME), ...athletes(TeamSide.AWAY)],
  };
}

function context(kind: StrategyDecisionKind): StrategyDecisionContext {
  const observed = observation();
  return {
    side: TeamSide.HOME,
    kind,
    decisionTick: 135,
    difficulty: 1,
    observation: observed,
    memory: EMPTY_MEMORY,
    ticket: { selection: 0x1234_5678, variation: 0x8765_4321 },
    attackOriginZ: kind === 'attack' ? -2.8 : undefined,
    setterAthleteId: kind === 'set' ? 3 : undefined,
    ownContactRead:
      kind === 'serve'
        ? undefined
        : buildOwnContactRead({
            tick: 135,
            side: TeamSide.HOME,
            kind: kind === 'set' ? 'pass' : 'set',
            athleteId: kind === 'set' ? 0 : 3,
            ballAfter: {
              position: observed.ball.position,
              velocity: observed.ball.velocity,
              inFlight: observed.ball.inFlight,
            },
            ownAthletes: observed.athletes.filter((athlete) => athlete.side === TeamSide.HOME),
          }),
  } as StrategyDecisionContext & { readonly setterAthleteId?: number };
}

function withOwnContact(
  base: StrategyDecisionContext,
  changes: Readonly<{
    ballAfter?: NonNullable<StrategyDecisionContext['ownContactRead']>['ballAfter'];
    ownAthletes?: NonNullable<StrategyDecisionContext['ownContactRead']>['ownAthletes'];
  }>,
): StrategyDecisionContext {
  const own = base.ownContactRead;
  if (!own) throw new Error('contexto sem contato próprio');
  return {
    ...base,
    ownContactRead: buildOwnContactRead({
      tick: own.tick,
      side: own.side,
      kind: own.kind,
      athleteId: own.athleteId,
      ballAfter: changes.ballAfter ?? own.ballAfter,
      ownAthletes: changes.ownAthletes ?? own.ownAthletes,
    }),
  };
}

function mirrored(input: StrategyDecisionContext): StrategyDecisionContext {
  const swap = (side: TeamSide) => (side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME);
  return {
    ...input,
    side: swap(input.side),
    attackOriginZ: input.attackOriginZ === undefined ? undefined : -input.attackOriginZ,
    ownContactRead:
      input.ownContactRead === undefined
        ? undefined
        : buildOwnContactRead({
            tick: input.ownContactRead.tick,
            side: swap(input.ownContactRead.side),
            kind: input.ownContactRead.kind,
            athleteId: input.ownContactRead.athleteId,
            ballAfter: {
              position: {
                x: -input.ownContactRead.ballAfter.position.x,
                y: input.ownContactRead.ballAfter.position.y,
                z: -input.ownContactRead.ballAfter.position.z,
              },
              velocity: {
                x: -input.ownContactRead.ballAfter.velocity.x,
                y: input.ownContactRead.ballAfter.velocity.y,
                z: -input.ownContactRead.ballAfter.velocity.z,
              },
              inFlight: input.ownContactRead.ballAfter.inFlight,
            },
            ownAthletes: input.ownContactRead.ownAthletes.map((athlete) => ({
              ...athlete,
              side: swap(athlete.side),
              position: { x: -athlete.position.x, z: -athlete.position.z },
              velocity: { x: -athlete.velocity.x, z: -athlete.velocity.z },
            })),
          }),
    observation: {
      ...input.observation,
      score: [input.observation.score[1], input.observation.score[0]],
      possessionSide:
        input.observation.possessionSide === null ? null : swap(input.observation.possessionSide),
      servingSide: swap(input.observation.servingSide),
      ball: {
        ...input.observation.ball,
        position: {
          x: -input.observation.ball.position.x,
          y: input.observation.ball.position.y,
          z: -input.observation.ball.position.z,
        },
        velocity: {
          x: -input.observation.ball.velocity.x,
          y: input.observation.ball.velocity.y,
          z: -input.observation.ball.velocity.z,
        },
      },
      athletes: input.observation.athletes.map((athlete) => ({
        ...athlete,
        side: swap(athlete.side),
        position: { x: -athlete.position.x, z: -athlete.position.z },
        velocity: { x: -athlete.velocity.x, z: -athlete.velocity.z },
      })),
    },
  };
}

describe('OpponentBrain', () => {
  it('usa bola e elenco próprios frescos sem substituir o rival atrasado no set', () => {
    const brain = new OpponentBrain();
    const fresh = context('set');
    const poisonedOwnSide = {
      ...fresh,
      observation: {
        ...fresh.observation,
        ball: { ...fresh.observation.ball, inFlight: false },
        athletes: fresh.observation.athletes.map((athlete) =>
          athlete.side === fresh.side
            ? {
                ...athlete,
                position: { x: athlete.position.x - 20, z: athlete.position.z + 20 },
                velocity: { x: -20, z: 20 },
              }
            : athlete,
        ),
      },
    };

    expect(brain.decide(poisonedOwnSide)).toEqual(brain.decide(fresh));
  });

  it.each([
    ['serve', 9],
    ['set', 5],
    ['attack', 8],
  ] as const)('gera internamente candidatos canônicos de %s', (kind, maximum) => {
    const proposal = new OpponentBrain().decide(context(kind));

    expect(proposal.kind).toBe(kind);
    expect(proposal.candidates.length).toBeLessThanOrEqual(maximum);
    expect(proposal.candidates.length).toBeGreaterThan(0);
    expect(proposal.candidates.map((candidate) => candidate.optionId)).toEqual(
      [...proposal.candidates.map((candidate) => candidate.optionId)].sort(),
    );
    expect(proposal.candidates.every((candidate) => candidate.kind === kind)).toBe(true);
  });

  it('limita todos os componentes e scores a [0,1] com probabilidades normalizadas', () => {
    for (const kind of ['serve', 'set', 'attack'] as const) {
      const proposal = new OpponentBrain().decide(context(kind));
      for (const candidate of proposal.candidates) {
        expect(candidate.score).toBeGreaterThanOrEqual(0);
        expect(candidate.score).toBeLessThanOrEqual(1);
        expect(candidate.probability).toBeGreaterThanOrEqual(0);
        expect(candidate.probability).toBeLessThanOrEqual(1);
        expect(Object.values(candidate.components).every((value) => value >= 0 && value <= 1)).toBe(
          true,
        );
      }
      expect(
        proposal.candidates.reduce((sum, candidate) => sum + candidate.probability, 0),
      ).toBeCloseTo(1, 12);
    }
  });

  it('uma shortlist dominante escolhe a única opção com 100%', () => {
    const input = context('serve');
    const dominant: StrategyDecisionContext = {
      ...input,
      memory: {
        revision: 7,
        outcomes: [
          ...[
            'serve.float-deep.center',
            'serve.float-deep.left',
            'serve.float-deep.right',
            'serve.float-short.center',
            'serve.float-short.right',
            'serve.power-deep.center',
            'serve.power-deep.left',
            'serve.power-deep.right',
          ].map((optionId) => ({
            kind: 'serve' as const,
            optionId: optionId as StrategyMemorySnapshot['outcomes'][number]['optionId'],
            effectiveness: 0,
          })),
          { kind: 'serve', optionId: 'serve.float-short.left', effectiveness: 1 },
        ],
        recentChoices: [
          'serve.float-short.right',
          'serve.power-deep.center',
          'serve.power-deep.left',
        ],
      },
      observation: {
        ...input.observation,
        athletes: input.observation.athletes.map((athlete) => {
          const occupied = [
            { x: 7.2, z: -3 },
            { x: 7.2, z: 0 },
            { x: 7.2, z: 3 },
            { x: 3.4, z: 0 },
            { x: 3.4, z: 3 },
            { x: 5.3, z: 1.5 },
          ];
          return athlete.side === TeamSide.AWAY
            ? { ...athlete, position: occupied[athlete.id] }
            : athlete;
        }),
      },
    };

    const proposal = new OpponentBrain().decide(dominant);
    const possible = proposal.candidates.filter((candidate) => candidate.probability > 0);

    expect(possible).toHaveLength(1);
    expect(possible[0].probability).toBe(1);
    expect(proposal.chosen.optionId).toBe('serve.float-short.left');
  });

  it('aplica limiar inclusivo e caps 50/55/70 com redistribuição proporcional', () => {
    expect(strategyProbabilitiesForScores([1, 0.78, 0.779], 'serve', 0)[2]).toBe(0);
    expect(STRATEGY_PROFILES.map((profile) => profile.cap)).toEqual([0.5, 0.55, 0.7]);

    for (const [difficulty, cap] of [
      [0, 0.5],
      [1, 0.55],
      [2, 0.7],
    ] as const) {
      const probabilities = strategyProbabilitiesForScores([1, 0.78], 'serve', difficulty);
      expect(probabilities[0]).toBeCloseTo(cap, 12);
      expect(probabilities[1]).toBeCloseTo(1 - cap, 12);
      expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    }

    const redistributed = redistributeBestCandidateCap([0.9, 0.06, 0.04], 0, 0.6);
    expect(redistributed[0]).toBeCloseTo(0.6, 12);
    expect(redistributed[1]).toBeCloseTo(0.24, 12);
    expect(redistributed[2]).toBeCloseTo(0.16, 12);
  });

  it('memória lê o último outcome como mais recente com profundidade 2/5/6 ponderada', () => {
    const optionId = 'serve.float-deep.center' as const;
    const outcomes = [0, 0.2, 0.4, 0.6, 0.8, 1].map((effectiveness) => ({
      kind: 'serve' as const,
      optionId,
      effectiveness,
    }));
    const memory = { revision: 3, outcomes, recentChoices: [] } as const;
    const valueAt = (difficulty: 0 | 1 | 2) => {
      const proposal = new OpponentBrain().decide({ ...context('serve'), difficulty, memory });
      return proposal.candidates.find((candidate) => candidate.optionId === optionId)!.components
        .memory;
    };
    const weights = [1, 0.72, 0.52, 0.37, 0.27, 0.19];
    const weighted = (depth: number) => {
      const recent = [...outcomes].reverse().slice(0, depth);
      return (
        recent.reduce((sum, outcome, index) => sum + outcome.effectiveness * weights[index], 0) /
        weights.slice(0, depth).reduce((sum, weight) => sum + weight, 0)
      );
    };

    expect(valueAt(0)).toBeCloseTo(weighted(2), 12);
    expect(valueAt(1)).toBeCloseTo(weighted(5), 12);
    expect(valueAt(2)).toBeCloseTo(weighted(6), 12);
  });

  it('corta a janela cronológica da categoria antes de procurar a mesma opção', () => {
    const proposal = new OpponentBrain().decide({
      ...context('serve'),
      difficulty: 0,
      memory: {
        revision: 4,
        outcomes: [
          { kind: 'serve', optionId: 'serve.float-deep.center', effectiveness: 1 },
          { kind: 'serve', optionId: 'serve.float-short.left', effectiveness: 0 },
          { kind: 'serve', optionId: 'serve.power-deep.right', effectiveness: 0 },
        ],
        recentChoices: [],
      },
    });

    expect(
      proposal.candidates.find((candidate) => candidate.optionId === 'serve.float-deep.center')!
        .components.memory,
    ).toBe(0.5);
  });

  it('variedade penaliza cumulativamente uma, duas e três repetições recentes', () => {
    const optionId = 'serve.float-deep.center' as const;
    const valueAt = (count: number) => {
      const proposal = new OpponentBrain().decide({
        ...context('serve'),
        memory: {
          revision: count,
          outcomes: [],
          recentChoices: Array.from({ length: count }, () => optionId),
        },
      });
      return proposal.candidates.find((candidate) => candidate.optionId === optionId)!.components
        .variety;
    };

    expect(valueAt(1)).toBeCloseTo(2 / 3, 12);
    expect(valueAt(2)).toBeCloseTo(1 / 3, 12);
    expect(valueAt(3)).toBe(0);
  });

  it('variedade considera as três escolhas recentes da mesma categoria', () => {
    const optionId = 'attack.placed-line' as const;
    const proposal = new OpponentBrain().decide({
      ...context('attack'),
      memory: {
        revision: 5,
        outcomes: [],
        recentChoices: [optionId, 'set.high-left', optionId, 'set.high-right', optionId],
      },
    });

    expect(
      proposal.candidates.find((candidate) => candidate.optionId === optionId)!.components.variety,
    ).toBe(0);
  });

  it('projeta a bola vetorialmente e rejeita afastamento, desvio lateral e velocidade quase zero', () => {
    const onCourse = context('set');
    const ownBall = onCourse.ownContactRead!.ballAfter;
    const movingAway = withOwnContact(onCourse, {
      ballAfter: { ...ownBall, velocity: { x: -4, y: 5.5, z: 0 } },
    });
    const lateral = withOwnContact(onCourse, {
      ballAfter: {
        ...ownBall,
        position: { x: -5, y: 2.2, z: 3.5 },
        velocity: { x: 4, y: 5.5, z: 0 },
      },
    });
    const stopped = withOwnContact(onCourse, {
      ballAfter: { ...ownBall, velocity: { x: 1e-5, y: 0, z: 0 } },
    });

    expect(readVisibleBall(onCourse).reachable).toBe(true);
    expect(readVisibleBall(movingAway).reachable).toBe(false);
    expect(readVisibleBall(lateral).reachable).toBe(false);
    expect(readVisibleBall(stopped).reachable).toBe(false);
  });

  it('serve seamEta usa ETA das duas recebedoras, inclusive direção das velocidades', () => {
    const base = context('serve');
    const seamAt = (velocityX: number) => {
      const proposal = new OpponentBrain().decide({
        ...base,
        observation: {
          ...base.observation,
          athletes: base.observation.athletes.map((athlete) =>
            athlete.side === TeamSide.AWAY
              ? {
                  ...athlete,
                  position: { x: 6, z: athlete.id % 2 === 0 ? -0.5 : 0.5 },
                  velocity: { x: velocityX, z: 0 },
                }
              : athlete,
          ),
        },
      });
      return proposal.candidates.find(
        (candidate) => candidate.optionId === 'serve.float-short.center',
      )!.components.seamEta;
    };

    expect(seamAt(5.6)).toBeGreaterThan(seamAt(-5.6));
  });

  it('set viabilityEta usa a melhor ETA de atacante legal, não distância estática', () => {
    const base = context('set');
    const viabilityAt = (velocityX: number) => {
      const proposal = new OpponentBrain().decide(
        withOwnContact(base, {
          ownAthletes: base.ownContactRead!.ownAthletes.map((athlete) =>
            athlete.row === 'front'
              ? {
                  ...athlete,
                  position: { x: -5.5, z: -3.15 },
                  velocity: { x: velocityX, z: 0 },
                }
              : athlete,
          ),
        }),
      );
      return proposal.candidates.find((candidate) => candidate.optionId === 'set.high-left')!
        .components.viabilityEta;
    };

    expect(viabilityAt(5.6)).toBeGreaterThan(viabilityAt(-5.6));
  });

  it('set blockPressure usa ETA até o staging legal e distingue alinhado de oposto', () => {
    const base = context('set');
    const pressureAt = (blockerZ: number, velocityZ = 0) => {
      const proposal = new OpponentBrain().decide({
        ...base,
        observation: {
          ...base.observation,
          athletes: base.observation.athletes.map((athlete) =>
            athlete.side === TeamSide.AWAY && athlete.row === 'front'
              ? {
                  ...athlete,
                  position: { x: 0.72, z: blockerZ },
                  velocity: { x: 0, z: velocityZ },
                }
              : athlete,
          ),
        },
      });
      return proposal.candidates.find((candidate) => candidate.optionId === 'set.high-left')!
        .components.blockPressure;
    };

    expect(pressureAt(-3.15)).toBeLessThan(pressureAt(3.15));
    expect(pressureAt(0, -5.6)).toBeLessThan(pressureAt(0, 5.6));
  });

  it('poda quick pela ETA canônica da central, direção e tempo disponível', () => {
    const quickExists = (input: StrategyDecisionContext) =>
      new OpponentBrain()
        .decide(input)
        .candidates.some((candidate) => candidate.optionId === 'set.quick-center');
    const base = context('set');
    const withCentral = (x: number, velocityX: number, ballX = -5) =>
      withOwnContact(base, {
        ballAfter: {
          ...base.ownContactRead!.ballAfter,
          position: { x: ballX, y: 2.2, z: 1 },
          velocity: { x: 4, y: 5.8, z: 0 },
        },
        ownAthletes: base.ownContactRead!.ownAthletes.map((athlete) =>
          athlete.id === 4
            ? { ...athlete, position: { x, z: 0 }, velocity: { x: velocityX, z: 0 } }
            : athlete,
        ),
      });

    expect(quickExists(withCentral(-6.5, 5.6))).toBe(true);
    expect(quickExists(withCentral(-6.5, -5.6))).toBe(false);
    expect(quickExists(withCentral(-8.5, 0, -1.5))).toBe(false);
    // Folga de chegada: a central pode chegar um pouco DEPOIS do toque da levantadora —
    // o voo do quick cobre a diferença (QUICK_WINDOW.arrivalSlack).
    expect(quickExists(withCentral(-6.9, 0))).toBe(true);
    const airborne = withCentral(-6.5, 5.6);
    expect(
      quickExists(
        withOwnContact(airborne, {
          ownAthletes: airborne.ownContactRead!.ownAthletes.map((athlete) =>
            athlete.row === 'front' ? { ...athlete, airborne: true } : athlete,
          ),
        }),
      ),
    ).toBe(false);
  });

  it('não trata a levantadora central como atacante disponível para quick', () => {
    const base = context('set') as StrategyDecisionContext & { readonly setterAthleteId: number };
    const proposal = new OpponentBrain().decide(
      withOwnContact(
        { ...base, setterAthleteId: 4 },
        {
          ballAfter: {
            ...base.ownContactRead!.ballAfter,
            position: { x: -5, y: 2.2, z: 1 },
            velocity: { x: 4, y: 5.8, z: 0 },
          },
          ownAthletes: base.ownContactRead!.ownAthletes.map((athlete) =>
            athlete.row !== 'front'
              ? athlete
              : athlete.id === 4
                ? { ...athlete, position: { x: -0.82, z: 0 }, velocity: { x: 0, z: 0 } }
                : {
                    ...athlete,
                    position: { x: -8.5, z: athlete.position.z },
                    velocity: { x: -5.6, z: 0 },
                  },
          ),
        },
      ),
    );

    expect(proposal.candidates.some((candidate) => candidate.optionId === 'set.quick-center')).toBe(
      false,
    );
  });

  it('usa o cruzamento origem→target para inverter a pressão de bloco em linha/diagonal', () => {
    const base = context('attack');
    const baseline = new OpponentBrain().decide(base);
    const line = baseline.candidates.find(
      (candidate) => candidate.optionId === 'attack.placed-line',
    )!;
    const cross = baseline.candidates.find(
      (candidate) => candidate.optionId === 'attack.placed-cross',
    )!;
    const lineCross = attackNetCrossZ(base.attackOriginZ!, line.target, base.side);
    const crossCross = attackNetCrossZ(base.attackOriginZ!, cross.target, base.side);
    const blockedAt = (z: number, airborne = false) => ({
      ...base,
      observation: {
        ...base.observation,
        athletes: base.observation.athletes.map((athlete) =>
          athlete.side === TeamSide.AWAY && athlete.row === 'front'
            ? { ...athlete, position: { x: 0.72, z }, airborne }
            : athlete,
        ),
      },
    });
    const component = (input: StrategyDecisionContext, id: string) =>
      new OpponentBrain().decide(input).candidates.find((candidate) => candidate.optionId === id)!
        .components.block;

    expect(component(blockedAt(lineCross), line.optionId)).toBeLessThan(
      component(blockedAt(lineCross), cross.optionId),
    );
    expect(component(blockedAt(crossCross), cross.optionId)).toBeLessThan(
      component(blockedAt(crossCross), line.optionId),
    );
    expect(component(blockedAt(lineCross + 0.8, true), line.optionId)).toBeLessThan(
      component(blockedAt(lineCross + 0.8, false), line.optionId),
    );
    const farFromNet = {
      ...base,
      observation: {
        ...base.observation,
        athletes: base.observation.athletes.map((athlete) =>
          athlete.side === TeamSide.AWAY && athlete.row === 'front'
            ? { ...athlete, position: { x: 4.5, z: lineCross } }
            : athlete,
        ),
      },
    };
    expect(component(farFromNet, line.optionId)).toBeGreaterThan(
      component(blockedAt(lineCross), line.optionId),
    );
  });

  it('usa attackOriginZ explícito, não o z da bola, e o espelha', () => {
    const left = context('attack');
    const poisonedBall = {
      ...left,
      observation: {
        ...left.observation,
        ball: { ...left.observation.ball, position: { ...left.observation.ball.position, z: 4.2 } },
      },
    };
    const first = new OpponentBrain().decide(left);
    const poisoned = new OpponentBrain().decide(poisonedBall);
    const away = new OpponentBrain().decide(mirrored(left));

    expect(poisoned).toEqual(first);
    expect(
      away.candidates.map((candidate) => ({
        ...candidate,
        target: { x: -candidate.target.x, z: -candidate.target.z },
      })),
    ).toEqual(first.candidates);
  });

  it('defesa funda favorece a família tip e corredor vazio favorece o saque esperado', () => {
    const attack = context('attack');
    const deepDefense = {
      ...attack,
      observation: {
        ...attack.observation,
        athletes: attack.observation.athletes.map((athlete) =>
          athlete.side === TeamSide.AWAY && athlete.row === 'back'
            ? { ...athlete, position: { x: 8.4, z: athlete.position.z } }
            : athlete,
        ),
      },
    };
    const proposal = new OpponentBrain().decide(deepDefense);
    const best = proposal.candidates.reduce((selected, candidate) =>
      candidate.score > selected.score ? candidate : selected,
    );

    expect(best.family).toBe('tip');
  });

  it('usa o primeiro uint32 sobre uma CDF em ordem canônica', () => {
    const low = new OpponentBrain().decide({
      ...context('attack'),
      ticket: { selection: 0, variation: 7 },
    });
    const high = new OpponentBrain().decide({
      ...context('attack'),
      ticket: { selection: 0xffff_ffff, variation: 7 },
    });
    const possible = low.candidates.filter((candidate) => candidate.probability > 0);

    expect(possible.length).toBeGreaterThan(1);
    expect(low.chosen.optionId).toBe(possible[0].optionId);
    expect(high.chosen.optionId).toBe(possible.at(-1)?.optionId);
  });

  it('o segundo uint32 só varia o subtarget legal, sem mudar scores ou escolha', () => {
    const first = new OpponentBrain().decide({
      ...context('serve'),
      ticket: { selection: 42, variation: 1 },
    });
    const varied = new OpponentBrain().decide({
      ...context('serve'),
      ticket: { selection: 42, variation: 2 },
    });

    expect(varied.chosen.optionId).toBe(first.chosen.optionId);
    expect(varied.candidates.map(({ target: _target, ...candidate }) => candidate)).toEqual(
      first.candidates.map(({ target: _target, ...candidate }) => candidate),
    );
    expect(varied.chosen.target).not.toEqual(first.chosen.target);
  });

  it('é invariável à permutação dos snapshots de atletas', () => {
    const input = context('set');
    const permuted = {
      ...input,
      observation: {
        ...input.observation,
        athletes: [...input.observation.athletes].reverse(),
      },
    };

    expect(new OpponentBrain().decide(permuted)).toEqual(new OpponentBrain().decide(input));
  });

  it.each(['serve', 'set', 'attack'] as const)('é exatamente espelhado em %s', (kind) => {
    const home = new OpponentBrain().decide(context(kind));
    const away = new OpponentBrain().decide(mirrored(context(kind)));

    expect(away.chosen.optionId).toBe(home.chosen.optionId);
    expect(
      away.candidates.map((candidate) => ({
        ...candidate,
        target: { x: -candidate.target.x, z: -candidate.target.z },
      })),
    ).toEqual(home.candidates);
  });

  it('ignora campos privados extras com o mesmo DTO público (future-poison)', () => {
    const clean = context('attack');
    const poisoned = {
      ...clean,
      aim: { x: 99, z: 99 },
      chosenZone: 2,
      plan: { point: { x: -99, y: 8, z: 99 }, contactIn: 0.001 },
      futureInput: { direction: { x: 1, z: -1 }, action: true },
      observation: {
        ...clean.observation,
        landing: { x: 99, z: 99, time: 0.01 },
        athletes: clean.observation.athletes.map((athlete) => ({
          ...athlete,
          target: { x: 99, z: 99 },
        })),
      },
    } as unknown as StrategyDecisionContext;

    expect(new OpponentBrain().decide(poisoned)).toEqual(new OpponentBrain().decide(clean));
  });

  it('devolve uma árvore profundamente congelada sem mutar a entrada', () => {
    const input = context('serve');
    const before = structuredClone(input);
    const proposal = new OpponentBrain().decide(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.ticket)).toBe(true);
    expect(Object.isFrozen(proposal.candidates)).toBe(true);
    expect(Object.isFrozen(proposal.candidates[0])).toBe(true);
    expect(Object.isFrozen(proposal.candidates[0].target)).toBe(true);
    expect(Object.isFrozen(proposal.candidates[0].components)).toBe(true);
  });

  it('rejeita tickets, ticks e observações inválidas antes de decidir', () => {
    const valid = context('serve');

    expect(() =>
      new OpponentBrain().decide({
        ...valid,
        ticket: { selection: -1, variation: 0 },
      }),
    ).toThrow(/ticket/i);
    expect(() => new OpponentBrain().decide({ ...valid, decisionTick: 119 })).toThrow(/tick/i);
    expect(() =>
      new OpponentBrain().decide({
        ...valid,
        observation: {
          ...valid.observation,
          athletes: valid.observation.athletes.slice(1),
        },
      }),
    ).toThrow(/12 atletas/i);
  });

  it('exige levantadora da própria equipe no roster para decisões de set', () => {
    const valid = context('set') as StrategyDecisionContext & {
      readonly setterAthleteId?: number;
    };
    expect(() => new OpponentBrain().decide({ ...valid, setterAthleteId: undefined })).toThrow(
      /levantadora|setter/i,
    );

    expect(() =>
      new OpponentBrain().decide({
        ...valid,
        setterAthleteId: 99,
        observation: {
          ...valid.observation,
          athletes: valid.observation.athletes.map((athlete) =>
            athlete.side === TeamSide.AWAY && athlete.id === 0 ? { ...athlete, id: 99 } : athlete,
          ),
        },
      }),
    ).toThrow(/levantadora|setter/i);
  });

  it('rejeita side/kind/posse/placar/contact tick e memória semanticamente inválidos', () => {
    const valid = context('serve');
    const decide = (patch: Partial<StrategyDecisionContext>) =>
      new OpponentBrain().decide({ ...valid, ...patch } as StrategyDecisionContext);

    expect(() => decide({ side: 9 as TeamSide })).toThrow(/side|lado/i);
    expect(() => decide({ kind: 'future' as StrategyDecisionKind })).toThrow(/kind|tipo/i);
    expect(() =>
      decide({
        observation: {
          ...valid.observation,
          athletes: valid.observation.athletes.map((athlete, index) =>
            index === 0 ? { ...athlete, side: 9 as TeamSide } : athlete,
          ),
        },
      }),
    ).toThrow(/side|lado/i);
    expect(() => decide({ observation: { ...valid.observation, score: [-1, 0] } })).toThrow(
      /placar/i,
    );
    expect(() =>
      decide({
        observation: {
          ...valid.observation,
          score: [1] as unknown as readonly [number, number],
        },
      }),
    ).toThrow(/placar/i);
    expect(() =>
      decide({ observation: { ...valid.observation, possessionSide: 9 as TeamSide } }),
    ).toThrow(/posse/i);
    expect(() => decide({ observation: { ...valid.observation, possessionTouches: 4 } })).toThrow(
      /toques/i,
    );
    expect(() =>
      decide({
        observation: {
          ...valid.observation,
          ball: { ...valid.observation.ball, lastVisibleContactTick: 121 },
        },
      }),
    ).toThrow(/contato/i);
    expect(() =>
      decide({
        memory: {
          revision: 1,
          outcomes: [{ kind: 'attack', optionId: 'serve.float-deep.left', effectiveness: 1 }],
          recentChoices: [],
        },
      }),
    ).toThrow(/outcome|memória/i);
  });
});
