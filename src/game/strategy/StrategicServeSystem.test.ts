import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import { buildStrategyObservation } from './StrategyObservationAdapter';
import {
  StrategicServeSystem,
  type ServeEpochToken,
  type StrategicServeDirective,
  type StrategicServeRealization,
} from './StrategicServeSystem';

function observation(tick: number) {
  return buildStrategyObservation({
    tick,
    score: [0, 0],
    phase: 'serve-prep',
    possessionSide: null,
    servingSide: TeamSide.HOME,
    possessionTouches: 0,
    ball: {
      position: { x: -8, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      inFlight: false,
      lastVisibleContactTick: null,
    },
    athletes: [TeamSide.HOME, TeamSide.AWAY].flatMap((side) => {
      const sign = side === TeamSide.HOME ? 1 : -1;
      return Array.from({ length: 6 }, (_, id) => ({
        side,
        id,
        slot: id,
        position: { x: sign * (id <= 2 ? -6 : -2), z: sign * ((id % 3) - 1) * 3 },
        velocity: { x: 0, z: 0 },
        airborne: false,
      }));
    }),
  });
}

function setup(homeValues = [1, 2, 3, 4, 5, 6], awayValues = [11, 12, 13, 14]) {
  const home = new SequenceRandom(homeValues);
  const away = new SequenceRandom(awayValues);
  const strategy = new OpponentStrategySystem({ streams: { home, away } });
  const serves = new StrategicServeSystem(strategy);
  return { home, away, strategy, serves };
}

function commit(
  serves: StrategicServeSystem,
  token: ServeEpochToken,
  decisionTick = 6,
): StrategicServeDirective {
  const result = serves.commit(token, 2, decisionTick);
  if (result.status !== 'committed')
    throw new Error(`esperava committed, recebeu ${result.status}`);
  return result.directive;
}

function realization() {
  return { target: { x: 7.2, z: -1.4 }, power: 0.82, clearance: 0.45 };
}

describe('StrategicServeSystem lifecycle', () => {
  it('checkpoint de fronteira restaura serveEpoch sem carregar saque resolvido', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const finishServe = (serverAthleteId: number) => {
      const directive = commit(serves, serves.beginServe(TeamSide.HOME, serverAthleteId));
      const launched = serves.markLaunched(directive.ref, realization());
      if (launched.status !== 'launched') throw new Error('saque deveria lançar');
      expect(
        serves.resolvePoint(launched.serve.outcomeToken, {
          servingSide: TeamSide.HOME,
          winner: TeamSide.HOME,
          ace: true,
        }),
      ).toBe(true);
      return directive.ref.serveEpoch;
    };

    expect(finishServe(0)).toBe(1);
    const checkpoint = serves.checkpointBoundary();
    expect(finishServe(1)).toBe(2);

    serves.restoreBoundary(checkpoint);

    expect(serves.beginServe(TeamSide.AWAY, 2).serveEpoch).toBe(2);
    expect(Object.isFrozen(checkpoint)).toBe(true);
  });

  it('gate stale acontece antes de percepção e RNG', () => {
    const { home, strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const stale = serves.beginServe(TeamSide.HOME, 0);
    const current = serves.beginServe(TeamSide.HOME, 1);

    expect(serves.commit(stale, 2, 6)).toEqual({ status: 'stale' });
    expect(home.draws).toBe(0);
    expect(serves.commit({ ...current, matchEpoch: 99 }, 2, 6)).toEqual({ status: 'stale' });
    expect(home.draws).toBe(0);
  });

  it('not-ready e begin humano consomem zero draw estratégico', () => {
    const { home, strategy, serves } = setup();
    const humanToken = serves.beginServe(TeamSide.HOME, 0);
    expect(home.draws).toBe(0);
    strategy.captureFrame(observation(10));

    expect(serves.commit(humanToken, 2, 10)).toEqual({ status: 'not-ready' });
    expect(home.draws).toBe(0);
  });

  it('commit consome dois draws do lado, congela diretiva e é idempotente', () => {
    const { home, away, strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const token = serves.beginServe(TeamSide.HOME, 0);
    const first = serves.commit(token, 2, 6);
    const second = serves.commit(token, 2, 99);

    expect(first.status).toBe('committed');
    expect(second).toEqual(first);
    expect(home.draws).toBe(2);
    expect(away.draws).toBe(0);
    if (first.status !== 'committed') throw new Error('unreachable');
    expect(['float-short', 'float-deep', 'power-deep']).toContain(first.directive.family);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.directive)).toBe(true);
    expect(Object.isFrozen(first.directive.ref)).toBe(true);
    expect(Object.isFrozen(first.directive.target)).toBe(true);
  });

  it('begin novo revoga pending anterior e invalida toss/hit stale', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const firstToken = serves.beginServe(TeamSide.HOME, 0);
    const first = commit(serves, firstToken);
    expect(serves.isActive(first.ref, 'committed')).toBe(true);

    const next = serves.beginServe(TeamSide.HOME, 1);
    expect(strategy.outcomeState(first.ref.decisionId)).toBe('revoked');
    expect(strategy.memory(TeamSide.HOME).outcomes).toEqual([]);
    expect(serves.markLaunched(first.ref, null as unknown as StrategicServeRealization)).toEqual({
      status: 'stale',
    });
    expect(serves.commit(firstToken, 2, 6)).toEqual({ status: 'stale' });
    expect(next.serveEpoch).toBe(firstToken.serveEpoch + 1);
  });

  it('serveEpoch não reseta em startMatch e refs anteriores ficam stale', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const token = serves.beginServe(TeamSide.HOME, 0);
    const directive = commit(serves, token);

    serves.startMatch();
    expect(serves.markLaunched(directive.ref, realization())).toEqual({ status: 'stale' });
    const next = serves.beginServe(TeamSide.AWAY, 0);
    expect(next.matchEpoch).toBe(token.matchEpoch + 1);
    expect(next.serveEpoch).toBe(token.serveEpoch + 1);
  });

  it('markLaunched é idempotente e guards são estritos por estágio', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const directive = commit(serves, serves.beginServe(TeamSide.HOME, 0));
    const physical = realization();
    const first = serves.markLaunched(directive.ref, physical);
    physical.target.x = 99;
    physical.power = 0.1;
    const second = serves.markLaunched(directive.ref, realization());

    expect(first.status).toBe('launched');
    expect(second).toBe(first);
    expect(serves.markLaunched(directive.ref, { ...realization(), power: 0.5 })).toEqual({
      status: 'conflict',
    });
    expect(serves.markLaunched(directive.ref, realization())).toBe(first);
    expect(serves.isActive(directive.ref, 'committed')).toBe(false);
    expect(serves.isActive(directive.ref, 'in-flight')).toBe(true);
    if (first.status !== 'launched') throw new Error('unreachable');
    expect(Object.isFrozen(first.serve)).toBe(true);
    expect(Object.isFrozen(first.serve.target)).toBe(true);
    expect(first.serve.outcomeToken).toEqual({
      matchEpoch: directive.ref.matchEpoch,
      serveEpoch: directive.ref.serveEpoch,
    });
    expect(Object.keys(first.serve.outcomeToken)).toEqual(['matchEpoch', 'serveEpoch']);
    expect(Object.isFrozen(first.serve.outcomeToken)).toBe(true);
    expect(first.serve.target).toEqual(realization().target);
    expect(first.serve.power).toBe(realization().power);
    expect(first.serve.clearance).toBe(realization().clearance);
  });

  it.each([
    [{ ...realization(), target: { x: Number.NaN, z: 0 } }, /finito/i],
    [{ ...realization(), power: -0.01 }, /power/i],
    [{ ...realization(), power: 1.01 }, /power/i],
    [{ ...realization(), clearance: Number.NaN }, /clearance|finito/i],
  ])('rejeita realização física inválida sem fechar o estágio', (invalid, error) => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const directive = commit(serves, serves.beginServe(TeamSide.HOME, 0));

    expect(() => serves.markLaunched(directive.ref, invalid)).toThrow(error);
    expect(serves.isActive(directive.ref, 'committed')).toBe(true);
    expect(serves.markLaunched(directive.ref, realization()).status).toBe('launched');
  });

  it('generic invalid revoga o pending colidido, fecha outbox e não tenta novo commit', () => {
    const home = new SequenceRandom([1, 2, 3, 4, 5, 6]);
    const away = new SequenceRandom([11, 12, 13, 14]);
    const strategy = new OpponentStrategySystem({
      streams: { home, away },
      sink: () => undefined,
    });
    const serves = new StrategicServeSystem(strategy);
    strategy.captureFrame(observation(0));
    const token = serves.beginServe(TeamSide.HOME, 0);
    const ownership = `serve:${token.matchEpoch}:${token.serveEpoch}:${token.side}:${token.serverAthleteId}`;
    const existing = strategy.commitDecision({
      matchEpoch: token.matchEpoch,
      side: token.side,
      kind: 'serve',
      difficulty: 2,
      decisionTick: 6,
      ownership,
    });
    if (existing.status !== 'committed') throw new Error('unreachable');

    expect(serves.commit(token, 2, 6)).toEqual({ status: 'invalid' });
    expect(strategy.outcomeState(existing.decision.decisionId)).toBe('revoked');
    expect(strategy.snapshot().outbox.at(-1)).toMatchObject({
      type: 'outcome-terminal',
      outcome: { decisionId: existing.decision.decisionId, status: 'revoked' },
    });
    expect(serves.commit(token, 2, 6)).toEqual({ status: 'stale' });
    expect(home.draws).toBe(2);
  });

  it('generic invalid não relança quando o outcome colidido já é terminal', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const token = serves.beginServe(TeamSide.HOME, 0);
    const existing = strategy.commitDecision({
      matchEpoch: token.matchEpoch,
      side: token.side,
      kind: 'serve',
      difficulty: 2,
      decisionTick: 6,
      ownership: `serve:${token.matchEpoch}:${token.serveEpoch}:${token.side}:${token.serverAthleteId}`,
    });
    if (existing.status !== 'committed') throw new Error('unreachable');
    strategy.revokeDecision(existing.decision.decisionId);

    expect(() => serves.commit(token, 2, 6)).not.toThrow();
    expect(serves.commit(token, 2, 6)).toEqual({ status: 'stale' });
    expect(strategy.outcomeState(existing.decision.decisionId)).toBe('revoked');
  });

  it.each(['committed', 'in-flight'] as const)('revoke exato é idempotente em %s', (stage) => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const directive = commit(serves, serves.beginServe(TeamSide.HOME, 0));
    if (stage === 'in-flight') serves.markLaunched(directive.ref, realization());

    expect(serves.revoke(directive.ref)).toBe(true);
    expect(serves.revoke(directive.ref)).toBe(false);
    expect(strategy.outcomeState(directive.ref.decisionId)).toBe('revoked');
    expect(strategy.memory(TeamSide.HOME).outcomes).toEqual([]);
    expect(serves.markLaunched(directive.ref, realization())).toEqual({ status: 'stale' });
  });

  it('HOME e AWAY usam streams independentes', () => {
    const { home, away, strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const homeDirective = commit(serves, serves.beginServe(TeamSide.HOME, 0));
    const homeLaunch = serves.markLaunched(homeDirective.ref, realization());
    if (homeLaunch.status !== 'launched') throw new Error('unreachable');
    serves.resolveReception(homeLaunch.serve.outcomeToken, TeamSide.AWAY, 0.5);

    const awayDirective = commit(serves, serves.beginServe(TeamSide.AWAY, 0));
    expect(home.draws).toBe(2);
    expect(away.draws).toBe(2);
    expect(homeDirective.ref.side).toBe(TeamSide.HOME);
    expect(awayDirective.ref.side).toBe(TeamSide.AWAY);
  });
});

