import { describe, it, expect } from 'vitest';
import { TeamSide } from '../core/constants';
import { RallyState, TouchPlan } from './RallyState';

describe('RallyState — valores iniciais', () => {
  it('começa sem posse, sem toques e sem plano', () => {
    const r = new RallyState();
    expect(r.possessionTeam).toBe(null);
    expect(r.possessionTouches).toBe(0);
    expect(r.rallyTouches).toBe(0);
    expect(r.lastTouchTeam).toBe(null);
    expect(r.lastKind).toBe('serve');
    expect(r.plan).toBe(null);
    expect(r.netEventIn).toBe(null);
  });
});

describe('RallyState.countTouch', () => {
  it('primeiro toque de um time abre a posse com 1 toque', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.HOME);
    expect(r.possessionTeam).toBe(TeamSide.HOME);
    expect(r.possessionTouches).toBe(1);
  });

  it('toques seguidos do mesmo time incrementam a contagem', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.HOME);
    r.countTouch(TeamSide.HOME);
    r.countTouch(TeamSide.HOME);
    expect(r.possessionTouches).toBe(3);
  });

  it('bola indo para o outro time reinicia a contagem em 1', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.HOME);
    r.countTouch(TeamSide.HOME);
    r.countTouch(TeamSide.AWAY);
    expect(r.possessionTeam).toBe(TeamSide.AWAY);
    expect(r.possessionTouches).toBe(1);
  });
});

describe('RallyState.touchesOf', () => {
  it('devolve os toques do time que está com a posse', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.AWAY);
    r.countTouch(TeamSide.AWAY);
    expect(r.touchesOf(TeamSide.AWAY)).toBe(2);
  });

  it('devolve 0 para o time sem posse', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.AWAY);
    expect(r.touchesOf(TeamSide.HOME)).toBe(0);
  });
});

describe('RallyState.reset', () => {
  it('limpa posse, toques, último toque, plano e evento de rede', () => {
    const r = new RallyState();
    r.countTouch(TeamSide.HOME);
    r.rallyTouches = 5;
    r.lastTouchTeam = TeamSide.HOME;
    r.netEventIn = 0.3;
    r.plan = {} as TouchPlan;

    r.reset();

    expect(r.possessionTeam).toBe(null);
    expect(r.possessionTouches).toBe(0);
    expect(r.rallyTouches).toBe(0);
    expect(r.lastTouchTeam).toBe(null);
    expect(r.netEventIn).toBe(null);
    expect(r.plan).toBe(null);
  });
});
