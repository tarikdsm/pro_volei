import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HumanController } from './HumanController';
import { RallyState, type TouchPlan } from '../RallyState';
import { TeamSide } from '../../core/constants';
import type { MechanicsCtx } from '../mechanics/context';
import type { Athlete, Team } from '../Team';
import type { ControlFrame } from './ControlFrame';

function makeFrame(
  opts: {
    actionDown?: boolean;
    pressed?: boolean;
    released?: boolean;
    cancelled?: boolean;
    axis?: { x: number; z: number };
  } = {},
): ControlFrame {
  const axis = opts.axis ?? { x: 0, z: 0 };
  let sequence = 0;
  return {
    sampledAtMs: 100,
    screenAxis: { right: 0, up: 0 },
    courtAxis: axis,
    actionDown: opts.actionDown ?? false,
    actionEdges: [
      ...(opts.pressed
        ? [{ kind: 'press' as const, source: 'keyboard' as const, atMs: 90, sequence: sequence++ }]
        : []),
      ...(opts.released
        ? [
            {
              kind: 'release' as const,
              source: 'keyboard' as const,
              atMs: 95,
              sequence: sequence++,
            },
          ]
        : []),
    ],
    cancellations: opts.cancelled ? [{ reason: 'pause', atMs: 98, sequence }] : [],
  };
}

function makeTimelineFrame(timeline: Array<'press' | 'release' | 'cancel'>): ControlFrame {
  let actionDown = false;
  const actionEdges: ControlFrame['actionEdges'][number][] = [];
  const cancellations: ControlFrame['cancellations'][number][] = [];

  timeline.forEach((kind, sequence) => {
    if (kind === 'cancel') {
      actionDown = false;
      cancellations.push({ reason: 'pause', atMs: 90 + sequence, sequence });
    } else {
      actionDown = kind === 'press';
      actionEdges.push({ kind, source: 'keyboard', atMs: 90 + sequence, sequence });
    }
  });

  return {
    sampledAtMs: 100,
    screenAxis: { right: 0, up: 0 },
    courtAxis: { x: 0, z: 0 },
    actionDown,
    actionEdges,
    cancellations,
  };
}

// ctx mínimo: captura serveMeter, os lançamentos da bola e as dicas de zona (zoneHint).
function makeCtx() {
  const serveMeterCalls: Array<[boolean, number | undefined]> = [];
  const launches: THREE.Vector3[] = [];
  const zoneHintCalls: Array<number | null> = [];
  const noop = (): void => {};
  const ctx = {
    ball: {
      pos: new THREE.Vector3(),
      launch: (p0: THREE.Vector3) => {
        launches.push(p0.clone());
      },
    },
    rally: new RallyState(),
    hooks: {
      banner: noop,
      hint: noop,
      serveMeter: (v: boolean, val?: number) => {
        serveMeterCalls.push([v, val]);
      },
      zoneHint: (zone: number | null) => {
        zoneHintCalls.push(zone);
      },
      effects: { showAim: noop, showLanding: noop },
      audio: { hitHard: noop },
      camera: { setMode: noop },
    },
    after: noop,
  } as unknown as MechanicsCtx;
  return { ctx, serveMeterCalls, launches, zoneHintCalls };
}

// Athlete falso: pos + moveTo espiã. O controller lê pos e chama moveTo ao mover na recepção.
function makeAthlete(x = 0, z = 0, index = 0) {
  const moveToCalls: Array<[number, number]> = [];
  const target = new THREE.Vector3(x, 0, z);
  const athlete = {
    side: TeamSide.HOME,
    index,
    pos: new THREE.Vector3(x, 0, z),
    target,
    velocity: new THREE.Vector3(),
    speedMul: 1,
    isAirborne: false,
    moveTo: (nx: number, nz: number) => {
      moveToCalls.push([nx, nz]);
      target.set(nx, 0, nz);
    },
  } as unknown as Athlete;
  return { athlete, moveToCalls };
}

function makeRoster(athletes: Athlete[], front = athletes.slice(-3)): Team {
  return {
    athletes,
    frontRow: () => front,
    slotIndexOf: (athlete: Athlete) => athlete.index,
    basePositionOf: (athlete: Athlete) => ({ x: -6, z: athlete.index }),
  } as unknown as Team;
}

