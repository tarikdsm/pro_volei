import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CONTACT, GRAVITY, TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import type { StrategyOutboxEvent } from './OpponentStrategySystem';
import { OpponentStrategySystem } from './OpponentStrategySystem';
import { SERVE_RECEPTION_OUTCOME_TUNING } from './ServeReceptionOutcome';
import {
  MatchStrategyBridge,
  type MatchStrategyBallContact,
  type MatchStrategyPort,
  type MatchStrategyTickSource,
} from './MatchStrategyBridge';
import { StrategicOffenseSystem } from './StrategicOffenseSystem';
import type {
  ServeEpochToken,
  StrategicServeDirective,
  StrategicServeRealization,
} from './StrategicServeSystem';
import {
  materializePackedStrategyObservation,
  type PackedStrategyObservation,
} from './StrategyObservationAdapter';

function materializedCapture(packed: PackedStrategyObservation | undefined) {
  if (!packed) throw new Error('captura compacta ausente');
  return materializePackedStrategyObservation(packed);
}

function streams() {
  return {
    home: SequenceRandom.fromFloats(Array.from({ length: 24 }, (_, index) => (index + 1) / 32)),
    away: SequenceRandom.fromFloats(Array.from({ length: 24 }, (_, index) => (index + 1) / 40)),
  };
}

