import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceCrowdMood, computeCrowdSpots, initialCrowdMood } from './Crowd';

describe('advanceCrowdMood', () => {
  it('a empolgação decai até o piso 0.12', () => {
    let mood = { ...initialCrowdMood(), excitement: 0.5 };
    for (let i = 0; i < 600; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.excitement).toBeCloseTo(0.12, 5);
  });

  it('dispara a ola espontânea após 25 s de jogo animado e a percorre até o fim', () => {
    let mood = { ...initialCrowdMood(), excitement: 1 };
    for (let i = 0; i < 26 * 60; i += 1) {
      mood = advanceCrowdMood(mood, 1 / 60);
      mood = { ...mood, excitement: 1 }; // jogo segue animado
    }
    expect(mood.waveActive).toBe(true);
    for (let i = 0; i < 10 * 60; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.waveActive).toBe(false);
  });

  it('não dispara ola com a torcida fria', () => {
    let mood = { ...initialCrowdMood(), excitement: 0.2 };
    for (let i = 0; i < 30 * 60; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.waveActive).toBe(false);
  });
});

describe('computeCrowdSpots', () => {
  const stands = [
    {
      origin: new THREE.Vector3(0, 0, 10),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 0.55, 0.9),
      rows: 3,
      cols: 8,
    },
  ];

  it('é determinístico com o rand injetado e respeita assentos vazios', () => {
    let n = 0;
    const rand = () => {
      n = (n * 16807 + 1) % 2147483647;
      return (n % 1000) / 1000;
    };
    const spots = computeCrowdSpots(stands, 0.18, rand);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThan(3 * 8);
    for (const s of spots) {
      expect(Number.isFinite(s.pos.x)).toBe(true);
      expect(Number.isFinite(s.angle)).toBe(true);
    }
  });
});
