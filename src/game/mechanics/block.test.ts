import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  blockCrossing,
  blockerReaches,
  blockProximity,
  resolveBlock,
  BlockCrossing,
} from './block';
import { RallyState } from '../RallyState';
import { TeamSide } from '../../core/constants';
import type { MechanicsCtx } from './context';
import type { Athlete } from '../Team';

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

  it('null quando o cruzamento é tarde demais (fora da janela de 0.8s)', () => {
    expect(blockCrossing({ x: -9, y: 2.5, z: 0 }, { x: 1, y: 1, z: 0 })).toBeNull();
  });
});

describe('blockerReaches', () => {
  const cross: BlockCrossing = { t: 0.2, y: 2.4, z: 0.5 };

  it('alcança: na rede, perto em z e bola dentro do alcance', () => {
    expect(blockerReaches(0.72, 0.6, 0.5, cross)).toBe(true);
  });

  it('não alcança longe da rede (|x| ≥ 1.4)', () => {
    expect(blockerReaches(2.0, 0.6, 0.5, cross)).toBe(false);
  });

  it('não alcança longe em z (zDist > 0.85)', () => {
    expect(blockerReaches(0.72, 2.0, 0.5, cross)).toBe(false);
  });

  it('não alcança bola alta demais (acima do reach)', () => {
    expect(blockerReaches(0.72, 0.6, 0, { t: 0.2, y: 4.0, z: 0.5 })).toBe(false);
  });
});

describe('blockProximity', () => {
  it('1 quando o bloqueador está em cima do ponto de cruzamento', () => {
    expect(blockProximity(0.5, 0.5)).toBeCloseTo(1);
  });

  it('0 no limite do alcance em z (0.85)', () => {
    expect(blockProximity(1.35, 0.5)).toBeCloseTo(0);
  });

  it('0.5 na metade do alcance', () => {
    expect(blockProximity(0.925, 0.5)).toBeCloseTo(0.5);
  });
});

describe('resolveBlock — snap ao ponto analítico de cruzamento (x = 0)', () => {
  // Monta um ctx falso mínimo: bola stale, HOME defende no ar contra ataque AWAY,
  // captura o callback agendado por ctx.after e o burst de partículas.
  function makeCtx(stalePos: THREE.Vector3, staleVel: THREE.Vector3) {
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
      isAirborne: true,
      jumpY: 0.5,
      pos: new THREE.Vector3(-0.72, 0, 0.5), // na rede e alinhado em z ao cruzamento
      act: noop,
    } as unknown as Athlete;
    const team = { frontRow: () => [blocker] };

    const ctx = {
      ball,
      rally: new RallyState(),
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
    } as unknown as MechanicsCtx;

    return { ctx, launches, bursts, scheduled };
  }

  it('lança e explode do plano da rede, não da posição stale da bola', () => {
    // Math.random baixo → r=0 cai no ramo STUFF; rand(a,b) devolve a (determinístico).
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { ctx, launches, bursts, scheduled } = makeCtx(
        new THREE.Vector3(-2, 2.5, 0.5), // pos STALE
        new THREE.Vector3(10, 1, 0), // cruza x=0 em t=0.2
      );
      const cross = blockCrossing({ x: -2, y: 2.5, z: 0.5 }, { x: 10, y: 1, z: 0 })!;

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
    } finally {
      spy.mockRestore();
    }
  });
});
