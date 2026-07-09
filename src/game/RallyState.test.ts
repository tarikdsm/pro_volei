import { describe, it, expect } from 'vitest';
import { TeamSide } from '../core/constants';
import { RallyState, TouchPlan } from './RallyState';
import type { Athlete } from './Team';

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

  it('começa sem campos de planejamento definidos', () => {
    const r = new RallyState();
    expect(r.setterHold).toBe(null);
    expect(r.plannedAttacker).toBe(null);
    expect(r.lastToucher).toBe(null);
    expect(r.blockers).toEqual([]);
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

  it('limpa o planejamento (bloqueadores agendados + ponteiros do próximo toque) entre pontos', () => {
    // simula um agendamento de bloqueio e ponteiros vivos ao fim do rally anterior
    const r = new RallyState();
    r.blockers = [{ athlete: {} as Athlete, jumpIn: 0.3, jumped: false }];
    r.setterHold = {} as Athlete;
    r.plannedAttacker = {} as Athlete;
    r.lastToucher = {} as Athlete;

    r.reset();

    expect(r.blockers).toEqual([]); // sem pulo fantasma no próximo rally
    expect(r.setterHold).toBe(null);
    expect(r.plannedAttacker).toBe(null);
    expect(r.lastToucher).toBe(null);
  });
});

describe('RallyState.excludedPasser', () => {
  it('exclui o último tocador quando a bola replaneja pass no mesmo lado', () => {
    const a = {} as Athlete;
    const r = new RallyState();
    r.lastTouchTeam = TeamSide.HOME;
    r.lastKind = 'pass';
    r.lastToucher = a;
    expect(r.excludedPasser(TeamSide.HOME)).toBe(a);
  });

  it('exclui o último tocador quando a cortada bate na rede e volta ao mesmo lado', () => {
    const a = {} as Athlete;
    const r = new RallyState();
    r.lastTouchTeam = TeamSide.HOME;
    r.lastKind = 'spike';
    r.lastToucher = a;
    expect(r.excludedPasser(TeamSide.HOME)).toBe(a);
  });

  it('não exclui o bloqueador: após bloqueio ele pode jogar a própria sobra', () => {
    const a = {} as Athlete;
    const r = new RallyState();
    r.lastTouchTeam = TeamSide.HOME;
    r.lastKind = 'block';
    r.lastToucher = a;
    expect(r.excludedPasser(TeamSide.HOME)).toBeUndefined();
  });

  it('não afeta a recepção/defesa do adversário quando a bola cruzou de lado', () => {
    const a = {} as Athlete;
    const r = new RallyState();
    r.lastTouchTeam = TeamSide.HOME;
    r.lastKind = 'spike';
    r.lastToucher = a;
    expect(r.excludedPasser(TeamSide.AWAY)).toBeUndefined();
  });

  it('normaliza para undefined quando não há tocador registrado', () => {
    const r = new RallyState();
    r.lastTouchTeam = TeamSide.HOME;
    r.lastKind = 'pass';
    r.lastToucher = null;
    expect(r.excludedPasser(TeamSide.HOME)).toBeUndefined();
  });
});

describe('RallyState — reset de posse no bloqueio libera o próximo toque', () => {
  it('após o toque de bloqueio (posse zerada), o guard de planNext deixa de valer', () => {
    // A cortada chega como 3º toque do atacante (AWAY); o bloqueio zera a posse (block.ts).
    const r = new RallyState();
    r.countTouch(TeamSide.AWAY);
    r.countTouch(TeamSide.AWAY);
    r.countTouch(TeamSide.AWAY);
    expect(r.touchesOf(TeamSide.AWAY)).toBe(3);

    // reset central do bloqueio (toque de bloqueio não conta p/ nenhum lado)
    r.possessionTeam = null;
    r.possessionTouches = 0;

    // a bola do stuff cai no lado do atacante (landSide = AWAY); o guard de planNext é
    // (possessionTeam === landSide && possessionTouches >= 3): agora possessionTeam é null,
    // então a condição não é mais satisfeita e a defesa (dig) passa a ser agendada.
    expect(r.touchesOf(TeamSide.AWAY)).toBe(0);
    expect(r.possessionTeam === TeamSide.AWAY && r.possessionTouches >= 3).toBe(false);
  });
});
