import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RiggedCharacter } from './RiggedCharacter';
import type { CharAction } from '../PlayerCharacter';

const LOOK = {
  jersey: 0x1565e8,
  shorts: 0x0c2f6b,
  skin: 0xe8b98a,
  hair: 0xa87848,
  number: 7,
  hairstyle: 'ponytail' as const,
};

describe('RiggedCharacter', () => {
  it('constrói headless (sem DOM) com decal desligado', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    expect(char.root).toBeInstanceOf(THREE.Group);
    let skinned = 0;
    char.root.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1;
    });
    expect(skinned).toBe(5);
  });

  it('cumpre o contrato CharVisual: ações, update determinístico e presentJump', () => {
    const a = new RiggedCharacter(LOOK, { decalTexture: null });
    const b = new RiggedCharacter(LOOK, { decalTexture: null });
    const actions: CharAction[] = [
      'idle',
      'run',
      'bump',
      'set',
      'spikeWindup',
      'spikeHit',
      'block',
      'serveToss',
      'serveHit',
      'dive',
      'celebrate',
      'dejected',
    ];
    for (const action of actions) {
      a.setAction(action);
      b.setAction(action);
      a.update(1 / 60);
      b.update(1 / 60);
    }
    const rotations = (char: RiggedCharacter) => {
      const out: number[] = [];
      char.root.traverse((object) => {
        if ((object as THREE.Bone).isBone) {
          out.push(object.rotation.x, object.rotation.y, object.rotation.z);
        }
      });
      return out;
    };
    expect(rotations(b)).toEqual(rotations(a)); // mesmo input ⇒ mesma pose (determinístico)
    a.presentJump(0.8);
    const body = a.root.children[0] as THREE.Group;
    expect(body.position.y).toBeCloseTo(0.8, 6);
  });

  it('poses distintas movem juntas distintas (spikeWindup arma o braço de ataque)', () => {
    const idle = new RiggedCharacter(LOOK, { decalTexture: null });
    const spike = new RiggedCharacter(LOOK, { decalTexture: null });
    idle.setAction('idle');
    spike.setAction('spikeWindup');
    for (let i = 0; i < 30; i += 1) {
      idle.update(1 / 60);
      spike.update(1 / 60);
    }
    const armOf = (char: RiggedCharacter) => {
      let rotation = 0;
      char.root.traverse((object) => {
        if ((object as THREE.Bone).isBone && object.name === 'upperArmR') {
          rotation = object.rotation.x;
        }
      });
      return rotation;
    };
    expect(Math.abs(armOf(spike) - armOf(idle))).toBeGreaterThan(0.5);
  });

  it('avança somente pelo dt recebido: dt zero não altera a pose', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    char.setAction('run');
    char.moveSpeed = 5;
    for (let i = 0; i < 10; i += 1) char.update(1 / 60);
    const before: number[] = [];
    char.root.traverse((object) => {
      if ((object as THREE.Bone).isBone) before.push(object.rotation.x);
    });
    char.update(0);
    const after: number[] = [];
    char.root.traverse((object) => {
      if ((object as THREE.Bone).isBone) after.push(object.rotation.x);
    });
    expect(after).toEqual(before);
  });
});
