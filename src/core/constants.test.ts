import { describe, it, expect } from 'vitest';
import {
  ACTION_BUTTON,
  BLOCK,
  HUMAN_TIMING,
  PLAYER,
  SERVE_TUNING,
  SIMULATION_TIMING,
} from './constants';
import * as C from './constants';

// Invariantes baratas de tuning: guardam contra edições que quebrem os pressupostos das
// fórmulas de bloqueio/timing/saque (thresholds em [0,1], slopes > 0, ranges ordenados).
describe('BLOCK — invariantes de tuning', () => {
  it('limiares de proximidade em [0,1] e stuff antes de soft', () => {
    for (const t of [BLOCK.stuffThreshold, BLOCK.softThreshold]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(BLOCK.stuffThreshold).toBeLessThan(BLOCK.softThreshold);
  });

  it('geometria e alcance positivos', () => {
    expect(BLOCK.window).toBeGreaterThan(0);
    expect(BLOCK.nearNetX).toBeGreaterThan(0);
    expect(BLOCK.zReach).toBeGreaterThan(0);
    expect(BLOCK.netX).toBeGreaterThan(0);
    expect(BLOCK.jumpReachFactor).toBeGreaterThan(0);
  });

  it('faixa de atraso do pulo bem-ordenada e não-negativa', () => {
    expect(BLOCK.jumpDelayRange[0]).toBeGreaterThanOrEqual(0);
    expect(BLOCK.jumpDelayRange[0]).toBeLessThanOrEqual(BLOCK.jumpDelayRange[1]);
  });
});

describe('HUMAN_TIMING — invariantes de tuning', () => {
  it('slopes positivos (senão a qualidade nunca decai)', () => {
    expect(HUMAN_TIMING.receiveSlope).toBeGreaterThan(0);
    expect(HUMAN_TIMING.jumpSlope).toBeGreaterThan(0);
  });

  it('sweet-spots não-negativos', () => {
    expect(HUMAN_TIMING.receiveSweet).toBeGreaterThanOrEqual(0);
    expect(HUMAN_TIMING.jumpSweet).toBeGreaterThanOrEqual(0);
  });

  it('qualidade do toque permanece em [0,1] e penalidade em (0,1]', () => {
    expect(HUMAN_TIMING.contactBase).toBeGreaterThanOrEqual(0);
    expect(HUMAN_TIMING.contactBase + HUMAN_TIMING.contactSpan).toBeLessThanOrEqual(1);
    expect(HUMAN_TIMING.hardPenalty).toBeGreaterThan(0);
    expect(HUMAN_TIMING.hardPenalty).toBeLessThanOrEqual(1);
  });
});

describe('SERVE_TUNING — invariantes de tuning', () => {
  it('zona perfeita bem-ordenada dentro de [0,1]', () => {
    expect(SERVE_TUNING.perfectLo).toBeGreaterThan(0);
    expect(SERVE_TUNING.perfectLo).toBeLessThan(SERVE_TUNING.perfectHi);
    expect(SERVE_TUNING.perfectHi).toBeLessThanOrEqual(1);
  });

  it('folga sobre a rede cai com a força (hi > lo)', () => {
    expect(SERVE_TUNING.clearanceHi).toBeGreaterThan(SERVE_TUNING.clearanceLo);
  });

  it('jitter ordenado e taxa/potência positivas', () => {
    expect(SERVE_TUNING.clearanceJitter[0]).toBeLessThanOrEqual(SERVE_TUNING.clearanceJitter[1]);
    expect(SERVE_TUNING.chargeRate).toBeGreaterThan(0);
    expect(SERVE_TUNING.perfectPower).toBeGreaterThan(0);
    expect(SERVE_TUNING.perfectPower).toBeLessThanOrEqual(1);
  });
});

describe('SIMULATION_TIMING — invariantes do passo fixo', () => {
  it('fixa a simulação em 60 Hz com os limites anti-stall aprovados', () => {
    expect(SIMULATION_TIMING).toEqual({
      hz: 60,
      maxRealFrame: 0.25,
      maxStepsPerFrame: 5,
    });
  });
});

describe('ACTION_BUTTON — gramática temporal a 60 Hz', () => {
  it('fixa tap, buffer, carga e direção deliberada aprovados', () => {
    expect(ACTION_BUTTON).toEqual({
      tapTicks: 12,
      bufferTicks: 9,
      fullChargeTicks: 30,
      deliberateDirection: 0.35,
    });
  });
});

describe('PLAYER — cinemática planar', () => {
  it('usa aceleração responsiva e frenagem mais forte', () => {
    expect(PLAYER.acceleration).toBeCloseTo(PLAYER.speed / 0.2);
    expect(PLAYER.deceleration).toBeGreaterThan(PLAYER.acceleration);
  });
});

// Guarda de regressão contra a reintrodução dos enums mortos GameState/RallyPhase (removidos no
// B12): eram residuos pré-refatoração sem nenhum uso. O estado da partida vive em MState (Match)
// e a fase do rally em TouchKind + campos de RallyState. Enums geram propriedades de runtime no
// objeto de módulo, então a ausência é observável (um type/interface não seria).
describe('constants — enums mortos removidos', () => {
  it('não reexpõe GameState nem RallyPhase', () => {
    expect('GameState' in C).toBe(false);
    expect('RallyPhase' in C).toBe(false);
  });

  it('preserva símbolos vivos (TeamSide e helpers de lado)', () => {
    expect(C.TeamSide.HOME).toBe(0);
    expect(C.TeamSide.AWAY).toBe(1);
    expect(typeof C.sideSign).toBe('function');
    expect(typeof C.otherSide).toBe('function');
  });
});
