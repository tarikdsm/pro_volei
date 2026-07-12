import * as THREE from 'three';
import type { CharAction, CharFactory, CharVisual } from '../../entities/PlayerCharacter';

/** Personagem lógico sem geometria, materiais, texturas ou acesso ao DOM. */
export class HeadlessCharacter implements CharVisual {
  readonly root = new THREE.Group();
  moveSpeed = 0;
  jumpY = 0;
  action: CharAction = 'idle';

  setAction(action: CharAction): void {
    this.action = action;
  }

  update(_dt: number): void {}

  presentJump(jumpY: number): void {
    this.jumpY = jumpY;
  }
}

export const createHeadlessCharacter: CharFactory = () => new HeadlessCharacter();
