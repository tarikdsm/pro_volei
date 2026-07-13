import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  blockCrossing,
  blockerReaches,
  blockProximity,
  isBlockable,
  prepareBlock,
  resolveBlock,
  BlockCrossing,
} from './block';
import { RallyState, type TouchPlan } from '../RallyState';
import { TeamSide, COURT, BLOCK } from '../../core/constants';
import type { MechanicsCtx } from './context';
import type { Athlete } from '../Team';
import type { ActionIntent } from '../control/ActionIntent';
import { RandomHub } from '../../core/random';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import type { BlockPlan } from '../team/TeamTactics';

function makeRandomStreams(contactFloats: readonly number[] = [0.5, 0.5, 0.5]) {
  const hub = new RandomHub(1);
  return {
    rules: hub.stream('rules'),
    ai: hub.stream('ai'),
    contact: SequenceRandom.fromFloats(contactFloats),
    control: hub.stream('control'),
  };
}

describe('blockCrossing', () => {
  it('resolve quando/onde a cortada cruza o plano da rede dentro da janela', () => {
    // pos.x=-2, vel.x=10 → t=0.2; y = 2.5 + 1*0.2 + 0.5*(-13)*0.2² = 2.44; z = 0.5
    const c = blockCrossing({ x: -2, y: 2.5, z: 0.5 }, { x: 10, y: 1, z: 0 });
    expect(c).not.toBeNull();
    expect(c!.t).toBeCloseTo(0.2);
    expect(c!.y).toBeCloseTo(2.44);
    expect(c!.z).toBeCloseTo(0.5);
  });

  it('null sem componente horizontal (bola não cruza)', () => {
    expect(blockCrossing({ x: -2, y: 2.5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });

  it('null quando o cruzamento já passou (t ≤ 0)', () => {
    expect(blockCrossing({ x: -2, y: 2.5, z: 0 }, { x: -5, y: 1, z: 0 })).toBeNull();
  });

  it('null quando o cruzamento é tarde demais (fora da janela de bloqueio)', () => {
    // vel.x=1 → t = |pos.x|; logo pos.x além de -BLOCK.window cai fora da janela
    const late = -(BLOCK.window + 0.1);
    expect(blockCrossing({ x: late, y: 2.5, z: 0 }, { x: 1, y: 1, z: 0 })).toBeNull();
  });

  it('resolve logo dentro da janela de bloqueio', () => {
    const inWindow = -(BLOCK.window - 0.1);
    expect(blockCrossing({ x: inWindow, y: 2.5, z: 0 }, { x: 1, y: 1, z: 0 })).not.toBeNull();
  });
});

describe('blockerReaches', () => {
  const cross: BlockCrossing = { t: 0.2, y: 2.4, z: 0.5 };

  it('alcança: na rede, perto em z e bola dentro do alcance', () => {
    expect(blockerReaches(BLOCK.netX, 0.6, 0.5, cross)).toBe(true);
  });

  it('alcança logo dentro do limite de rede (|x| < nearNetX)', () => {
    expect(blockerReaches(BLOCK.nearNetX - 0.01, 0.6, 0.5, cross)).toBe(true);
  });

  it('não alcança longe da rede (|x| ≥ nearNetX)', () => {
    expect(blockerReaches(BLOCK.nearNetX, 0.6, 0.5, cross)).toBe(false);
  });

  it('não alcança longe em z (zDist > zReach)', () => {
    expect(blockerReaches(BLOCK.netX, cross.z + BLOCK.zReach + 0.01, 0.5, cross)).toBe(false);
  });

  it('alcança logo dentro do limite em z (zDist < zReach)', () => {
    expect(blockerReaches(BLOCK.netX, cross.z + BLOCK.zReach - 0.01, 0.5, cross)).toBe(true);
  });

  it('não alcança bola alta demais (acima do reach)', () => {
    expect(blockerReaches(BLOCK.netX, 0.6, 0, { t: 0.2, y: 4.0, z: 0.5 })).toBe(false);
  });
});

describe('blockProximity', () => {
  it('1 quando o bloqueador está em cima do ponto de cruzamento', () => {
    expect(blockProximity(0.5, 0.5)).toBeCloseTo(1);
  });

  it('0 no limite do alcance em z (zReach)', () => {
    expect(blockProximity(0.5 + BLOCK.zReach, 0.5)).toBeCloseTo(0);
  });

  it('0.5 na metade do alcance', () => {
    expect(blockProximity(0.5 + BLOCK.zReach / 2, 0.5)).toBeCloseTo(0.5);
  });
});

describe('prepareBlock — plano coletivo', () => {
  it('agenda primária e assistente da CPU com uma decisão de tentativa', () => {
    const primary = { index: 3, moveTo() {} } as unknown as Athlete;
    const assist = { index: 4, moveTo() {} } as unknown as Athlete;
    const rally = new RallyState();
    const ai = SequenceRandom.fromFloats([0, 0.25, 0.75]);
    const ctx = {
      rally,
      diff: { blockChance: 1 },
      random: { ...makeRandomStreams(), ai },
      teamOf: () => ({
        athletes: [primary, assist],
        nearestFrontRowTo: () => primary,
      }),
      isHumanSide: () => false,
    } as unknown as MechanicsCtx;
    const plan: BlockPlan = {
      primaryAthleteId: 3,
      assistAthleteId: 4,
      crossZ: 0.4,
      contactIn: 0.8,
    };

    prepareBlock(ctx, TeamSide.HOME, 0.4, 0.8, plan);

    expect(rally.blockers.map((entry) => entry.athlete.index)).toEqual([3, 4]);
    expect(rally.blockers.every((entry) => entry.jumpIn >= 0.8)).toBe(true);
    expect(ai.draws).toBe(3);
  });
});

describe('resolveBlock — união da dupla', () => {
  function doubleCtx(reverse: boolean) {
    const scheduled: Array<() => void> = [];
    const planNextCalls: string[] = [];
    const telemetry: unknown[] = [];
    const makeBlocker = (index: number, z: number) =>
      ({
        index,
        isAirborne: true,
        jumpY: 0.5,
        pos: new THREE.Vector3(-BLOCK.netX, 0, z),
        act() {},
      }) as unknown as Athlete;
    const first = makeBlocker(3, 0.1);
    const second = makeBlocker(4, 0.9);
    const blockers = reverse ? [second, first] : [first, second];
    const contact = SequenceRandom.fromFloats([0.35, 0.5, 0.5]);
    const rally = new RallyState();
    rally.plan = { planId: 7 } as TouchPlan;
    rally.blockPlan = {
      planId: 7,
      tacticalRevision: 1,
      side: TeamSide.HOME,
      primaryAthleteId: 3,
      assistAthleteId: 4,
    };
    const ctx = {
      ball: {
        pos: new THREE.Vector3(-2, 3, 0.5),
        vel: new THREE.Vector3(10, 1, 0),
        launch() {},
      },
      rally,
      hooks: {
        audio: { block() {}, cheer() {} },
        effects: { burst() {} },
        camera: { addShake() {} },
        crowd: { excite() {} },
        banner() {},
      },
      stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] as [number, number] },
      teamOf: () => ({ frontRow: () => blockers }),
      after: (_t: number, fn: () => void) => scheduled.push(fn),
      planNext: (kind: string) => planNextCalls.push(kind),
      takeHumanBlockIntent: () => null,
      emitTelemetry: (event: unknown) => telemetry.push(event),
      random: { ...makeRandomStreams(), contact },
      isHumanSide: () => true,
    } as unknown as MechanicsCtx;
    return { ctx, scheduled, planNextCalls, telemetry, contact };
  }

  it('resolve exatamente um contato e é invariável à ordem das candidatas', () => {
    const direct = doubleCtx(false);
    const reversed = doubleCtx(true);

    resolveBlock(direct.ctx, TeamSide.AWAY);
    resolveBlock(reversed.ctx, TeamSide.AWAY);
    expect(direct.scheduled).toHaveLength(1);
    expect(reversed.scheduled).toHaveLength(1);
    direct.scheduled[0]();
    reversed.scheduled[0]();

    expect(direct.planNextCalls).toEqual(['dig']);
    expect(reversed.planNextCalls).toEqual(['dig']);
    expect(direct.telemetry).toHaveLength(1);
    expect(reversed.telemetry).toHaveLength(1);
    expect(direct.contact.draws).toBe(3);
    expect(reversed.contact.draws).toBe(3);
  });

  it('não inclui a assistente da CPU cujo salto começa depois do cruzamento', () => {
    const scheduled: Array<() => void> = [];
    const planNextCalls: string[] = [];
    const primary = {
      index: 3,
      jumpY: 0,
      pos: new THREE.Vector3(BLOCK.netX, 0, 0.1),
      act() {},
    } as unknown as Athlete;
    const lateAssist = {
      index: 4,
      jumpY: 0,
      pos: new THREE.Vector3(BLOCK.netX, 0, 0.9),
      act() {},
    } as unknown as Athlete;
    const rally = new RallyState();
    rally.blockers = [
      { athlete: primary, jumpIn: 0, jumped: false },
      { athlete: lateAssist, jumpIn: 0.1, jumped: false },
    ];
    const ctx = {
      ball: {
        pos: new THREE.Vector3(-0.5, 3, 0.5),
        vel: new THREE.Vector3(10, 1, 0),
        launch() {},
      },
      rally,
      hooks: {
        audio: { block() {}, cheer() {} },
        effects: { burst() {} },
        camera: { addShake() {} },
        crowd: { excite() {} },
        banner() {},
      },
      stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] as [number, number] },
      teamOf: () => ({ frontRow: () => [primary, lateAssist] }),
      after: (_t: number, fn: () => void) => scheduled.push(fn),
      planNext: (kind: string) => planNextCalls.push(kind),
      emitTelemetry() {},
      random: { ...makeRandomStreams(), contact: SequenceRandom.fromFloats([0.35]) },
      isHumanSide: () => false,
    } as unknown as MechanicsCtx;

    resolveBlock(ctx, TeamSide.HOME);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();

    expect(planNextCalls).toEqual(['pass']);
    expect(rally.blockers).toEqual([]);
  });
});

