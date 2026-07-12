import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Ball } from './Ball';

describe('Ball.launch', () => {
  it('preserva o snapshot do início do tick para interpolar até o contato', () => {
    const ball = Object.create(Ball.prototype) as Ball;
    Object.assign(ball, {
      pos: new THREE.Vector3(1, 2, 3),
      previousPos: new THREE.Vector3(-1, 1, 0),
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      inFlight: false,
      bouncy: true,
    });

    ball.launch(new THREE.Vector3(2, 3, 4), new THREE.Vector3(5, 6, 7));

    const previous = (ball as unknown as { previousPos: THREE.Vector3 }).previousPos;
    expect(previous.toArray()).toEqual([-1, 1, 0]);
    expect(ball.pos.toArray()).toEqual([2, 3, 4]);
    expect(ball.vel.toArray()).toEqual([5, 6, 7]);
  });
});
