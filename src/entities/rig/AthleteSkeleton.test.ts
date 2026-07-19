import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildAthleteSkeleton } from './AthleteSkeleton';

describe('buildAthleteSkeleton', () => {
  it('monta 20 ossos com hierarquia e índices consistentes', () => {
    const rig = buildAthleteSkeleton();
    expect(rig.skeleton.bones).toHaveLength(20);
    expect(rig.joints.hips).toBe(rig.rootBone);
    expect(rig.joints.shinL.parent).toBe(rig.joints.thighL);
    expect(rig.joints.forearmR.parent).toBe(rig.joints.upperArmR);
    expect(rig.joints.head.parent).toBe(rig.joints.neck);
    for (const [name, bone] of Object.entries(rig.joints)) {
      expect(rig.skeleton.bones[rig.boneIndex[name as keyof typeof rig.boneIndex]]).toBe(bone);
      expect(bone.name).toBe(name); // nome da junta no osso (usado por testes e debug)
    }
  });

  it('hairTail é o último osso e filho de head', () => {
    const rig = buildAthleteSkeleton();
    expect(rig.boneIndex.hairTail).toBe(19);
    expect(rig.joints.hairTail.parent).toBe(rig.joints.head);
  });

  it('é simétrico em x e alcança altura de cabeça ~1,54 m no rest pose', () => {
    const rig = buildAthleteSkeleton();
    rig.rootBone.updateMatrixWorld(true);
    const world = (bone: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    expect(world(rig.joints.thighL).x).toBeCloseTo(-world(rig.joints.thighR).x, 6);
    expect(world(rig.joints.handL).x).toBeCloseTo(-world(rig.joints.handR).x, 6);
    expect(world(rig.joints.head).y).toBeCloseTo(1.54, 2);
    expect(world(rig.joints.footL).y).toBeCloseTo(0.07, 2);
  });

  it('boneInverses refletem o rest pose (regressão: skeleton criado sem matrixWorld)', () => {
    const rig = buildAthleteSkeleton();
    // O inverso do bind do osso deve levar a posição de mundo do rest pose à origem do osso.
    const headInverse = rig.skeleton.boneInverses[rig.boneIndex.head];
    const headRest = new THREE.Vector3(0, 1.54, 0).applyMatrix4(headInverse);
    expect(headRest.length()).toBeLessThan(1e-6);
    const footInverse = rig.skeleton.boneInverses[rig.boneIndex.footL];
    const footRest = new THREE.Vector3(0.1, 0.07, 0.04).applyMatrix4(footInverse);
    expect(footRest.length()).toBeLessThan(1e-6);
  });

  it('heightScale alonga o esqueleto preservando simetria e boneInverses', () => {
    const rig = buildAthleteSkeleton({ heightScale: 1.06 });
    rig.rootBone.updateMatrixWorld(true);
    const world = (bone: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    expect(world(rig.joints.head).y).toBeCloseTo(1.54 * 1.06, 2);
    expect(world(rig.joints.thighL).x).toBeCloseTo(-world(rig.joints.thighR).x, 6);
    // boneInverses acompanham a escala: inverso do head leva o rest escalado à origem.
    const headRest = new THREE.Vector3(0, 1.54 * 1.06, 0).applyMatrix4(
      rig.skeleton.boneInverses[rig.boneIndex.head],
    );
    expect(headRest.length()).toBeLessThan(1e-6);
  });

  it('buildScale alarga ombros e quadris', () => {
    const wide = buildAthleteSkeleton({ buildScale: 1.1 });
    const base = buildAthleteSkeleton();
    expect(Math.abs(wide.joints.shoulderL.position.x)).toBeCloseTo(
      Math.abs(base.joints.shoulderL.position.x) * 1.1,
      6,
    );
  });

  it('duas construções são independentes (sem estado compartilhado)', () => {
    const a = buildAthleteSkeleton();
    const b = buildAthleteSkeleton();
    a.joints.head.rotation.x = 1;
    expect(b.joints.head.rotation.x).toBe(0);
  });
});