describe('isBlockable', () => {
  it('cortada que vai na rede não é bloqueável (deve virar falta de rede)', () => {
    // contato da IA na rede (x≈0.9, y=3.0) mirando baixo: cruza x=0 a ~2,25 m,
    // abaixo do topo da rede (2,43) → faixa 'net'
    expect(isBlockable({ x: 0.9, y: 3.0, z: 0 }, { x: -6, y: -4, z: 0 })).toBe(false);
  });

  it('cortada que passa limpo por cima é bloqueável', () => {
    // t=1; y no cruzamento = 3,0 m, acima do topo da rede → faixa 'cross'
    expect(isBlockable({ x: -3, y: 2, z: 0 }, { x: 3, y: 7.5, z: 0 })).toBe(true);
  });

  it('bola larga (fora do corredor das antenas) não é bloqueável → falta de antena', () => {
    // z além de halfWidth: cruza fora do corredor das antenas → 'outAntenna' (falta de quem
    // enviou), não 'cross'. Logo não é bloqueável — a falta de antena resolve o lance.
    expect(isBlockable({ x: -1, y: 1, z: COURT.halfWidth + 1 }, { x: 1, y: 6.5, z: 0 })).toBe(
      false,
    );
  });

  it('o guard (isBlockable), não a geometria, é o que barra o bloqueio indevido', () => {
    // raiz do bug: a geometria ALCANÇA a cortada-erro-na-rede, mas ela é falta de rede.
    const pos = { x: 0.9, y: 3.0, z: 0 };
    const vel = { x: -6, y: -4, z: 0 };
    const cross = blockCrossing(pos, vel);
    expect(cross).not.toBeNull();
    // blockerReaches devolveria true (bloqueador na rede alcança geometricamente)…
    expect(blockerReaches(BLOCK.netX, cross!.z, 0.5, cross!)).toBe(true);
    // …mas isBlockable é false, então resolveBlock retorna cedo e a rede resolve a falta.
    expect(isBlockable(pos, vel)).toBe(false);
  });
});

