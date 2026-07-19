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

  it('corrida lateral pedala as pernas para o lado (≠ corrida frontal)', () => {
    const frontal = new RiggedCharacter(LOOK, { decalTexture: null });
    const lateral = new RiggedCharacter(LOOK, { decalTexture: null });
    frontal.setAction('run');
    lateral.setAction('run');
    let maxFrontZ = 0;
    let maxLateralZ = 0;
    for (let i = 0; i < 60; i += 1) {
      frontal.setPlanarMotion(3, 0, false);
      lateral.setPlanarMotion(0, 3, false);
      frontal.update(1 / 60);
      lateral.update(1 / 60);
      const zOf = (char: RiggedCharacter) => {
        let z = 0;
        char.root.traverse((object) => {
          if ((object as THREE.Bone).isBone && object.name === 'thighL') z = object.rotation.z;
        });
        return Math.abs(z);
      };
      maxFrontZ = Math.max(maxFrontZ, zOf(frontal));
      maxLateralZ = Math.max(maxLateralZ, zOf(lateral));
    }
    expect(maxLateralZ).toBeGreaterThan(0.1);
    expect(maxFrontZ).toBeLessThan(0.02);
  });

  it('foot planting: pé plantado desliza no máximo 0,15 m quando o root se move', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    char.setAction('idle');
    for (let i = 0; i < 30; i += 1) {
      char.setPlanarMotion(0, 0, false);
      char.update(1 / 60);
    }
    char.root.updateMatrixWorld(true);
    const before = new THREE.Vector3();
    char.root.traverse((object) => {
      if ((object as THREE.Bone).isBone && object.name === 'footL') {
        object.getWorldPosition(before);
      }
    });

    char.root.position.x += 0.2; // desloca o root sem passada (dentro do raio de replante)
    for (let i = 0; i < 20; i += 1) {
      char.setPlanarMotion(0, 0, false);
      char.update(1 / 60);
    }
    char.root.updateMatrixWorld(true);
    const after = new THREE.Vector3();
    char.root.traverse((object) => {
      if ((object as THREE.Bone).isBone && object.name === 'footL') {
        object.getWorldPosition(after);
      }
    });
    expect(after.distanceTo(before)).toBeLessThanOrEqual(0.15);
  });

  it('setContactAim leva a mão a ≤ 0,12 m do alvo alcançável na manchete', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    char.setAction('bump');
    const aim = new THREE.Vector3(0, 1.2, 0.3); // à frente do peito, ao alcance dos braços
    for (let i = 0; i < 60; i += 1) {
      char.setContactAim(aim.x, aim.y, aim.z, 0);
      char.update(1 / 60);
    }
    char.root.updateMatrixWorld(true);
    const hand = new THREE.Vector3();
    char.root.traverse((object) => {
      if ((object as THREE.Bone).isBone && object.name === 'handL') {
        object.getWorldPosition(hand);
      }
    });
    expect(hand.distanceTo(aim)).toBeLessThanOrEqual(0.12);
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

  it('troca somente as cores do uniforme, preservando rig e transformações', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    const before = char.root.toJSON().object;

    char.setUniform(0x00a8a8, 0x092b4c);

    const colors = new Set<number>();
    char.root.traverse((object) => {
      if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const material = (object as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial;
      colors.add(material.color.getHex());
    });
    expect(colors).toContain(0x00a8a8);
    expect(colors).toContain(0x092b4c);
    expect(char.root.toJSON().object).toEqual(before);
  });
});
