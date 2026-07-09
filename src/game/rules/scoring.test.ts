import { describe, it, expect } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  isSetOver,
  setWinner,
  setsNeeded,
  isMatchOver,
  setPointLeader,
  isAce,
  resolveRallyOutcome,
  outOfAntennaWinner,
} from './scoring';

describe('isSetOver', () => {
  it('não acaba antes de atingir a pontuação do set', () => {
    expect(isSetOver(14, 10, 15)).toBe(false);
  });
  it('acaba ao atingir a pontuação com 2 de vantagem', () => {
    expect(isSetOver(15, 13, 15)).toBe(true);
    expect(isSetOver(25, 20, 25)).toBe(true);
  });
  it('exige vantagem de 2 — deuce continua', () => {
    expect(isSetOver(15, 14, 15)).toBe(false);
    expect(isSetOver(16, 15, 15)).toBe(false);
    expect(isSetOver(16, 14, 15)).toBe(true);
  });
});

describe('setWinner', () => {
  it('quem tem mais pontos vence o set', () => {
    expect(setWinner(15, 13)).toBe(TeamSide.HOME);
    expect(setWinner(20, 25)).toBe(TeamSide.AWAY);
  });
});

describe('setsNeeded / isMatchOver', () => {
  it('1 set → precisa de 1', () => {
    expect(setsNeeded(1)).toBe(1);
    expect(isMatchOver(1, 1)).toBe(true);
    expect(isMatchOver(0, 1)).toBe(false);
  });
  it('melhor de 3 → precisa de 2', () => {
    expect(setsNeeded(3)).toBe(2);
    expect(isMatchOver(1, 3)).toBe(false);
    expect(isMatchOver(2, 3)).toBe(true);
  });
});

describe('setPointLeader', () => {
  it('null quando ninguém está a 1 ponto de fechar', () => {
    expect(setPointLeader(10, 8, 15)).toBe(null);
  });
  it('aponta o líder no set point', () => {
    expect(setPointLeader(14, 12, 15)).toBe(TeamSide.HOME);
    expect(setPointLeader(12, 14, 15)).toBe(TeamSide.AWAY);
  });
  it('null no empate (deuce)', () => {
    expect(setPointLeader(14, 14, 15)).toBe(null);
  });
  it('null quando o set já acabou', () => {
    expect(setPointLeader(15, 13, 15)).toBe(null);
  });
  it('na vantagem, segue set point acima da pontuação sem 2 de frente', () => {
    expect(setPointLeader(15, 14, 15)).toBe(TeamSide.HOME);
  });
});

describe('isAce', () => {
  it('saque que ganha direto sem toques é ace', () => {
    expect(isAce('serve', TeamSide.HOME, TeamSide.HOME, 0)).toBe(true);
  });
  it('não é ace se houve toques no rally', () => {
    expect(isAce('serve', TeamSide.HOME, TeamSide.HOME, 3)).toBe(false);
  });
  it('não é ace se o ponto não foi de quem sacou', () => {
    expect(isAce('serve', TeamSide.AWAY, TeamSide.HOME, 0)).toBe(false);
  });
  it('não é ace se o último toque não foi um saque', () => {
    expect(isAce('spike', TeamSide.HOME, TeamSide.HOME, 0)).toBe(false);
  });
});

describe('resolveRallyOutcome', () => {
  it('bola dentro do campo HOME → ponto do AWAY', () => {
    const r = resolveRallyOutcome({ x: -4, z: 0 }, TeamSide.AWAY, TeamSide.AWAY);
    expect(r.inCourt).toBe(true);
    expect(r.landSide).toBe(TeamSide.HOME);
    expect(r.winner).toBe(TeamSide.AWAY);
  });
  it('bola dentro do campo AWAY → ponto do HOME', () => {
    const r = resolveRallyOutcome({ x: 4, z: 0 }, TeamSide.HOME, TeamSide.HOME);
    expect(r.inCourt).toBe(true);
    expect(r.landSide).toBe(TeamSide.AWAY);
    expect(r.winner).toBe(TeamSide.HOME);
  });
  it('bola fora → ponto de quem NÃO tocou por último', () => {
    const r = resolveRallyOutcome({ x: 12, z: 0 }, TeamSide.HOME, TeamSide.HOME);
    expect(r.inCourt).toBe(false);
    expect(r.winner).toBe(TeamSide.AWAY);
  });
  it('bola fora sem toque registrado → ponto de quem não sacou', () => {
    const r = resolveRallyOutcome({ x: 12, z: 0 }, null, TeamSide.HOME);
    expect(r.winner).toBe(TeamSide.AWAY);
  });
});

describe('outOfAntennaWinner', () => {
  it('último toque HOME → ponto do AWAY (recebedor)', () => {
    expect(outOfAntennaWinner(TeamSide.HOME, TeamSide.AWAY)).toBe(TeamSide.AWAY);
  });
  it('último toque AWAY → ponto do HOME (recebedor)', () => {
    expect(outOfAntennaWinner(TeamSide.AWAY, TeamSide.HOME)).toBe(TeamSide.HOME);
  });
  it('saque fora da antena sem toques (lastTouch=null) → ponto do recebedor', () => {
    expect(outOfAntennaWinner(null, TeamSide.HOME)).toBe(TeamSide.AWAY);
  });
});
