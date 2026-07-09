import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HumanController } from './HumanController';
import { RallyState, type TouchPlan } from '../RallyState';
import { TeamSide } from '../../core/constants';
import type { MechanicsCtx } from '../mechanics/context';
import type { Input } from '../../core/Input';
import type { Athlete } from '../Team';

// Input falso controlável por frame: estado contínuo (down) + bordas (pressed/released) e o
// vetor de movimento (axis) que o controller lê via moveAxis().
function makeInput(
  opts: {
    down?: string[];
    pressed?: string[];
    released?: string[];
    axis?: { x: number; z: number };
  } = {},
): Input {
  const down = new Set(opts.down ?? []);
  const pressed = new Set(opts.pressed ?? []);
  const released = new Set(opts.released ?? []);
  const axis = opts.axis ?? { x: 0, z: 0 };
  return {
    isDown: (k: string) => down.has(k),
    wasPressed: (k: string) => pressed.has(k),
    wasReleased: (k: string) => released.has(k),
    moveAxis: () => axis,
  } as unknown as Input;
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
      hint: noop,
      serveMeter: (v: boolean, val?: number) => {
        serveMeterCalls.push([v, val]);
      },
      zoneHint: (zone: number | null) => {
        zoneHintCalls.push(zone);
      },
      effects: { showAim: noop, showLanding: noop },
    },
  } as unknown as MechanicsCtx;
  return { ctx, serveMeterCalls, launches, zoneHintCalls };
}

// Athlete falso: pos + moveTo espiã. O controller lê pos e chama moveTo ao mover na recepção.
function makeAthlete(x = 0, z = 0) {
  const moveToCalls: Array<[number, number]> = [];
  const athlete = {
    pos: new THREE.Vector3(x, 0, z),
    moveTo: (nx: number, nz: number) => {
      moveToCalls.push([nx, nz]);
    },
  } as unknown as Athlete;
  return { athlete, moveToCalls };
}

// Coloca o controller em modo 'receive' com um plano de passe do lado humano.
function assignReceive(hc: HumanController, ctx: MechanicsCtx, athlete: Athlete): void {
  const plan = {
    side: TeamSide.HOME,
    athlete,
    contactIn: 1,
    point: new THREE.Vector3(),
    kind: 'pass',
    isHuman: true,
    done: false,
  } as unknown as TouchPlan;
  ctx.rally.plan = plan;
  hc.onAssigned(ctx, plan);
}

// server é só armazenado como `controlled` no saque; nenhum método é chamado nestes testes.
const server = {} as unknown as Athlete;

describe('HumanController.cancelServeCharge', () => {
  it('zera o medidor durante o saque (última chamada de serveMeter é (true, 0))', () => {
    const hc = new HumanController();
    const { ctx, serveMeterCalls } = makeCtx();
    hc.beginServe(server, ctx);
    // um frame segurando ESPAÇO: liga o carregamento e acumula potência (sem soltar)
    hc.update(0.2, makeInput({ down: ['Space'], pressed: ['Space'] }), ctx);
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
    hc.update(0.2, makeInput({ down: ['Space'], pressed: ['Space'] }), ctx);
    hc.cancelServeCharge(ctx);

    const callsBeforeResume = serveMeterCalls.length;
    // retomada após a pausa: ESPAÇO segue 'down', mas o edge de soltar foi engolido na pausa.
    // Sem o cancelamento, serveCharging continuaria true e o medidor oscilaria a cada frame.
    for (let i = 0; i < 5; i++) {
      hc.update(0.2, makeInput({ down: ['Space'] }), ctx);
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

describe('HumanController — WASD move na recepção sem trocar a zona (M5)', () => {
  it('mover para frente (W) na recepção move o atleta e mantém a zona', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    const { athlete, moveToCalls } = makeAthlete(0, 0);
    hc.chosenZone = 2;
    assignReceive(hc, ctx, athlete);

    hc.update(0.016, makeInput({ down: ['KeyW'], pressed: ['KeyW'], axis: { x: 1, z: 0 } }), ctx);

    expect(hc.chosenZone).toBe(2); // zona intacta: WASD não troca zona na recepção
    expect(moveToCalls.length).toBeGreaterThan(0); // o atleta se moveu
    expect(zoneHintCalls).toHaveLength(0); // nenhuma dica de zona disparada na recepção
  });

  it('joystick para a esquerda (A) na recepção não troca a zona', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    const { athlete, moveToCalls } = makeAthlete(0, 0);
    hc.chosenZone = 2;
    assignReceive(hc, ctx, athlete);

    // o joystick sintetiza KeyA ao cruzar o limiar; deve só mover, nunca trocar a zona.
    hc.update(0.016, makeInput({ down: ['KeyA'], pressed: ['KeyA'], axis: { x: 0, z: -1 } }), ctx);

    expect(hc.chosenZone).toBe(2);
    expect(moveToCalls.length).toBeGreaterThan(0);
    expect(zoneHintCalls).toHaveLength(0);
  });
});

describe('HumanController — troca de zona na fase de levantamento (M5)', () => {
  it('W/A/D trocam a zona quando ctl é none e o plano é set do lado humano', () => {
    const hc = new HumanController();
    const { ctx, zoneHintCalls } = makeCtx();
    // ctl permanece 'none' (default); plano de levantamento do HOME abre a janela de zona.
    ctx.rally.plan = {
      side: TeamSide.HOME,
      kind: 'set',
      done: false,
    } as unknown as TouchPlan;

    hc.update(0.016, makeInput({ pressed: ['KeyW'] }), ctx);
    expect(hc.chosenZone).toBe(1); // W = centro

    hc.update(0.016, makeInput({ pressed: ['KeyA'] }), ctx);
    expect(hc.chosenZone).toBe(0); // A = esquerda

    hc.update(0.016, makeInput({ pressed: ['KeyD'] }), ctx);
    expect(hc.chosenZone).toBe(2); // D = direita

    expect(zoneHintCalls).toEqual([1, 0, 2]);
  });
});