function tickSource(tick = 0): MatchStrategyTickSource {
  return {
    tick,
    score: [0, 0],
    phase: 'serve-prep',
    possessionSide: null,
    servingSide: TeamSide.HOME,
    possessionTouches: 0,
    ball: {
      position: { x: -8.5, y: 1.15, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      inFlight: false,
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
  };
}

function committed(bridge: MatchStrategyBridge, token: ServeEpochToken): StrategicServeDirective {
  const result = bridge.commitServe(token, 2, 6);
  if (result.status !== 'committed') throw new Error(`esperava committed: ${result.status}`);
  return result.directive;
}

const realization: StrategicServeRealization = {
  target: { x: 7.2, z: 0.4 },
  power: 0.76,
  clearance: 0.4,
};

function launched(bridge: MatchStrategyBridge, directive: StrategicServeDirective) {
  const result = bridge.markServeLaunched(directive.ref, realization);
  if (result.status !== 'launched') throw new Error(`esperava launched: ${result.status}`);
  return result.serve;
}

function perfectContact(
  tick: number,
  outcomeToken: MatchStrategyBallContact['outcomeToken'],
  side = TeamSide.AWAY,
  matchEpoch = outcomeToken?.matchEpoch ?? 0,
): MatchStrategyBallContact {
  const time = SERVE_RECEPTION_OUTCOME_TUNING.timing.ideal;
  const position = { x: 6, y: 1, z: 0 };
  const setterPosition = { x: 2, z: 0 };
  return {
    matchEpoch,
    tick,
    outcomeToken,
    side,
    ballAfter: {
      position,
      velocity: {
        x: (setterPosition.x - position.x) / time,
        y: (CONTACT.set - position.y - 0.5 * GRAVITY * time * time) / time,
        z: 0,
      },
      inFlight: true,
    },
    setterPosition,
  };
}

function readyBridge(sink?: (event: StrategyOutboxEvent) => void) {
  const random = streams();
  const bridge = new MatchStrategyBridge(random, sink);
  bridge.captureTick(tickSource());
  return { bridge, random };
}

describe('MatchStrategyBridge perception and lifecycle', () => {
  it('sincroniza e delega o lifecycle ofensivo sem expor o sistema interno', () => {
    const reset = vi.spyOn(StrategicOffenseSystem.prototype, 'resetForMatch');
    const begin = vi.spyOn(StrategicOffenseSystem.prototype, 'beginRally');
    const end = vi.spyOn(StrategicOffenseSystem.prototype, 'endRally');
    try {
      const bridge: MatchStrategyPort = new MatchStrategyBridge(streams());
      bridge.startMatch();

      expect(reset).toHaveBeenCalledWith(1);
      const rally = bridge.beginOffenseRally();
      bridge.endOffenseRally(rally);

      expect(begin).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith(rally);
      expect(Object.keys(bridge)).not.toContain('offense');
    } finally {
      reset.mockRestore();
      begin.mockRestore();
      end.mockRestore();
    }
  });

  it('encaminha captura whitelisted pela fast path compacta do system', () => {
    const packed = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    const canonical = vi.spyOn(OpponentStrategySystem.prototype, 'captureCanonicalFrame');
    const external = vi.spyOn(OpponentStrategySystem.prototype, 'captureFrame');
    try {
      const bridge = new MatchStrategyBridge(streams());
      bridge.captureTick(tickSource());

      expect(packed).toHaveBeenCalledTimes(1);
      expect(canonical).not.toHaveBeenCalled();
      expect(external).not.toHaveBeenCalled();
    } finally {
      packed.mockRestore();
      canonical.mockRestore();
      external.mockRestore();
    }
  });

  it('expõe somente o contrato estrutural e o epoch atual da partida', () => {
    const bridge: MatchStrategyPort = new MatchStrategyBridge(streams());

    expect(bridge.matchEpoch).toBe(0);
    bridge.startMatch();
    expect(bridge.matchEpoch).toBe(1);
  });

  it('injeta contato visível somente nos frames seguintes', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const { bridge } = readyBridge();
      expect(
        materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick,
      ).toBeNull();

      bridge.captureTick(tickSource(1));
      expect(bridge.onBallContact(perfectContact(1, null))).toBe(false);
      bridge.captureTick(tickSource(2));

      expect(capture.mock.calls.at(-1)?.[0].tick).toBe(2);
      expect(materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick).toBe(
        1,
      );
    } finally {
      capture.mockRestore();
    }
  });

  it('callback da partida anterior após reset é stale antes de tick e payload', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const bridge = new MatchStrategyBridge(streams());
      bridge.captureTick(tickSource(0));
      bridge.startMatch();

      expect(
        bridge.onBallContact({
          matchEpoch: 0,
          tick: 999,
          outcomeToken: null,
          side: 99 as never,
          ballAfter: null as never,
          setterPosition: null as never,
        }),
      ).toBe(false);
      expect(() => bridge.captureTick(tickSource(0))).not.toThrow();
      expect(
        materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick,
      ).toBeNull();
    } finally {
      capture.mockRestore();
    }
  });

  it('tick futuro current é rejeitado sem envenenar a captura seguinte', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const { bridge } = readyBridge();
      expect(
        bridge.onBallContact({
          matchEpoch: 0,
          tick: 10,
          outcomeToken: null,
          side: 99 as never,
          ballAfter: null as never,
          setterPosition: null as never,
        }),
      ).toBe(false);
      expect(() => bridge.captureTick(tickSource(1))).not.toThrow();
      expect(
        materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick,
      ).toBeNull();
    } finally {
      capture.mockRestore();
    }
  });

  it('sem captura válida ainda, contato current não grava tick', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const bridge = new MatchStrategyBridge(streams());
      expect(() => bridge.captureTick({ ...tickSource(0), athletes: [] })).toThrow();
      expect(
        bridge.onBallContact({
          matchEpoch: 0,
          tick: 0,
          outcomeToken: null,
          side: 99 as never,
          ballAfter: null as never,
          setterPosition: null as never,
        }),
      ).toBe(false);
      expect(() => bridge.captureTick(tickSource(0))).not.toThrow();
      expect(
        materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick,
      ).toBeNull();
    } finally {
      capture.mockRestore();
    }
  });

  it('begin/commit preserva budget por lado e devolve DTOs congelados', () => {
    const { bridge, random } = readyBridge();
    const token = bridge.beginServe(TeamSide.HOME, 0);
    const result = bridge.commitServe(token, 2, 6);

    expect(result.status).toBe('committed');
    expect(random.home.draws).toBe(2);
    expect(random.away.draws).toBe(0);
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'committed') throw new Error('unreachable');
    expect(Object.isFrozen(result.directive)).toBe(true);
    expect(Object.isFrozen(result.directive.ref)).toBe(true);
  });

  it('guard runtime exige serve-prep e revoga somente a ref exata', () => {
    const { bridge } = readyBridge();
    const first = committed(bridge, bridge.beginServe(TeamSide.HOME, 0));
    expect(
      bridge.guardServe(first.ref, 'toss', {
        phase: 'serve-prep',
        servingSide: TeamSide.HOME,
        serverAthleteId: 0,
      }),
    ).toBe(true);
    expect(
      bridge.guardServe(first.ref, 'hit', {
        phase: 'rally',
        servingSide: TeamSide.HOME,
        serverAthleteId: 0,
      }),
    ).toBe(false);
    expect(bridge.markServeLaunched(first.ref, realization)).toEqual({ status: 'stale' });

    const second = committed(bridge, bridge.beginServe(TeamSide.HOME, 1));
    expect(
      bridge.guardServe(first.ref, 'hit', {
        phase: 'point',
        servingSide: TeamSide.AWAY,
        serverAthleteId: 99,
      }),
    ).toBe(false);
    expect(bridge.markServeLaunched(second.ref, realization).status).toBe('launched');
  });

  it('stale é decidido antes de difficulty, realization e fatos envenenados', () => {
    const { bridge } = readyBridge();
    const stale = bridge.beginServe(TeamSide.HOME, 0);
    bridge.beginServe(TeamSide.HOME, 1);

    expect(bridge.commitServe(stale, 99 as never, -1)).toEqual({ status: 'stale' });
    expect(
      bridge.markServeLaunched(stale as never, null as unknown as StrategicServeRealization),
    ).toEqual({ status: 'stale' });
    expect(bridge.guardServe(stale as never, 'hit', null as never)).toBe(false);
  });

  it('startSet preserva memória; startMatch reseta memória/visibilidade sem resetar serveEpoch', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const { bridge } = readyBridge();
      const firstToken = bridge.beginServe(TeamSide.HOME, 0);
      const serve = launched(bridge, committed(bridge, firstToken));
      bridge.onPoint({
        outcomeToken: serve.outcomeToken,
        servingSide: TeamSide.HOME,
        winner: TeamSide.HOME,
        ace: true,
      });
      bridge.captureTick(tickSource(9));
      bridge.onBallContact(perfectContact(9, null));
      const learned = bridge.memory(TeamSide.HOME);

      bridge.startSet();
      expect(bridge.memory(TeamSide.HOME)).toBe(learned);
      bridge.startMatch();
      expect(bridge.memory(TeamSide.HOME)).toEqual({
        revision: 0,
        outcomes: [],
        recentChoices: [],
      });
      bridge.captureTick(tickSource(0));
      expect(
        materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick,
      ).toBeNull();
      const next = bridge.beginServe(TeamSide.HOME, 0);
      expect(next.matchEpoch).toBe(firstToken.matchEpoch + 1);
      expect(next.serveEpoch).toBe(firstToken.serveEpoch + 1);
    } finally {
      capture.mockRestore();
    }
  });

  it('não expõe sistemas internos nem snapshot', () => {
    const { bridge } = readyBridge();
    expect(Object.keys(bridge)).not.toContain('strategy');
    expect(Object.keys(bridge)).not.toContain('serves');
    expect('snapshot' in bridge).toBe(false);
  });
});