describe('resolveBlock — snap ao ponto analítico de cruzamento (x = 0)', () => {
  // Monta um ctx falso mínimo: bola stale, HOME defende no ar contra ataque AWAY,
  // captura o callback agendado por ctx.after e o burst de partículas.
  function makeCtx(
    stalePos: THREE.Vector3,
    staleVel: THREE.Vector3,
    blockerZ = 0.5,
    blockIntent: ActionIntent | null = null,
    contactFloats: readonly number[] = [0.5, 0.5, 0.5],
  ) {
    const launches: { origin: THREE.Vector3 }[] = [];
    const bursts: THREE.Vector3[] = [];
    const scheduled: { t: number; fn: () => void }[] = [];
    const noop = (): void => {};

    const ball = {
      pos: stalePos.clone(),
      vel: staleVel.clone(),
      launch(p0: THREE.Vector3, v0: THREE.Vector3): void {
        launches.push({ origin: p0.clone() });
        this.pos.copy(p0);
        this.vel.copy(v0);
      },
    };
    const blocker = {
      index: 0,
      isAirborne: true,
      jumpY: 0.5,
      pos: new THREE.Vector3(-BLOCK.netX, 0, blockerZ),
      act: noop,
    } as unknown as Athlete;
    const team = { frontRow: () => [blocker] };
    const rally = new RallyState();
    rally.plan = { planId: 7 } as TouchPlan;
    rally.blockPlan = {
      planId: 7,
      tacticalRevision: 1,
      side: TeamSide.HOME,
      primaryAthleteId: 0,
      assistAthleteId: null,
    };

    const random = makeRandomStreams(contactFloats);
    const ctx = {
      ball,
      rally,
      hooks: {
        audio: { block: noop, cheer: noop },
        effects: {
          burst: (p: THREE.Vector3) => {
            bursts.push(p.clone());
          },
        },
        camera: { addShake: noop },
        crowd: { excite: noop },
        banner: noop,
      },
      stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] as [number, number] },
      teamOf: () => team,
      after: (t: number, fn: () => void) => {
        scheduled.push({ t, fn });
      },
      planNext: noop,
      takeHumanBlockIntent: () => blockIntent,
      emitTelemetry: noop,
      random,
      isHumanSide: (side: TeamSide) => side === TeamSide.HOME,
    } as unknown as MechanicsCtx;

    return { ctx, launches, bursts, scheduled, contact: random.contact };
  }

  it('lança e explode do plano da rede, não da posição stale da bola', () => {
    // Sequência baixa: r=0 cai no ramo STUFF e range(a,b) devolve a.
    const contactFloats = [0, 0, 0];
    const { ctx, launches, bursts, scheduled, contact } = makeCtx(
      new THREE.Vector3(-2, 3.0, 0.5), // pos STALE
      new THREE.Vector3(10, 1, 0), // cruza x=0 em t=0.2, y≈2,94 (acima da fita → bloqueável)
      0.5,
      null,
      contactFloats,
    );
    const cross = blockCrossing({ x: -2, y: 3.0, z: 0.5 }, { x: 10, y: 1, z: 0 })!;

    // AWAY ataca; HOME (humano, no ar) bloqueia
    resolveBlock(ctx, TeamSide.AWAY);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].t).toBeCloseTo(cross.t); // resolve no instante do cruzamento

    // dispara o callback do bloqueio
    scheduled[0].fn();

    expect(launches).toHaveLength(1);
    expect(launches[0].origin.x).toBeCloseTo(0); // plano da rede
    expect(launches[0].origin.x).not.toBe(-2); // não a pos stale
    expect(launches[0].origin.y).toBeCloseTo(cross.y);
    expect(launches[0].origin.z).toBeCloseTo(cross.z);
    // partículas nascem no ponto de cruzamento
    expect(bursts[0].x).toBeCloseTo(0);
    expect(contact.draws).toBe(3);
  });

  it('não agenda bloqueio quando a bola cruza na faixa da rede (falta de rede tem prioridade)', () => {
    // Mesma geometria alcançável do teste acima, mas cruzando a ~2,44 m (dentro da faixa
    // da rede): o guard isBlockable barra o bloqueio para o evento de rede resolver a falta.
    const { ctx, scheduled } = makeCtx(
      new THREE.Vector3(-2, 2.5, 0.5), // pos STALE, cruza x=0 a y≈2,44 (na fita)
      new THREE.Vector3(10, 1, 0),
    );
    resolveBlock(ctx, TeamSide.AWAY);
    expect(scheduled).toHaveLength(0); // sem o guard, seria 1 (bug: bloqueio apaga a falta)
  });

  it('bloqueio penetrante amplia continuamente o alcance lateral humano', () => {
    const pos = new THREE.Vector3(-2, 3, 0.5);
    const vel = new THREE.Vector3(10, 1, 0);
    const without = makeCtx(pos, vel, 1.45);
    const penetrating = makeCtx(pos, vel, 1.45, {
      token: 7,
      context: 'block',
      gesture: 'hold',
      charge: 1,
      direction: { x: 0, z: 0 },
      pressedTick: 0,
      resolvedTick: 42,
      cause: 'contact',
      technique: 'penetrating-block',
      power: 0.5,
      reach: 1,
      precision: 0.6,
      penetration: 1,
    });

    resolveBlock(without.ctx, TeamSide.AWAY);
    resolveBlock(penetrating.ctx, TeamSide.AWAY);

    expect(without.scheduled).toHaveLength(0);
    expect(penetrating.scheduled).toHaveLength(1);
  });
});