describe('StrategicServeSystem outcomes', () => {
  it('primeira recepção resolve uma vez com effectiveness já calculada', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const directive = commit(serves, serves.beginServe(TeamSide.HOME, 0));
    const launch = serves.markLaunched(directive.ref, realization());
    if (launch.status !== 'launched') throw new Error('unreachable');

    expect(serves.resolveReception(launch.serve.outcomeToken, TeamSide.HOME, 0.35)).toBe(false);
    expect(strategy.memory(TeamSide.HOME).outcomes).toEqual([]);
    expect(serves.resolveReception(launch.serve.outcomeToken, TeamSide.AWAY, 0.35)).toBe(true);
    expect(serves.resolveReception(launch.serve.outcomeToken, TeamSide.AWAY, 0.9)).toBe(false);
    expect(strategy.outcomeState(directive.ref.decisionId)).toBe('resolved');
    expect(strategy.memory(TeamSide.HOME).outcomes).toEqual([
      {
        kind: 'serve',
        optionId: directive.ref.optionId,
        effectiveness: 0.35,
      },
    ]);
  });

  it.each([
    ['ace', TeamSide.HOME, true, 1],
    ['erro', TeamSide.AWAY, false, 0],
  ] as const)(
    'ponto por %s aprende uma única vez antes da troca de saque',
    (_case, winner, ace, expected) => {
      const { strategy, serves } = setup();
      strategy.captureFrame(observation(0));
      const directive = commit(serves, serves.beginServe(TeamSide.HOME, 0));
      const launch = serves.markLaunched(directive.ref, realization());
      if (launch.status !== 'launched') throw new Error('unreachable');

      expect(
        serves.resolvePoint(launch.serve.outcomeToken, {
          servingSide: TeamSide.HOME,
          winner,
          ace,
        }),
      ).toBe(true);
      expect(
        serves.resolvePoint(launch.serve.outcomeToken, {
          servingSide: TeamSide.HOME,
          winner,
          ace,
        }),
      ).toBe(false);
      expect(strategy.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(expected);
    },
  );

  it('token de outcome impede evento atrasado do saque N de resolver N+1', () => {
    const { strategy, serves } = setup();
    strategy.captureFrame(observation(0));
    const firstDirective = commit(serves, serves.beginServe(TeamSide.HOME, 0));
    const firstLaunch = serves.markLaunched(firstDirective.ref, realization());
    if (firstLaunch.status !== 'launched') throw new Error('unreachable');

    const secondDirective = commit(serves, serves.beginServe(TeamSide.HOME, 1));
    const secondLaunch = serves.markLaunched(secondDirective.ref, realization());
    if (secondLaunch.status !== 'launched') throw new Error('unreachable');

    expect(serves.resolveReception(firstLaunch.serve.outcomeToken, TeamSide.AWAY, 0.2)).toBe(false);
    expect(
      serves.resolvePoint(firstLaunch.serve.outcomeToken, {
        servingSide: TeamSide.HOME,
        winner: TeamSide.HOME,
        ace: true,
      }),
    ).toBe(false);
    expect(strategy.outcomeState(secondDirective.ref.decisionId)).toBe('pending');
    expect(serves.resolveReception(secondLaunch.serve.outcomeToken, TeamSide.AWAY, 0.8)).toBe(true);
    expect(strategy.outcomeState(secondDirective.ref.decisionId)).toBe('resolved');
  });
});