describe('MatchStrategyBridge outcomes', () => {
  it('mark + primeira recepção rival aprende física uma única vez', () => {
    const { bridge } = readyBridge();
    const directive = committed(bridge, bridge.beginServe(TeamSide.HOME, 0));
    const serve = launched(bridge, directive);

    bridge.captureTick(tickSource(1));
    expect(
      bridge.onBallContact({
        ...perfectContact(1, serve.outcomeToken, TeamSide.HOME),
        ballAfter: null as never,
        setterPosition: null as never,
      }),
    ).toBe(false);
    bridge.captureTick(tickSource(2));
    expect(bridge.onBallContact(perfectContact(2, serve.outcomeToken))).toBe(true);
    bridge.captureTick(tickSource(3));
    expect(
      bridge.onBallContact({
        ...perfectContact(3, serve.outcomeToken),
        ballAfter: null as never,
        setterPosition: null as never,
      }),
    ).toBe(false);
    expect(bridge.memory(TeamSide.HOME).outcomes).toHaveLength(1);
    expect(bridge.memory(TeamSide.HOME).outcomes[0].effectiveness).toBeCloseTo(0, 10);
  });

  it('token N não resolve N+1 e payload stale não é lido', () => {
    const { bridge } = readyBridge();
    const first = launched(bridge, committed(bridge, bridge.beginServe(TeamSide.HOME, 0)));
    const second = launched(bridge, committed(bridge, bridge.beginServe(TeamSide.HOME, 1)));

    expect(
      bridge.onBallContact({
        ...perfectContact(999, first.outcomeToken),
        side: 99 as never,
        ballAfter: null as never,
        setterPosition: null as never,
      }),
    ).toBe(false);
    expect(bridge.memory(TeamSide.HOME).outcomes).toEqual([]);
    expect(() => bridge.captureTick(tickSource(1))).not.toThrow();
    expect(bridge.onBallContact(perfectContact(1, second.outcomeToken))).toBe(true);
    expect(bridge.memory(TeamSide.HOME).outcomes).toHaveLength(1);
  });

  it.each([
    ['ace', TeamSide.HOME, true, 1],
    ['erro', TeamSide.AWAY, false, 0],
  ] as const)('ponto por %s resolve uma vez', (_case, winner, ace, effectiveness) => {
    const { bridge } = readyBridge();
    const serve = launched(bridge, committed(bridge, bridge.beginServe(TeamSide.HOME, 0)));
    const point = {
      outcomeToken: serve.outcomeToken,
      servingSide: TeamSide.HOME,
      winner,
      ace,
    };

    expect(bridge.onPoint(point)).toBe(true);
    expect(bridge.onPoint({ ...point, servingSide: 99 as never })).toBe(false);
    expect(bridge.memory(TeamSide.HOME).outcomes.at(-1)?.effectiveness).toBe(effectiveness);
  });

  it('contato sem token apenas atualiza tick e ignora payload físico', () => {
    const capture = vi.spyOn(OpponentStrategySystem.prototype, 'capturePackedFrame');
    try {
      const { bridge } = readyBridge();
      bridge.captureTick(tickSource(4));
      expect(
        bridge.onBallContact({
          matchEpoch: 0,
          tick: 4,
          outcomeToken: null,
          side: 99 as never,
          ballAfter: null as never,
          setterPosition: null as never,
        }),
      ).toBe(false);
      bridge.captureTick(tickSource(5));
      expect(materializedCapture(capture.mock.calls.at(-1)?.[0]).ball.lastVisibleContactTick).toBe(
        4,
      );
      expect(bridge.memory(TeamSide.HOME).outcomes).toEqual([]);
    } finally {
      capture.mockRestore();
    }
  });
});

