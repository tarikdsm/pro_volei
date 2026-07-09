import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HumanController } from './HumanController';
import { RallyState } from '../RallyState';
import type { MechanicsCtx } from '../mechanics/context';
import type { Input } from '../../core/Input';
import type { Athlete } from '../Team';

// Input falso controlável por frame: estado contínuo (down) + bordas (pressed/released).
function makeInput(opts: { down?: string[]; pressed?: string[]; released?: string[] } = {}): Input {
  const down = new Set(opts.down ?? []);
  const pressed = new Set(opts.pressed ?? []);
  const released = new Set(opts.released ?? []);
  return {
    isDown: (k: string) => down.has(k),
    wasPressed: (k: string) => pressed.has(k),
    wasReleased: (k: string) => released.has(k),
    moveAxis: () => ({ x: 0, z: 0 }),
  } as unknown as Input;
}

// ctx mínimo: captura as chamadas de serveMeter e conta os lançamentos da bola.
function makeCtx() {
  const serveMeterCalls: Array<[boolean, number | undefined]> = [];
  const launches: THREE.Vector3[] = [];
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
      effects: { showAim: noop, showLanding: noop },
    },
  } as unknown as MechanicsCtx;
  return { ctx, serveMeterCalls, launches };
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
