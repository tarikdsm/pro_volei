import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTACT, GRAVITY, TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import type { OwnContactReadSource } from './OwnContactRead';
import {
  StrategicOffenseSystem,
  type OffenseContactRef,
  type SetDecisionDraft,
} from './StrategicOffenseSystem';
import type { StrategyObservation } from './StrategyTypes';

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
      reason: 'perception-not-ready',
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

  it('nova posse não desfaz set já consumido antes do lifecycle de ataque', () => {
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

    expect(strategy.outcomeState(draft.execution.decisionId)).toBe('pending');
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
