import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Team } from './Team';
import { TeamSide, BASE_SLOTS, SETTER_SPOT } from '../core/constants';
import type { CharFactory, CharVisual, CharLook } from '../entities/PlayerCharacter';

// Dublê visual: implementa só a superfície mínima que Athlete/Team consomem,
// sem tocar em document/canvas. Isso é o que permite instanciar Team no
// ambiente Node do Vitest (o PlayerCharacter real usa DOM em makeJerseyTexture).
const stubFactory: CharFactory = (_look: CharLook): CharVisual => ({
  root: new THREE.Group(),
  moveSpeed: 0,
  jumpY: 0,
  setAction() {},
  update() {},
});

describe('Team (modelo lógico desacoplado do visual)', () => {
  it('instancia sem DOM e monta 6 atletas', () => {
    expect(() => new Team(TeamSide.HOME, stubFactory)).not.toThrow();
    const team = new Team(TeamSide.HOME, stubFactory);
    expect(team.athletes.length).toBe(6);
  });

  it('chama a factory visual 6 vezes', () => {
    let calls = 0;
    const counting: CharFactory = (look) => {
      calls++;
      return stubFactory(look);
    };
    new Team(TeamSide.AWAY, counting);
    expect(calls).toBe(6);
  });

  it('server() e rotate() seguem o rodízio', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    expect(team.slots).toEqual([0, 1, 2, 3, 4, 5]);
    expect(team.server().index).toBe(0);
    team.rotate();
    expect(team.slots).toEqual([5, 0, 1, 2, 3, 4]);
    expect(team.server().index).toBe(5);
  });

  it('resetLineup() restaura o rodízio inicial após rotações', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    team.rotate();
    team.rotate();
    expect(team.slots).not.toEqual([0, 1, 2, 3, 4, 5]);
    team.resetLineup();
    expect(team.slots).toEqual([0, 1, 2, 3, 4, 5]);
    expect(team.server().index).toBe(0);
  });

  it('resetLineup() reposiciona (warp) cada atleta na base do seu slot', () => {
    const team = new Team(TeamSide.AWAY, stubFactory);
    team.rotate();
    // move alguém para longe da base para provar que o reset reposiciona
    team.athletes[0].warpTo(50, 50);
    team.resetLineup();
    for (let i = 0; i < 6; i++) {
      const a = team.athletes[team.slots[i]];
      const p = team.slotPos(i);
      expect(a.pos.x).toBeCloseTo(p.x);
      expect(a.pos.z).toBeCloseTo(p.z);
    }
  });

  it('frontRow()/backRow() indexam pelos slots corretos, antes e depois do rodízio', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    const front = () => team.frontRow().map((a) => a.index);
    const back = () => team.backRow().map((a) => a.index);
    expect(front()).toEqual([team.slots[3], team.slots[4], team.slots[5]]);
    expect(back()).toEqual([team.slots[0], team.slots[1], team.slots[2]]);
    team.rotate();
    expect(front()).toEqual([team.slots[3], team.slots[4], team.slots[5]]);
    expect(back()).toEqual([team.slots[0], team.slots[1], team.slots[2]]);
  });

  it('slotPos() usa a base para HOME e o espelhamento para AWAY', () => {
    const home = new Team(TeamSide.HOME, stubFactory);
    const away = new Team(TeamSide.AWAY, stubFactory);
    for (let i = 0; i < 6; i++) {
      expect(home.slotPos(i)).toEqual({ x: BASE_SLOTS[i].x, z: BASE_SLOTS[i].z });
      expect(away.slotPos(i)).toEqual({ x: -BASE_SLOTS[i].x, z: -BASE_SLOTS[i].z });
    }
  });

  it('setterSpot() usa o valor direto para HOME e o negado para AWAY', () => {
    const home = new Team(TeamSide.HOME, stubFactory);
    const away = new Team(TeamSide.AWAY, stubFactory);
    expect(home.setterSpot()).toEqual({ x: SETTER_SPOT.x, z: SETTER_SPOT.z });
    expect(away.setterSpot()).toEqual({ x: -SETTER_SPOT.x, z: -SETTER_SPOT.z });
  });

  it('resetToBase(true) posiciona cada atleta na base do seu slot', () => {
    const team = new Team(TeamSide.AWAY, stubFactory);
    team.resetToBase(true);
    for (let i = 0; i < 6; i++) {
      const a = team.athletes[team.slots[i]];
      const p = team.slotPos(i);
      expect(a.pos.x).toBeCloseTo(p.x);
      expect(a.pos.z).toBeCloseTo(p.z);
    }
  });

  it('nearestTo() retorna o mais próximo e respeita o exclude', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    team.athletes[0].warpTo(0, 0);
    team.athletes[1].warpTo(1, 0);
    // os demais para longe, para não competir pela proximidade
    for (let i = 2; i < 6; i++) team.athletes[i].warpTo(100, 100);
    expect(team.nearestTo(0.1, 0)).toBe(team.athletes[0]);
    expect(team.nearestTo(0.1, 0, team.athletes[0])).toBe(team.athletes[1]);
  });

  it('nearestFrontRowTo() escolhe pelo menor |z| e respeita o exclude', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    const fr = team.frontRow();
    fr[0].warpTo(0, -3);
    fr[1].warpTo(0, 0);
    fr[2].warpTo(0, 3);
    expect(team.nearestFrontRowTo(-1)).toBe(fr[1]);
    expect(team.nearestFrontRowTo(-1, fr[1])).toBe(fr[0]);
  });
});
