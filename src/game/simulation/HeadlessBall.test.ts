import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALL_RADIUS, GRAVITY } from '../../core/constants';
import type { BallSimulationPort } from './BallSimulationPort';
import { HeadlessBall } from './HeadlessBall';
import { Ball } from '../../entities/Ball';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HeadlessBall — ciclo de posse', () => {
  it('hold copia a posição, zera a velocidade e mantém a bola fora de voo', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    const position = new THREE.Vector3(2, 3, 4);
    ball.vel.set(5, 6, 7);
    ball.inFlight = true;

    ball.hold(position);
    position.set(9, 9, 9);

    expect(ball.pos.toArray()).toEqual([2, 3, 4]);
    expect(ball.vel.toArray()).toEqual([0, 0, 0]);
    expect(ball.inFlight).toBe(false);
  });

  it('launch copia posição e velocidade, inicia o voo e não usa aleatoriedade', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('HeadlessBall não deve consumir Math.random');
    });
    const position = new THREE.Vector3(-3, 2, 1);
    const velocity = new THREE.Vector3(8, 5, -2);
    ball.bouncy = true;

    ball.launch(position, velocity);
    position.set(9, 9, 9);
    velocity.set(9, 9, 9);

    expect(ball.pos.toArray()).toEqual([-3, 2, 1]);
    expect(ball.vel.toArray()).toEqual([8, 5, -2]);
    expect(ball.inFlight).toBe(true);
    expect(ball.bouncy).toBe(false);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('HeadlessBall — avanço físico', () => {
  it('integra o voo com a mesma solução balística analítica do jogo', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    const dt = 0.25;
    ball.launch(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6));

    ball.step(dt);

    expect(ball.pos.x).toBeCloseTo(1 + 4 * dt, 12);
    expect(ball.pos.y).toBeCloseTo(2 + 5 * dt + 0.5 * GRAVITY * dt ** 2, 12);
    expect(ball.pos.z).toBeCloseTo(3 + 6 * dt, 12);
    expect(ball.vel.toArray()).toEqual([4, 5 + GRAVITY * dt, 6]);
  });

  it('não move a bola mantida fora de voo', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    ball.hold(new THREE.Vector3(1, 2, 3));

    ball.step(1);

    expect(ball.pos.toArray()).toEqual([1, 2, 3]);
    expect(ball.vel.toArray()).toEqual([0, 0, 0]);
  });

  it('quica no piso e amortece os três eixos quando bouncy está ativo', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    const dt = 0.1;
    ball.launch(new THREE.Vector3(0, BALL_RADIUS, 0), new THREE.Vector3(10, -2, 5));
    ball.bouncy = true;

    ball.step(dt);

    expect(ball.pos.y).toBe(BALL_RADIUS);
    expect(ball.vel.x).toBeCloseTo(8.2, 12);
    expect(ball.vel.y).toBeCloseTo(-(-2 + GRAVITY * dt) * 0.55, 12);
    expect(ball.vel.z).toBeCloseTo(4.1, 12);
  });

  it('repousa quando o quique vertical amortecido fica abaixo de 0,8 m/s', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    ball.launch(new THREE.Vector3(0, BALL_RADIUS, 0), new THREE.Vector3(1, -0.1, 1));
    ball.bouncy = true;

    ball.step(0);

    expect(ball.vel.toArray()).toEqual([0, 0, 0]);
  });
});

describe('HeadlessBall — consultas analíticas', () => {
  it('prevê o primeiro cruzamento descendente com o piso', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    ball.launch(new THREE.Vector3(0, 3, 0), new THREE.Vector3(4, 5, -2));
    const a = 0.5 * GRAVITY;
    const b = 5;
    const c = 3 - BALL_RADIUS;
    const expectedTime = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);

    const landing = ball.predictLanding();

    expect(landing.time).toBeCloseTo(expectedTime, 12);
    expect(landing.point.toArray()).toEqual([
      expect.closeTo(4 * expectedTime, 12),
      0,
      expect.closeTo(-2 * expectedTime, 12),
    ]);
  });

  it('calcula o tempo de descida até uma altura técnica', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    ball.launch(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 5, 0));
    const height = 1.05;
    const a = 0.5 * GRAVITY;
    const discriminant = 5 ** 2 - 4 * a * (3 - height);
    const expectedTime = (-5 - Math.sqrt(discriminant)) / (2 * a);

    expect(ball.timeToDescend(height)).toBeCloseTo(expectedTime, 12);
  });

  it('amostra a trajetória no vetor fornecido sem alterar o estado atual', () => {
    const ball: BallSimulationPort = new HeadlessBall();
    ball.launch(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6));
    const out = new THREE.Vector3();

    const result = ball.posAt(0.25, out);

    expect(result).toBe(out);
    expect(out.toArray()).toEqual([
      2,
      expect.closeTo(2 + 5 * 0.25 + 0.5 * GRAVITY * 0.25 ** 2, 12),
      4.5,
    ]);
    expect(ball.pos.toArray()).toEqual([1, 2, 3]);
    expect(ball.vel.toArray()).toEqual([4, 5, 6]);
  });
});

describe('HeadlessBall — paridade com Ball de produção', () => {
  function productionBallLogicOnly(): Ball {
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    };
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
      }),
    });
    return new Ball();
  }

  it('mantém estado, quique e consultas iguais sob a mesma sequência lógica', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const production: BallSimulationPort = productionBallLogicOnly();
    const headless: BallSimulationPort = new HeadlessBall();
    const balls = [production, headless];

    for (const ball of balls) {
      ball.hold(new THREE.Vector3(1, 2, 3));
      ball.launch(new THREE.Vector3(-2, 3, 1), new THREE.Vector3(6, 4, -3));
      ball.step(0.2);
    }

    expect(headless.pos.toArray()).toEqual(production.pos.toArray());
    expect(headless.vel.toArray()).toEqual(production.vel.toArray());
    expect(headless.inFlight).toBe(production.inFlight);
    expect(headless.predictLanding().time).toBe(production.predictLanding().time);
    expect(headless.timeToDescend(1.05)).toBe(production.timeToDescend(1.05));

    for (const ball of balls) {
      ball.launch(new THREE.Vector3(0, BALL_RADIUS, 0), new THREE.Vector3(2, -1, 4));
      ball.bouncy = true;
      ball.step(0.05);
    }
    expect(headless.pos.toArray()).toEqual(production.pos.toArray());
    expect(headless.vel.toArray()).toEqual(production.vel.toArray());
  });
});
