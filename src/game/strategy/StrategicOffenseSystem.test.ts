import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTACT, GRAVITY, TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { OpponentBrain } from './OpponentBrain';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import type { OwnContactReadSource } from './OwnContactRead';
import {
  StrategicOffenseSystem,
  type OffenseContactRef,
  type SetDecisionDraft,
} from './StrategicOffenseSystem';
import type { StrategyObservation } from './StrategyTypes';
import type { StrategyOptionId } from './StrategyTypes';
import type { BoundAttackCommitment } from './StrategicAttackTypes';

function observation(tick: number): StrategyObservation {
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
    athletes: [TeamSide.HOME, TeamSide.AWAY].flatMap((side) => {
      const sign = side === TeamSide.HOME ? 1 : -1;
      return Array.from({ length: 6 }, (_, id) => ({
        side,
        id,
        slot: id,
        row: id <= 2 ? ('back' as const) : ('front' as const),
        position: { x: sign * (id <= 2 ? -6 : -2), z: sign * ((id % 3) - 1) * 3 },
        velocity: { x: 0, z: 0 },
        airborne: false,
      }));
    }),
  };
}

function passRead(
  tick = 6,
  side: TeamSide = TeamSide.HOME,
  changes: Partial<OwnContactReadSource> = {},
): OwnContactReadSource {
  const sign = side === TeamSide.HOME ? 1 : -1;
  const read: OwnContactReadSource = {
    tick,
    side,
    kind: 'pass',
    athleteId: 0,
    ballAfter: {
      position: { x: sign * -4, y: 1, z: 0 },
      velocity: { x: sign * 3, y: 6, z: 0 },
      inFlight: true,
    },
    ownAthletes: Array.from({ length: 6 }, (_, id) => ({
      side,
      id,
      slot: id,
      row: id <= 2 ? ('back' as const) : ('front' as const),
      position: {
        x: sign * (id === 1 ? -2.2 : -7 - id * 0.2),
        z: sign * (id - 3),
      },
      velocity: { x: 0, z: 0 },
      airborne: false,
    })),
  };
  return { ...read, ...changes };
}

function passReadForLead(leadTicks: number, tick = 6): OwnContactReadSource {
  const base = passRead(tick);
  const contactIn = leadTicks / 60;
  return {
    ...base,
    ballAfter: {
      position: { x: -2.2, y: CONTACT.set, z: 0 },
      velocity: { x: 0, y: -0.5 * GRAVITY * contactIn, z: 0 },
      inFlight: true,
    },
    ownAthletes: base.ownAthletes.map((athlete) =>
      athlete.id === 1 ? { ...athlete, position: { x: -2.2, z: 0 } } : athlete,
    ),
  };
}

function setup() {
  const home = new SequenceRandom([1, 2, 3, 4, 5, 6, 7, 8]);
  const away = new SequenceRandom([11, 12, 13, 14, 15, 16]);
  const strategy = new OpponentStrategySystem({ streams: { home, away } });
  const offense = new StrategicOffenseSystem(strategy);
  return { home, away, strategy, offense };
}

function setupWithChoices(setOption: StrategyOptionId, attackOption: StrategyOptionId) {
  const home = new SequenceRandom(Array.from({ length: 24 }, (_, index) => index + 1));
  const away = new SequenceRandom(Array.from({ length: 24 }, (_, index) => index + 101));
  const brain = {
    decide(input: Parameters<OpponentBrain['decide']>[0]) {
      const proposal = new OpponentBrain().decide(input);
      const optionId =
        input.kind === 'set' ? setOption : input.kind === 'attack' ? attackOption : null;
      if (!optionId) return proposal;
      const chosen = proposal.candidates.find((candidate) => candidate.optionId === optionId);
      if (!chosen) throw new Error(`fixture deveria permitir ${optionId}`);
      return { ...proposal, chosen };
    },
  };
  const strategy = new OpponentStrategySystem({ streams: { home, away }, brain });
  const offense = new StrategicOffenseSystem(strategy);
  return { home, away, strategy, offense };
}