// Coloca o controller em modo 'receive' com um plano de passe do lado humano.
function assignReceive(hc: HumanController, ctx: MechanicsCtx, athlete: Athlete): TouchPlan {
  const plan = {
    planId: 1,
    side: TeamSide.HOME,
    athlete,
    contactIn: 1,
    point: new THREE.Vector3(),
    kind: 'pass',
    isHuman: true,
    done: false,
  } as unknown as TouchPlan;
  ctx.rally.plan = plan;
  ctx.teamOf = () => makeRoster([athlete]);
  hc.onAssigned(ctx, plan);
  return plan;
}

const server = {
  act: (): void => {},
  reachPoint: () => new THREE.Vector3(),
} as unknown as Athlete;

describe('HumanController.cancelServeCharge', () => {
  it('zera o medidor durante o saque (última chamada de serveMeter é (true, 0))', () => {
    const hc = new HumanController();
    const { ctx, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    // um frame segurando ESPAÇO: liga o carregamento e acumula potência (sem soltar)
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);
    // durante o carregamento a potência subiu acima de 0
    expect(serveMeterCalls[serveMeterCalls.length - 1][1]).toBeGreaterThan(0);

    hc.cancelServeCharge(ctx);
    // o cancelamento reseta o medidor visível para 0
    expect(serveMeterCalls[serveMeterCalls.length - 1]).toEqual([true, 0]);
  });

  it('após cancelar, o retomar com ESPAÇO ainda pressionado não oscila nem dispara o saque', () => {
    const hc = new HumanController();
    const { ctx, serveMeterCalls, launches } = makeCtx();
    hc.beginServe(server, ctx);
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);
    hc.cancelServeCharge(ctx);

    const callsBeforeResume = serveMeterCalls.length;
    // retomada após a pausa: ESPAÇO segue 'down', mas o edge de soltar foi engolido na pausa.
    // Sem o cancelamento, serveCharging continuaria true e o medidor oscilaria a cada frame.
    for (let i = 0; i < 5; i++) {
      hc.update(0.2, makeFrame({ actionDown: true }), ctx);
    }
    expect(serveMeterCalls.length).toBe(callsBeforeResume); // medidor não oscila mais
    expect(launches).toHaveLength(0); // nenhum saque disparado sem re-apertar/soltar
  });

  it('é no-op fora do saque (ctl none): não mexe no medidor', () => {
    const hc = new HumanController();
    const { ctx, serveMeterCalls } = makeCtx();
    hc.cancelServeCharge(ctx);
    expect(serveMeterCalls).toHaveLength(0);
  });
});

describe('HumanController — direção de quadra move na recepção sem trocar a zona', () => {
  it('movimento relativo à câmera move o atleta e mantém a zona', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    const { athlete, moveToCalls } = makeAthlete(0, 0);
    hc.chosenZone = 2;
    assignReceive(hc, ctx, athlete);

    hc.update(0.016, makeFrame({ axis: { x: 1, z: 0 } }), ctx);

    expect(hc.chosenZone).toBe(2); // zona intacta: movimento não troca zona na recepção
    expect(moveToCalls.length).toBeGreaterThan(0); // o atleta se moveu
    expect(zoneHintCalls).toHaveLength(0); // nenhuma dica de zona disparada na recepção
  });

  it('joystick lateral na recepção não troca a zona', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    const { athlete, moveToCalls } = makeAthlete(0, 0);
    hc.chosenZone = 2;
    assignReceive(hc, ctx, athlete);

    hc.update(0.016, makeFrame({ axis: { x: 0, z: -1 } }), ctx);

    expect(hc.chosenZone).toBe(2);
    expect(moveToCalls.length).toBeGreaterThan(0);
    expect(zoneHintCalls).toHaveLength(0);
  });
});

