import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Crowd, advanceCrowdTick } from './Crowd';
import type { Arena } from './Arena';

// Arena mínima só com o que o Crowd lê (standsInfo). O Arena real usa canvas/WebGL e não
// roda em Node; este stub basta para instanciar a torcida.
function stubArena(): Arena {
  return {
    standsInfo: [
      {
        origin: new THREE.Vector3(0, 0, 10),
        right: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 0.55, 0.9),
        rows: 2,
        cols: 4,
      },
    ],
  } as unknown as Arena;
}

describe('Crowd.setQuality (tiers 4E)', () => {
  it('reduz o prefixo visível sem realocar buffers e clampa densidade', () => {
    const crowd = new Crowd(stubArena(), 1, 20);
    const full = crowd.mesh.count;
    expect(full).toBeGreaterThan(0);

    crowd.setQuality(0.5, 12);
    expect(crowd.mesh.count).toBe(Math.max(1, Math.round(full * 0.5)));

    crowd.setQuality(2, 20); // clampa em 1
    expect(crowd.mesh.count).toBe(full);

    crowd.setQuality(0, 12); // nunca zera (mínimo 1)
    expect(crowd.mesh.count).toBe(1);
  });

  it('densidade inicial do construtor também vira prefixo', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fullCrowd = new Crowd(stubArena(), 1, 20);
    const halfCrowd = new Crowd(stubArena(), 0.5, 20);
    expect(halfCrowd.mesh.count).toBeLessThan(fullCrowd.mesh.count);
    random.mockRestore();
  });
});

describe('advanceCrowdTick', () => {
  it('não dispara antes do intervalo', () => {
    const r = advanceCrowdTick(0, 0.01, 1 / 20);
    expect(r.fire).toBe(false);
    expect(r.accum).toBeCloseTo(0.01);
  });

  it('dispara ao atingir o intervalo, com resíduo abaixo do intervalo', () => {
    const interval = 1 / 20; // 0.05s
    let accum = 0;
    let fired = false;
    let residual = 0;
    // passos de 0.02 acumulam 0.02, 0.04, 0.06 — cruzam no terceiro
    for (const dt of [0.02, 0.02, 0.02]) {
      const r = advanceCrowdTick(accum, dt, interval);
      accum = r.accum;
      if (r.fire) {
        fired = true;
        residual = r.accum;
        break;
      }
    }
    expect(fired).toBe(true);
    expect(residual).toBeGreaterThanOrEqual(0);
    expect(residual).toBeLessThan(interval);
  });

  it('tickHz maior dispara mais vezes que tickHz menor', () => {
    const frames = 30;
    const dt = 1 / 60;
    const countFires = (interval: number): number => {
      let accum = 0;
      let n = 0;
      for (let i = 0; i < frames; i++) {
        const r = advanceCrowdTick(accum, dt, interval);
        accum = r.accum;
        if (r.fire) n++;
      }
      return n;
    };
    const firesHigh = countFires(1 / 20); // 20 Hz
    const firesLow = countFires(1 / 12); // 12 Hz
    expect(firesHigh).toBeGreaterThan(firesLow); // menor Hz => menos fires
  });

  it('intervalo <= 0 sempre dispara', () => {
    expect(advanceCrowdTick(0, 0.001, 0).fire).toBe(true);
    expect(advanceCrowdTick(5, 0.001, -1).fire).toBe(true);
  });

  it('não estoura em stall grande (vários intervalos num frame = um disparo)', () => {
    const interval = 1 / 20; // 0.05s
    const r = advanceCrowdTick(0, 1.0, interval); // dt gigante = 20 intervalos
    expect(r.fire).toBe(true);
    expect(r.accum).toBeLessThan(interval); // resíduo limitado, não acumula atraso
  });
});

// instanceMatrix.needsUpdate é setter-only no THREE (ler retorna undefined); o sinal
// observável de que o loop pesado rodou é o contador `version`, incrementado a cada
// `needsUpdate = true`.
describe('Crowd — throttle do loop pesado', () => {
  it('não reenvia instanceMatrix num frame abaixo do intervalo', () => {
    const crowd = new Crowd(stubArena(), 1, 20); // intervalo = 0.05s
    const v0 = crowd.mesh.instanceMatrix.version;
    crowd.update(0.01); // < 0.05 => não dispara o loop
    expect(crowd.mesh.instanceMatrix.version).toBe(v0);
  });

  it('reenvia instanceMatrix ao completar o intervalo', () => {
    const crowd = new Crowd(stubArena(), 1, 20);
    const v0 = crowd.mesh.instanceMatrix.version;
    crowd.update(0.03); // acumula 0.03, ainda não dispara
    expect(crowd.mesh.instanceMatrix.version).toBe(v0);
    crowd.update(0.03); // total 0.06 >= 0.05 => dispara o loop pesado
    expect(crowd.mesh.instanceMatrix.version).toBeGreaterThan(v0);
  });

  it('empolgação decai a cada frame mesmo sem disparar o loop', () => {
    const crowd = new Crowd(stubArena(), 1, 20);
    const antes = crowd.excitement;
    const v0 = crowd.mesh.instanceMatrix.version;
    // vários dt pequenos que somados ficam abaixo do intervalo (não disparam o loop)
    crowd.update(0.01);
    crowd.update(0.01);
    crowd.update(0.01);
    expect(crowd.mesh.instanceMatrix.version).toBe(v0); // confirma que o loop não rodou
    expect(crowd.excitement).toBeLessThan(antes); // o barato (decaimento) roda sempre
  });
});