function quickPassRead(tick = 6): OwnContactReadSource {
  const base = passRead(tick);
  return {
    ...base,
    ballAfter: {
      position: { x: -5, y: 2.2, z: 1 },
      velocity: { x: 4, y: 5.8, z: 0 },
      inFlight: true,
    },
    ownAthletes: base.ownAthletes.map((athlete) =>
      athlete.id === 4
        ? { ...athlete, position: { x: -6.5, z: 0 }, velocity: { x: 5.6, z: 0 } }
        : athlete,
    ),
  };
}

function executedSetRead(
  tick: number,
  setterAthleteId: number,
  target = { x: -1.05, z: -3.15 },
  contactLeadTicks?: number,
): OwnContactReadSource {
  const base = passRead(tick);
  const contactIn = contactLeadTicks === undefined ? null : contactLeadTicks / 60;
  return {
    ...base,
    kind: 'set',
    athleteId: setterAthleteId,
    ballAfter: {
      position: {
        x: target.x,
        y: contactIn === null ? CONTACT.set : CONTACT.spike,
        z: target.z,
      },
      velocity: {
        x: 0,
        y: contactIn === null ? 5 : -0.5 * GRAVITY * contactIn,
        z: 0,
      },
      inFlight: true,
    },
    ownAthletes: base.ownAthletes.map((athlete) => {
      if (athlete.id === 3) return { ...athlete, position: { x: target.x, z: target.z } };
      if (athlete.id === 4) return { ...athlete, position: { x: -1, z: 0 } };
      if (athlete.id === 5) return { ...athlete, position: { x: -1, z: 3 } };
      return athlete;
    }),
  };
}

function contact(
  offense: StrategicOffenseSystem,
  read: OwnContactReadSource = passRead(),
  possessionTouches: 1 | 2 | 3 = 1,
): OffenseContactRef {
  const result = offense.observeContact(offense.beginRally(), read, possessionTouches);
  if (result.status !== 'observed') throw new Error(`esperava observed: ${result.status}`);
  return result.contact;
}

function prepared(offense: StrategicOffenseSystem, ref: OffenseContactRef): SetDecisionDraft {
  const result = offense.prepareSet(ref, 2);
  if (result.status !== 'prepared') throw new Error(`esperava prepared: ${result.status}`);
  return result.draft;
}