describe('MatchStrategyBridge isolation', () => {
  it('isola sink falho e flush posterior permanece inerte', () => {
    const delivered: StrategyOutboxEvent[] = [];
    const sink = (event: StrategyOutboxEvent): void => {
      delivered.push(event);
      throw new Error('sink offline');
    };
    const { bridge } = readyBridge(sink);
    const first = launched(bridge, committed(bridge, bridge.beginServe(TeamSide.HOME, 0)));
    bridge.onPoint({
      outcomeToken: first.outcomeToken,
      servingSide: TeamSide.HOME,
      winner: TeamSide.HOME,
      ace: true,
    });

    expect(() => bridge.flush()).not.toThrow();
    expect(delivered).toHaveLength(1);
    committed(bridge, bridge.beginServe(TeamSide.HOME, 1));
    expect(() => bridge.flush()).not.toThrow();
    expect(delivered).toHaveLength(1);
  });

  it('future poison não altera a diretiva observável', () => {
    const clean = readyBridge().bridge;
    const poisonedRandom = streams();
    const poisoned = new MatchStrategyBridge(poisonedRandom);
    const source = tickSource();
    poisoned.captureTick({
      ...source,
      aim: { x: 99, z: 99 },
      quality: 1,
      ball: { ...source.ball, target: { x: -99, z: 99 }, landing: { x: 99, z: 99 } },
      athletes: source.athletes.map((athlete) => ({
        ...athlete,
        target: { x: 99, z: 99 },
        q: 1,
      })),
    } as MatchStrategyTickSource);

    const cleanDirective = committed(clean, clean.beginServe(TeamSide.HOME, 0));
    const poisonedDirective = committed(poisoned, poisoned.beginServe(TeamSide.HOME, 0));
    expect(poisonedDirective).toEqual(cleanDirective);
    expect(poisonedRandom.home.draws).toBe(2);
  });

  it('fonte do bridge não cria snapshot nem lê future poison', () => {
    const source = readFileSync(new URL('./MatchStrategyBridge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bsnapshot\s*\(/);
    expect(source).not.toMatch(/\.(?:q|quality|target|landing)\b/);
  });
});