describe('HumanController — AutoSelector e assistência', () => {
  it('atribui a melhor interceptadora e atualiza plan.athlete sem repetir hints', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const far = makeAthlete(-8, 0, 0).athlete;
    const close = makeAthlete(-4, 0, 1).athlete;
    const plan = {
      planId: 7,
      side: TeamSide.HOME,
      athlete: far,
      contactIn: 1,
      point: new THREE.Vector3(-3.5, 1, 0),
      kind: 'pass',
      isHuman: true,
      done: false,
    } satisfies TouchPlan;
    ctx.rally.plan = plan;
    ctx.teamOf = () => makeRoster([far, close]);

    hc.onAssigned(ctx, plan);

    expect(plan.athlete).toBe(close);
    expect(hc.selectionSnapshot().selectedId).toBe(close.index);
    expect(hc.selectionSnapshot().switches).toBe(0);
  });

  it('troca durante o plano sem perder timing já registrado', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const first = makeAthlete(-4, 0, 0).athlete;
    const challenger = makeAthlete(-9, 0, 1).athlete;
    const roster = makeRoster([first, challenger]);
    const plan = {
      planId: 8,
      side: TeamSide.HOME,
      athlete: first,
      contactIn: 0.45,
      point: new THREE.Vector3(-3.5, 1, 0),
      kind: 'pass',
      isHuman: true,
      done: false,
    } satisfies TouchPlan;
    ctx.rally.plan = plan;
    ctx.teamOf = () => roster;
    hc.onAssigned(ctx, plan);
    (hc as unknown as { timingQ: number }).timingQ = 0.9;

    challenger.pos.set(-3.5, 0, 0);
    first.pos.set(-8, 0, 0);
    plan.contactIn = 0.4;
    hc.update(1 / 60, makeFrame(), ctx);

    expect(plan.athlete).toBe(challenger);
    expect(hc.selectionSnapshot().switches).toBe(1);
    expect(hc.reachQuality(false, false, ctx)).toBeGreaterThan(0.45);
  });

  it('sem direção, corrige o alvo em no máximo 0,65 m e nunca teleporta a atleta', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const { athlete, moveToCalls } = makeAthlete(-7, 0, 0);
    const plan = {
      planId: 9,
      side: TeamSide.HOME,
      athlete,
      contactIn: 1,
      point: new THREE.Vector3(-3, 1, 0),
      kind: 'dig',
      isHuman: true,
      done: false,
    } satisfies TouchPlan;
    ctx.rally.plan = plan;
    ctx.teamOf = () => makeRoster([athlete]);
    hc.onAssigned(ctx, plan);

    hc.update(1 / 60, makeFrame(), ctx);

    const [targetX, targetZ] = moveToCalls.at(-1)!;
    expect(Math.hypot(targetX - athlete.pos.x, targetZ - athlete.pos.z)).toBeLessThanOrEqual(
      0.65 + 1e-9,
    );
    expect(athlete.pos.x).toBe(-7);
  });

  it('no bloqueio seleciona somente a linha de frente sem alterar a atacante AWAY', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const back = makeAthlete(-0.72, 0, 0).athlete;
    const front = makeAthlete(-2, 0, 3).athlete;
    const attacker = makeAthlete(2, 0, 9).athlete;
    (attacker as { side: TeamSide }).side = TeamSide.AWAY;
    const plan = {
      planId: 10,
      side: TeamSide.AWAY,
      athlete: attacker,
      contactIn: 1,
      point: new THREE.Vector3(2, 3, 0),
      kind: 'spike',
      isHuman: false,
      done: false,
    } satisfies TouchPlan;
    ctx.rally.plan = plan;
    ctx.teamOf = () => makeRoster([back, front], [front]);

    hc.assignBlock(back, ctx);

    expect(hc.selectionSnapshot().selectedId).toBe(front.index);
    expect(plan.athlete).toBe(attacker);

    ctx.rally.plan = { ...plan, planId: 11, kind: 'pass' };
    hc.idle(ctx);
    hc.update(1 / 60, makeFrame(), ctx);
    expect(hc.selectionSnapshot().planId).toBe(10);
  });
});

describe('HumanController — troca de zona na fase de levantamento', () => {
  it('a direção da quadra troca a zona e neutro preserva a recomendação', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    // ctl permanece 'none' (default); plano de levantamento do HOME abre a janela de zona.
    ctx.rally.plan = {
      side: TeamSide.HOME,
      kind: 'set',
      done: false,
    } as unknown as TouchPlan;

    hc.chosenZone = 1;
    hc.update(0.016, makeFrame({ axis: { x: 0, z: -1 } }), ctx);
    expect(hc.chosenZone).toBe(0);

    hc.update(0.016, makeFrame(), ctx);
    expect(hc.chosenZone).toBe(0);

    hc.update(0.016, makeFrame({ axis: { x: 0, z: 1 } }), ctx);
    expect(hc.chosenZone).toBe(2);
    expect(zoneHintCalls).toEqual([0, 2]);
  });
});