describe('resolveBlock — posse após bloqueio', () => {
  // Exercita o callback do bloqueio para confirmar que o toque de bloqueio zera a posse
  // (não conta p/ nenhum lado), liberando o próximo toque — a cortada chega como 3º toque
  // do atacante, então sem o reset o guard de planNext mataria a defesa (dig).
  function makeCtx(contactFloats: readonly number[] = [0.5, 0.5, 0.5]) {
    const scheduled: { t: number; fn: () => void }[] = [];
    const planNextCalls: string[] = [];
    const noop = (): void => {};

    // bola stale; cruza x=0 em t=0.2 a y≈2,94 (acima da fita → bloqueável)
    const ball = {
      pos: new THREE.Vector3(-2, 3.0, 0.5),
      vel: new THREE.Vector3(10, 1, 0),
      launch: noop,
    };
    // HOME defende no ar contra ataque AWAY; z alinhado ao cruzamento → prox = 1
    const blocker = {
      index: 0,
      isAirborne: true,
      jumpY: 0.5,
      pos: new THREE.Vector3(-BLOCK.netX, 0, 0.5),
      act: noop,
    } as unknown as Athlete;
    const team = { frontRow: () => [blocker] };
    const rally = new RallyState();
    rally.plan = { planId: 7 } as TouchPlan;
    rally.blockPlan = {
      planId: 7,
      tacticalRevision: 1,
      side: TeamSide.HOME,
      primaryAthleteId: 0,
      assistAthleteId: null,
    };

    const random = makeRandomStreams(contactFloats);
    const ctx = {
      ball,
      rally,
      hooks: {
        audio: { block: noop, cheer: noop },
        effects: { burst: noop },
        camera: { addShake: noop },
        crowd: { excite: noop },
        banner: noop,
      },
      stats: { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] as [number, number] },
      teamOf: () => team,
      after: (t: number, fn: () => void) => {
        scheduled.push({ t, fn });
      },
      planNext: (k: string) => {
        planNextCalls.push(k);
      },
      emitTelemetry: noop,
      random,
      isHumanSide: (side: TeamSide) => side === TeamSide.HOME,
    } as unknown as MechanicsCtx;

    return { ctx, rally, scheduled, planNextCalls, contact: random.contact };
  }

  it('STUFF: zera a posse e agenda o dig (cobertura do ataque bloqueado)', () => {
    // r baixo (0.1 < prox*0.5 = 0.5) cai no ramo STUFF; demais chamadas alimentam rand().
    const { ctx, rally, scheduled, planNextCalls, contact } = makeCtx([0.1, 0.5, 0.5]);
    // a cortada chegou como 3º toque do atacante (AWAY)
    rally.countTouch(TeamSide.AWAY);
    rally.countTouch(TeamSide.AWAY);
    rally.countTouch(TeamSide.AWAY);
    expect(rally.possessionTeam).toBe(TeamSide.AWAY);
    expect(rally.possessionTouches).toBe(3);

    resolveBlock(ctx, TeamSide.AWAY);
    expect(scheduled).toHaveLength(1);
    scheduled[0].fn(); // dispara o bloqueio

    // sem o reset central, a posse (AWAY, 3) sobreviveria e o guard mataria o dig
    expect(rally.possessionTeam).toBe(null);
    expect(rally.possessionTouches).toBe(0);
    expect(planNextCalls).toEqual(['dig']);
    expect(contact.draws).toBe(3);
  });

  it('pingo: mantém a posse limpa e agenda o pass (comportamento já correto)', () => {
    // r=0.6: fora de STUFF (prox*0.5=0.5), dentro de pingo (prox*0.95=0.95).
    const { ctx, rally, scheduled, planNextCalls, contact } = makeCtx([0.6, 0.5, 0.5]);
    rally.countTouch(TeamSide.AWAY);
    rally.countTouch(TeamSide.AWAY);
    rally.countTouch(TeamSide.AWAY);

    resolveBlock(ctx, TeamSide.AWAY);
    expect(scheduled).toHaveLength(1);
    scheduled[0].fn();

    expect(rally.possessionTeam).toBe(null);
    expect(rally.possessionTouches).toBe(0);
    expect(planNextCalls).toEqual(['pass']);
    expect(contact.draws).toBe(1);
  });
});