describe('StrategicOffenseSystem set lifecycle', () => {
  it('checkpoint de fronteira restaura epochs ofensivos sem estado ativo', () => {
    const { offense } = setup();
    const first = offense.beginRally();
    offense.endRally(first);
    const checkpoint = offense.checkpointBoundary();
    const second = offense.beginRally();
    offense.endRally(second);

    offense.restoreBoundary(checkpoint);
    const replayed = offense.beginRally();

    expect(replayed.rallyEpoch).toBe(second.rallyEpoch);
    expect(() => offense.checkpointBoundary()).toThrow(/fronteira de ponto/);
    expect(Object.isFrozen(checkpoint)).toBe(true);
  });

  it('gera epochs próprios monotônicos e rejeita token stale antes do payload', () => {
    const { home, offense } = setup();
    const firstRally = offense.beginRally();
    const firstResult = offense.observeContact(firstRally, passRead(), 1);
    if (firstResult.status !== 'observed') throw new Error('unreachable');
    const first = firstResult.contact;
    const secondResult = offense.observeContact(firstRally, passRead(7, TeamSide.AWAY), 1);
    if (secondResult.status !== 'observed') throw new Error('unreachable');
    const second = secondResult.contact;

    expect(second.possessionEpoch).toBe(first.possessionEpoch + 1);
    expect(offense.observeContact(firstRally, null as unknown as OwnContactReadSource, 3)).toEqual({
      status: 'invalid',
    });
    expect(home.draws).toBe(0);

    const nextRally = offense.beginRally();
    expect(nextRally.rallyEpoch).toBe(firstRally.rallyEpoch + 1);
    expect(offense.observeContact(firstRally, null as never, 99 as never)).toEqual({
      status: 'stale',
    });
  });

  it('abre nova posse no primeiro toque mesmo para o mesmo lado e exige sequência 1→2→3', () => {
    const { offense } = setup();
    const rally = offense.beginRally();
    const first = offense.observeContact(rally, passRead(6), 1);
    if (first.status !== 'observed') throw new Error('unreachable');
    const next = offense.observeContact(rally, passRead(7), 1);
    if (next.status !== 'observed') throw new Error('unreachable');

    expect(next.contact.possessionEpoch).toBe(first.contact.possessionEpoch + 1);
    expect(next.contact.contactSequence).toBe(1);
    expect(offense.observeContact(rally, passRead(8), 3)).toEqual({ status: 'invalid' });
    const second = offense.observeContact(rally, passRead(8), 2);
    expect(second).toMatchObject({ status: 'observed', contact: { contactSequence: 2 } });
    expect(offense.observeContact(rally, passRead(7), 3)).toEqual({ status: 'invalid' });
  });

  it('deduplica contato idêntico e rejeita payload conflitante no mesmo tick', () => {
    const { offense } = setup();
    const rally = offense.beginRally();
    const source = passRead(6);
    const first = offense.observeContact(rally, source, 1);
    const replay = offense.observeContact(rally, structuredClone(source), 1);
    const poisoned = offense.observeContact(
      rally,
      {
        ...source,
        ballAfter: {
          ...source.ballAfter,
          velocity: { ...source.ballAfter.velocity, z: 4 },
        },
      },
      1,
    );

    expect(first.status).toBe('observed');
    expect(replay).toBe(first);
    expect(poisoned).toEqual({ status: 'invalid' });
  });

  it('seleciona levantadora por ETA, compromete +2 no lado e congela o draft', () => {
    const { home, away, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense));

    expect(draft.setterAthleteId).toBe(1);
    expect(draft.leadTicks).toBeGreaterThanOrEqual(24);
    expect(draft.execution.mode).toBe('strategic');
    expect(draft.ref.contactSequence).toBe(1);
    expect(home.draws).toBe(2);
    expect(away.draws).toBe(0);
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.ref)).toBe(true);
    expect(Object.isFrozen(draft.execution)).toBe(true);
    if (draft.execution.mode !== 'strategic') throw new Error('unreachable');
    expect(strategy.outcomeState(draft.execution.decisionId)).toBe('pending');
    expect(draft.execution.observationTick).toBe(0);
  });

  it('prepare repetido devolve a mesma decisão sem reler nem consumir ticket', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const ref = contact(offense);
    const first = offense.prepareSet(ref, 2);
    const second = offense.prepareSet(ref, 99 as never);

    expect(first.status).toBe('prepared');
    expect(second).toBe(first);
    expect(home.draws).toBe(2);
  });

  it('usa high fallback sem ticket quando o lead é menor que 24 ticks', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const lowLead = passReadForLead(23.1);
    const draft = prepared(offense, contact(offense, lowLead));

    expect(draft.leadTicks).toBeLessThan(24);
    expect(draft.execution).toMatchObject({
      mode: 'fallback-high',
      reason: 'insufficient-lead',
      family: 'high',
    });
    expect(home.draws).toBe(0);
    expect(strategy.snapshot().decisions).toHaveLength(0);
  });

  it.each([24, 25])('aceita lead conservador de %i ticks', (leadTicks) => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense, passReadForLead(leadTicks)));

    expect(draft.leadTicks).toBe(leadTicks);
    expect(draft.execution.mode).toBe('strategic');
    expect(home.draws).toBe(2);
  });

  it('usa fallback sem ticket quando não existe snapshot rival elegível', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(10));
    const draft = prepared(offense, contact(offense, passRead(10)));

    expect(draft.execution).toMatchObject({
      mode: 'fallback-high',
      reason: 'perception-not-ready',
    });
    expect(home.draws).toBe(0);
    expect(strategy.snapshot().decisions).toHaveLength(0);
  });

  it('usa safety-freeball quando não existe ponta legal para o fallback', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(10));
    const base = passRead(10);
    const noHitter = {
      ...base,
      ownAthletes: base.ownAthletes.map((athlete) =>
        athlete.row === 'front' ? { ...athlete, airborne: true } : athlete,
      ),
    } satisfies OwnContactReadSource;
    const draft = prepared(offense, contact(offense, noHitter));

    expect(draft.execution).toEqual({
      mode: 'safety-freeball',
      reason: 'no-attacker',
    });
    expect(home.draws).toBe(0);
  });

  it('alterna desempate simétrico de fallback por posse sem RNG', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(10));
    const symmetric = (tick: number) => {
      const base = passRead(tick);
      return {
        ...base,
        ownAthletes: base.ownAthletes.map((athlete) => {
          if (athlete.id === 3) return { ...athlete, position: { x: -1.05, z: -3.15 } };
          if (athlete.id === 5) return { ...athlete, position: { x: -1.05, z: 3.15 } };
          if (athlete.id === 4) return { ...athlete, airborne: true };
          return athlete;
        }),
      } satisfies OwnContactReadSource;
    };
    const first = prepared(offense, contact(offense, symmetric(10)));
    const second = prepared(offense, contact(offense, symmetric(11)));
    if (first.execution.mode !== 'fallback-high' || second.execution.mode !== 'fallback-high') {
      throw new Error('unreachable');
    }

    expect([first.execution.optionId, second.execution.optionId].sort()).toEqual([
      'set.high-left',
      'set.high-right',
    ]);
    expect(home.draws).toBe(0);
  });

  it('retorna unplayable sem mutação quando ninguém alcança a janela da levantada', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const base = passRead();
    const unreachable = {
      ...base,
      ballAfter: {
        position: { x: -8.8, y: 2.4, z: 4.4 },
        velocity: { x: 0, y: -10, z: 0 },
        inFlight: true,
      },
    } satisfies OwnContactReadSource;

    expect(offense.prepareSet(contact(offense, unreachable), 2)).toEqual({
      status: 'unplayable',
    });
    expect(home.draws).toBe(0);
  });

  it('bind é atômico/idempotente e captura identidade completa do plano', () => {
    const { strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense));
    const identity = { planId: 41, tacticalRevision: 3, athleteId: draft.setterAthleteId };
    const first = offense.bindSet(draft.ref, identity);
    const second = offense.bindSet(draft.ref, identity);

    expect(first.status).toBe('bound');
    expect(second).toBe(first);
    if (first.status !== 'bound') throw new Error('unreachable');
    expect(first.commitment).toMatchObject({
      planId: 41,
      tacticalRevision: 3,
      athleteId: draft.setterAthleteId,
      observationTick: 0,
    });
    expect(Object.isFrozen(first.commitment)).toBe(true);
    expect(offense.bindSet({ ...draft.ref }, identity)).toEqual({ status: 'stale' });
    expect(offense.bindSet(draft.ref, { ...identity, tacticalRevision: 4 })).toEqual({
      status: 'conflict',
    });
  });

  it('consume exige a identidade exata, acontece uma vez e não usa RNG extra', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense));
    const identity = { planId: 42, tacticalRevision: 2, athleteId: draft.setterAthleteId };
    const bound = offense.bindSet(draft.ref, identity);
    if (bound.status !== 'bound') throw new Error('unreachable');

    const consumed = offense.consumeSet(bound.commitment, identity);
    expect(consumed).toMatchObject({ status: 'consumed', execution: draft.execution });
    expect(offense.consumeSet(bound.commitment, identity)).toEqual({ status: 'stale' });
    expect(home.draws).toBe(2);
  });

  it('guard de consumo divergente revoga a decisão sem novo draw', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense));
    const identity = { planId: 43, tacticalRevision: 2, athleteId: draft.setterAthleteId };
    const bound = offense.bindSet(draft.ref, identity);
    if (bound.status !== 'bound' || draft.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }

    expect(offense.consumeSet(bound.commitment, { ...identity, planId: 99 })).toEqual({
      status: 'conflict',
    });
    expect(strategy.outcomeState(draft.execution.decisionId)).toBe('revoked');
    expect(home.draws).toBe(2);
  });

  it('nova posse revoga draft pending e invalida refs anteriores', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const observed = offense.observeContact(rally, passRead(), 1);
    if (observed.status !== 'observed') throw new Error('unreachable');
    const draft = prepared(offense, observed.contact);
    if (draft.execution.mode !== 'strategic') throw new Error('unreachable');

    offense.observeContact(rally, passRead(7, TeamSide.AWAY), 1);

    expect(strategy.outcomeState(draft.execution.decisionId)).toBe('revoked');
    expect(
      offense.bindSet(draft.ref, {
        planId: 44,
        tacticalRevision: 0,
        athleteId: draft.setterAthleteId,
      }),
    ).toEqual({ status: 'stale' });
    expect(home.draws).toBe(2);
  });

  it('nova posse sem ataque fecha set consumido como ineficaz', () => {
    const { strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const observed = offense.observeContact(rally, passRead(), 1);
    if (observed.status !== 'observed') throw new Error('unreachable');
    const draft = prepared(offense, observed.contact);
    if (draft.execution.mode !== 'strategic') throw new Error('unreachable');
    const identity = { planId: 45, tacticalRevision: 0, athleteId: draft.setterAthleteId };
    const bound = offense.bindSet(draft.ref, identity);
    if (bound.status !== 'bound') throw new Error('unreachable');
    expect(offense.consumeSet(bound.commitment, identity).status).toBe('consumed');

    offense.observeContact(rally, passRead(7, TeamSide.AWAY), 1);

    expect(strategy.outcomeState(draft.execution.decisionId)).toBe('resolved');
    expect(strategy.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(0);
  });

  it('reset externo de match torna tokens stale sem ABA nem draws', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const old = contact(offense);
    strategy.startMatch();
    offense.resetForMatch(strategy.matchEpoch);

    expect(offense.prepareSet(old, 99 as never)).toEqual({
      status: 'stale',
    });
    const current = contact(offense);
    expect(current.matchEpoch).toBe(old.matchEpoch + 1);
    expect(current.rallyEpoch).toBeGreaterThan(old.rallyEpoch);
    expect(home.draws).toBe(0);
  });

  it('resetForMatch nunca avança o epoch do core compartilhado', () => {
    const { strategy, offense } = setup();
    const epoch = strategy.matchEpoch;
    offense.resetForMatch(epoch);
    expect(strategy.matchEpoch).toBe(epoch);
  });

  it('commit AWAY aceito usa somente o stream AWAY', () => {
    const { home, away, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const draft = prepared(offense, contact(offense, passRead(6, TeamSide.AWAY)));

    expect(draft.execution.mode).toBe('strategic');
    expect(home.draws).toBe(0);
    expect(away.draws).toBe(2);
  });

  it('espelha fallback e usa somente o stream AWAY', () => {
    const { home, away, strategy, offense } = setup();
    strategy.captureFrame({ ...observation(10), possessionSide: TeamSide.AWAY });
    const draft = prepared(offense, contact(offense, passRead(10, TeamSide.AWAY)));

    expect(draft.execution.mode).toBe('fallback-high');
    if (draft.execution.mode !== 'fallback-high') throw new Error('unreachable');
    expect(draft.execution.target.x).toBeGreaterThan(0);
    expect(home.draws).toBe(0);
    expect(away.draws).toBe(0);
  });

  it('não importa Three.js, DOM, Match ou mechanics', () => {
    const implementation = readFileSync(
      fileURLToPath(new URL('./StrategicOffenseSystem.ts', import.meta.url)),
      'utf8',
    );
    expect(implementation).not.toMatch(/from ['"]three['"]/);
    expect(implementation).not.toMatch(/\b(document|window|Match|MechanicsCtx)\b/);
  });
});

describe('StrategicOffenseSystem attack lifecycle', () => {
  it('cria quick atomicamente no set, anexa o voo executado e não relê defesa', () => {
    const { home, away, strategy, offense } = setupWithChoices(
      'set.quick-center',
      'attack.placed-seam',
    );
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, quickPassRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared' || set.draft.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }

    expect(set.draft.execution.family).toBe('quick');
    expect(set.draft.plannedAttack).toMatchObject({
      basis: 'chained-quick',
      decisionContact: pass.contact,
      executedSetContact: null,
      originSetDecisionId: set.draft.execution.decisionId,
      originSetPlanId: null,
      leadTicks: null,
      execution: { mode: 'strategic' },
    });
    expect(home.draws).toBe(4);
    expect(away.draws).toBe(0);
    if (!set.draft.plannedAttack || set.draft.plannedAttack.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }
    expect(set.draft.plannedAttack.execution.observationTick).toBe(
      set.draft.execution.observationTick,
    );

    const setPlan = { planId: 70, tacticalRevision: 2, athleteId: set.draft.setterAthleteId };
    const setBound = offense.bindSet(set.draft.ref, setPlan);
    if (setBound.status !== 'bound') throw new Error('unreachable');
    expect(setBound.commitment.draft.plannedAttack?.originSetPlanId).toBe(setPlan.planId);
    expect(offense.consumeSet(setBound.commitment, setPlan).status).toBe('consumed');
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId, set.draft.execution.target),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 99 as never);

    expect(attack.status).toBe('prepared');
    if (attack.status !== 'prepared') throw new Error('unreachable');
    expect(attack.draft).toMatchObject({
      basis: 'chained-quick',
      executedSetContact: setContact.contact,
      originSetPlanId: setPlan.planId,
      leadTicks: null,
      execution: { decisionId: set.draft.plannedAttack.execution.decisionId },
    });
    expect(attack.draft.deliveryEffectiveness).toBeGreaterThan(0.9);
    expect(home.draws).toBe(4);
  });

  it('conflito no bind do set quick revoga parent e child sem draw extra', () => {
    const { home, strategy, offense } = setupWithChoices('set.quick-center', 'attack.placed-seam');
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, quickPassRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (
      set.status !== 'prepared' ||
      set.draft.execution.mode !== 'strategic' ||
      set.draft.plannedAttack?.execution.mode !== 'strategic'
    ) {
      throw new Error('unreachable');
    }
    const plan = { planId: 76, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
    expect(offense.bindSet(set.draft.ref, plan).status).toBe('bound');

    expect(offense.bindSet(set.draft.ref, { ...plan, tacticalRevision: 1 })).toEqual({
      status: 'conflict',
    });
    expect(strategy.outcomeState(set.draft.execution.decisionId)).toBe('revoked');
    expect(strategy.outcomeState(set.draft.plannedAttack.execution.decisionId)).toBe('revoked');
    expect(home.draws).toBe(4);
  });

  it('central airborne poda quick e mantém uma alternativa não-rápida legal', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(0));
    const source = quickPassRead();
    const noQuickAttacker = {
      ...source,
      ownAthletes: source.ownAthletes.map((athlete) =>
        athlete.id === 4 ? { ...athlete, airborne: true } : athlete,
      ),
    } satisfies OwnContactReadSource;
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, noQuickAttacker, 1);
    if (pass.status !== 'observed') throw new Error('unreachable');

    const result = offense.prepareSet(pass.contact, 2);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') throw new Error('unreachable');
    expect(result.draft.execution.mode).toBe('strategic');
    if (result.draft.execution.mode !== 'strategic') throw new Error('unreachable');
    expect(result.draft.execution.family).not.toBe('quick');
    expect(home.draws).toBe(2);
  });

  it('cria ataque high somente do set executado, com +2 e lead >=19', () => {
    const { home, strategy, offense } = setupWithChoices('set.high-left', 'attack.power-line-deep');
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, passRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared' || set.draft.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }
    expect(set.draft.plannedAttack).toBeNull();
    const setPlan = { planId: 71, tacticalRevision: 1, athleteId: set.draft.setterAthleteId };
    const setBound = offense.bindSet(set.draft.ref, setPlan);
    if (setBound.status !== 'bound') throw new Error('unreachable');
    offense.consumeSet(setBound.commitment, setPlan);
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 2);

    expect(attack.status).toBe('prepared');
    if (attack.status !== 'prepared') throw new Error('unreachable');
    expect(attack.draft).toMatchObject({
      basis: 'executed-set',
      decisionContact: setContact.contact,
      originSetDecisionId: set.draft.execution.decisionId,
      originSetPlanId: setPlan.planId,
      execution: { mode: 'strategic', family: 'power' },
    });
    expect(attack.draft.leadTicks).toBeGreaterThanOrEqual(19);
    expect(home.draws).toBe(4);
  });

  it('lead 18.9 usa placed-seam sem ticket adicional', () => {
    const { home, strategy, offense } = setupWithChoices('set.high-left', 'attack.power-line-deep');
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, passRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared') throw new Error('unreachable');
    const setPlan = { planId: 72, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
    const bound = offense.bindSet(set.draft.ref, setPlan);
    if (bound.status !== 'bound') throw new Error('unreachable');
    offense.consumeSet(bound.commitment, setPlan);
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId, { x: -1.05, z: -3.15 }, 18.9),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 2);

    expect(attack.status).toBe('prepared');
    if (attack.status !== 'prepared') throw new Error('unreachable');
    expect(attack.draft.leadTicks).toBe(18);
    expect(attack.draft.execution).toMatchObject({
      mode: 'fallback-placed-seam',
      reason: 'insufficient-lead',
      optionId: 'attack.placed-seam',
    });
    expect(home.draws).toBe(2);
  });

  it.each([19, 20])('lead conservador de %i ticks aceita ataque estratégico', (leadTicks) => {
    const { home, strategy, offense } = setupWithChoices('set.high-left', 'attack.power-line-deep');
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, passRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared') throw new Error('unreachable');
    const plan = { planId: 77, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
    const bound = offense.bindSet(set.draft.ref, plan);
    if (bound.status !== 'bound') throw new Error('unreachable');
    offense.consumeSet(bound.commitment, plan);
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId, { x: -1.05, z: -3.15 }, leadTicks),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 2);

    expect(attack.status).toBe('prepared');
    if (attack.status !== 'prepared') throw new Error('unreachable');
    expect(attack.draft.leadTicks).toBe(leadTicks);
    expect(attack.draft.execution.mode).toBe('strategic');
    expect(home.draws).toBe(4);
  });

  it('set fallback produz ataque fallback e nenhum outcome estratégico', () => {
    const { home, strategy, offense } = setup();
    strategy.captureFrame(observation(10));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, passRead(10), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared') throw new Error('unreachable');
    expect(set.draft.execution.mode).toBe('fallback-high');
    const setPlan = { planId: 73, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
    const bound = offense.bindSet(set.draft.ref, setPlan);
    if (bound.status !== 'bound') throw new Error('unreachable');
    offense.consumeSet(bound.commitment, setPlan);
    const target = set.draft.execution.mode === 'fallback-high' ? set.draft.execution.target : null;
    if (!target) throw new Error('unreachable');
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId, target),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 2);

    expect(attack.status).toBe('prepared');
    if (attack.status !== 'prepared') throw new Error('unreachable');
    expect(attack.draft.execution).toMatchObject({
      mode: 'fallback-placed-seam',
      reason: 'fallback-set',
    });
    expect(home.draws).toBe(0);
    expect(strategy.snapshot().decisions).toEqual([]);
  });

  it('bind/consume do ataque são exatos e resolvem o set somente no consumo', () => {
    const { strategy, offense } = setupWithChoices('set.high-left', 'attack.placed-seam');
    strategy.captureFrame(observation(0));
    const rally = offense.beginRally();
    const pass = offense.observeContact(rally, passRead(), 1);
    if (pass.status !== 'observed') throw new Error('unreachable');
    const set = offense.prepareSet(pass.contact, 2);
    if (set.status !== 'prepared' || set.draft.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }
    const setPlan = { planId: 74, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
    const setBound = offense.bindSet(set.draft.ref, setPlan);
    if (setBound.status !== 'bound') throw new Error('unreachable');
    offense.consumeSet(setBound.commitment, setPlan);
    const setContact = offense.observeContact(
      rally,
      executedSetRead(60, set.draft.setterAthleteId),
      2,
    );
    if (setContact.status !== 'observed') throw new Error('unreachable');
    const attack = offense.prepareAttack(setContact.contact, 2);
    if (attack.status !== 'prepared' || attack.draft.execution.mode !== 'strategic') {
      throw new Error('unreachable');
    }
    const attackPlan = {
      planId: 75,
      tacticalRevision: 4,
      athleteId: attack.draft.attackerAthleteId,
    };
    const attackBound = offense.bindAttack(attack.draft, attackPlan);
    if (attackBound.status !== 'bound') throw new Error('unreachable');
    expect(strategy.outcomeState(set.draft.execution.decisionId)).toBe('pending');

    const consumed = offense.consumeAttack(attackBound.commitment, attackPlan);
    expect(consumed.status).toBe('consumed');
    expect(strategy.outcomeState(set.draft.execution.decisionId)).toBe('resolved');
    expect(strategy.outcomeState(attack.draft.execution.decisionId)).toBe('pending');
    expect(offense.consumeAttack(attackBound.commitment, attackPlan)).toEqual({ status: 'stale' });
  });

  it('block/defesa/ponto resolvem ataque uma vez e ignoram callbacks duplicados', () => {
    const run = (terminal: 'block' | 'defense' | 'point') => {
      const { strategy, offense } = setupWithChoices('set.high-left', 'attack.placed-seam');
      strategy.captureFrame(observation(0));
      const rally = offense.beginRally();
      const pass = offense.observeContact(rally, passRead(), 1);
      if (pass.status !== 'observed') throw new Error('unreachable');
      const set = offense.prepareSet(pass.contact, 2);
      if (set.status !== 'prepared') throw new Error('unreachable');
      const setPlan = { planId: 80, tacticalRevision: 0, athleteId: set.draft.setterAthleteId };
      const setBound = offense.bindSet(set.draft.ref, setPlan);
      if (setBound.status !== 'bound') throw new Error('unreachable');
      offense.consumeSet(setBound.commitment, setPlan);
      const setContact = offense.observeContact(
        rally,
        executedSetRead(60, set.draft.setterAthleteId),
        2,
      );
      if (setContact.status !== 'observed') throw new Error('unreachable');
      const attack = offense.prepareAttack(setContact.contact, 2);
      if (attack.status !== 'prepared' || attack.draft.execution.mode !== 'strategic') {
        throw new Error('unreachable');
      }
      const attackPlan = {
        planId: 81,
        tacticalRevision: 0,
        athleteId: attack.draft.attackerAthleteId,
      };
      const bound = offense.bindAttack(attack.draft, attackPlan);
      if (bound.status !== 'bound') throw new Error('unreachable');
      offense.consumeAttack(bound.commitment, attackPlan);
      const commitment: BoundAttackCommitment = bound.commitment;
      const first =
        terminal === 'block'
          ? offense.resolveAttackBlock(commitment)
          : terminal === 'defense'
            ? offense.resolveAttackDefense(commitment, 0.4)
            : offense.resolveOffensePoint(rally, TeamSide.HOME);
      return { strategy, offense, rally, attack, commitment, first };
    };

    const block = run('block');
    expect(block.first).toBe(true);
    expect(block.offense.resolveAttackBlock(block.commitment)).toBe(false);
    expect(block.strategy.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(0);

    const defense = run('defense');
    expect(defense.first).toBe(true);
    expect(defense.offense.resolveAttackDefense(defense.commitment, Number.NaN)).toBe(false);
    expect(defense.strategy.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(0.4);

    const point = run('point');
    expect(point.first).toBe(true);
    expect(point.offense.resolveOffensePoint(point.rally, 99 as never)).toBe(false);
    expect(point.strategy.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(1);
  });
});