describe('HumanController — cancelamento sem release', () => {
  it('cancela uma carga em andamento sem disparar o saque', () => {
    const hc = new HumanController();
    const { ctx, launches, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);

    hc.update(0.016, makeFrame({ cancelled: true }), ctx);

    expect(launches).toHaveLength(0);
    expect(serveMeterCalls.at(-1)).toEqual([true, 0]);
  });

  it('preserva release antes de press no mesmo frame sem zerar a carga anterior', () => {
    const hc = new HumanController();
    const { ctx, launches, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);
    const callsBeforeTimeline = serveMeterCalls.length;

    hc.update(0.016, makeTimelineFrame(['release', 'press']), ctx);

    expect(launches).toHaveLength(1);
    expect(serveMeterCalls.slice(callsBeforeTimeline)).toEqual([[false, undefined]]);
  });

  it('aceita nova pressão posterior ao cancelamento no mesmo frame', () => {
    const hc = new HumanController();
    const { ctx, launches, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);

    hc.update(0.1, makeTimelineFrame(['cancel', 'press']), ctx);

    expect(launches).toHaveLength(0);
    expect(serveMeterCalls.at(-2)).toEqual([true, 0]);
    expect(serveMeterCalls.at(-1)?.[1]).toBeGreaterThan(0);
  });

  it('ordena cancelamento e pressão por timestamp antes da sequência de inserção', () => {
    const hc = new HumanController();
    const { ctx, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    hc.update(0.2, makeFrame({ actionDown: true, pressed: true }), ctx);

    hc.update(
      0.1,
      {
        ...makeFrame(),
        actionDown: true,
        cancellations: [{ reason: 'pause', atMs: 90, sequence: 9 }],
        actionEdges: [{ kind: 'press', source: 'keyboard', atMs: 91, sequence: 2 }],
      },
      ctx,
    );

    expect(serveMeterCalls.at(-2)).toEqual([true, 0]);
    expect(serveMeterCalls.at(-1)?.[1]).toBeGreaterThan(0);
  });
});

describe('HumanController — transições de modo (T4)', () => {
  it('beginServe assume o saque: mode "serve" e isControlling true', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    hc.beginServe(server, ctx);
    expect(hc.mode).toBe('serve');
    expect(hc.isControlling).toBe(true);
  });

  it('release libera o controle: mode "none" e isControlling false', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    hc.beginServe(server, ctx);
    hc.release();
    expect(hc.mode).toBe('none');
    expect(hc.isControlling).toBe(false);
  });

  it('onAssigned de levantamento (set) larga o controle e mostra a dica de zona', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    const plan = { side: TeamSide.HOME, kind: 'set', done: false } as unknown as TouchPlan;
    hc.onAssigned(ctx, plan);
    expect(hc.mode).toBe('none'); // no set o humano só escolhe a zona, não controla um atleta
    expect(zoneHintCalls).toEqual([hc.chosenZone]);
  });

  it('onAssigned de cortada (spike) entra em modo "attack"', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const { athlete } = makeAthlete(0, 0);
    const plan = { kind: 'spike', athlete, done: false } as unknown as TouchPlan;
    hc.onAssigned(ctx, plan);
    expect(hc.mode).toBe('attack');
    expect(hc.isControlling).toBe(true);
  });

  it('spikeQuality retorna 0.4 quando o timing do pulo ainda não foi registrado', () => {
    const hc = new HumanController();
    expect(hc.spikeQuality()).toBeCloseTo(0.4);
  });

  it('idle não sai do bloqueio: mantém o modo "block" quando já bloqueando', () => {
    const hc = new HumanController();
    const { ctx } = makeCtx();
    const { athlete } = makeAthlete(-0.72, 0);
    hc.assignBlock(athlete, ctx);
    expect(hc.mode).toBe('block');
    hc.idle(ctx);
    expect(hc.mode).toBe('block'); // idle só ocioso quem não está no bloqueio
  });
});
