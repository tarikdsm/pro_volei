import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Team, Athlete } from './Team';
import { TeamSide, BASE_SLOTS, SETTER_SPOT, PLAYER } from '../core/constants';
import type { CharFactory, CharVisual, CharLook, CharAction } from '../entities/PlayerCharacter';

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

  it('usa uma única malha instanciada para as seis sombras blob', () => {
    const team = new Team(TeamSide.HOME, stubFactory, true);
    const blobs = team.group.children.filter((child) => child instanceof THREE.InstancedMesh);

    expect(blobs).toHaveLength(1);
    expect((blobs[0] as THREE.InstancedMesh).count).toBe(6);
  });

  it('desliga sombras dinâmicas preservando apenas malhas sólidas ao reativar', () => {
    const solids: THREE.Mesh[] = [];
    const decals: THREE.Mesh[] = [];
    const team = new Team(TeamSide.HOME, () => {
      const root = new THREE.Group();
      const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
      solid.castShadow = true;
      root.add(solid, decal);
      solids.push(solid);
      decals.push(decal);
      return { ...stubFactory({} as CharLook), root };
    });

    team.setDynamicShadows(false);
    expect(solids.every((mesh) => !mesh.castShadow)).toBe(true);
    team.setDynamicShadows(true);
    expect(solids.every((mesh) => mesh.castShadow)).toBe(true);
    expect(decals.every((mesh) => !mesh.castShadow)).toBe(true);
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

  it('localiza o slot e a base atual da atleta mesmo após rodar', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    const athlete = team.athletes[0]!;

    expect(team.slotIndexOf(athlete)).toBe(0);
    expect(team.basePositionOf(athlete)).toEqual(team.slotPos(0));

    team.rotate();

    expect(team.slotIndexOf(athlete)).toBe(1);
    expect(team.basePositionOf(athlete)).toEqual(team.slotPos(1));
  });

  it('aceita uma política de velocidade máxima por atleta', () => {
    const team = new Team(TeamSide.HOME, stubFactory);
    team.athletes[0].moveTo(8, 3);
    team.athletes[1].moveTo(8, 0);

    team.update(0.1, (athlete) => (athlete.index === 0 ? 1 : 2));

    expect(team.athletes[0].char.moveSpeed).toBeCloseTo(1, 6);
    expect(team.athletes[1].char.moveSpeed).toBeCloseTo(2, 6);
  });

  it('aplica uniforme às seis atletas sem alterar o estado lógico', () => {
    const calls: [number, number][] = [];
    const team = new Team(TeamSide.HOME, (look) => ({
      ...stubFactory(look),
      setUniform: (jersey, shorts) => calls.push([jersey, shorts]),
    }));
    const before = team.athletes.map((athlete) => ({
      position: athlete.pos.toArray(),
      jumpY: athlete.jumpY,
      speedMul: athlete.speedMul,
    }));

    team.setUniform({ jersey: 0x00a8a8, shorts: 0x092b4c });

    expect(calls).toEqual(Array.from({ length: 6 }, () => [0x00a8a8, 0x092b4c]));
    expect(
      team.athletes.map((athlete) => ({
        position: athlete.pos.toArray(),
        jumpY: athlete.jumpY,
        speedMul: athlete.speedMul,
      })),
    ).toEqual(before);
  });
});

// Dublê que registra a última ação pedida ao visual — permite observar o flag
// `moving` (run/idle) de Athlete.update sem tocar em DOM.
interface RecordingChar extends CharVisual {
  lastAction: CharAction;
}
function makeRecordingChar(): RecordingChar {
  const char: RecordingChar = {
    root: new THREE.Group(),
    moveSpeed: 0,
    jumpY: 0,
    lastAction: 'idle',
    setAction(a) {
      char.lastAction = a;
    },
    update() {},
  };
  return char;
}
function makeAthlete(side: TeamSide = TeamSide.HOME): { athlete: Athlete; char: RecordingChar } {
  const char = makeRecordingChar();
  const look: CharLook = { jersey: 0, shorts: 0, skin: 0, hair: 0, number: 1 };
  const athlete = new Athlete(side, 0, look, () => char);
  return { athlete, char };
}

describe('Athlete.update (movimento cinemático sem alocação por tick)', () => {
  it('acelera rumo ao alvo sem desviar do eixo', () => {
    const { athlete, char } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(10, 0);
    athlete.beginFixedStep();
    athlete.update(0.1, 6);
    expect(athlete.pos.x).toBeCloseTo(0.31, 6);
    expect(athlete.pos.z).toBeCloseTo(0, 6);
    expect(athlete.velocity.x).toBeCloseTo(3.1, 6);
    expect(char.lastAction).toBe('run');
    expect(char.moveSpeed).toBeCloseTo(3.1, 6);
  });

  it('atinge a velocidade máxima em cerca de 200 ms', () => {
    const { athlete } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(20, 0);

    for (let tick = 0; tick < 12; tick++) athlete.update(1 / 60, PLAYER.speed);

    expect(Math.hypot(athlete.velocity.x, athlete.velocity.z)).toBeCloseTo(PLAYER.speed, 5);
  });

  it('present interpola o visual sem alterar a posição lógica', () => {
    const { athlete, char } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(10, 0);
    athlete.update(0.1, 6);

    athlete.present(0.5);

    expect(athlete.pos.x).toBeCloseTo(0.31);
    expect(char.root.position.x).toBeCloseTo(0.155);
    athlete.present(0.5);
    expect(athlete.pos.x).toBeCloseTo(0.31);
  });

  it('warp sincroniza previous/current e não deixa ghosting', () => {
    const { athlete, char } = makeAthlete();
    athlete.moveTo(10, 0);
    athlete.update(0.1, 6);
    expect(athlete.velocity.x).toBeGreaterThan(0);
    athlete.warpTo(5, -2);

    athlete.present(0);

    expect(char.root.position.x).toBe(5);
    expect(char.root.position.z).toBe(-2);
    expect(athlete.velocity.x).toBe(0);
    expect(athlete.velocity.z).toBe(0);
  });

  it('não ultrapassa o alvo: o passo é limitado à distância (Caso 2)', () => {
    const { athlete } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(0.3, 0);
    // dt grande: speed*dt >> dist, então step = dist e o atleta para no alvo
    athlete.update(1, 6);
    expect(athlete.pos.x).toBeLessThanOrEqual(0.3);
    expect(athlete.pos.x).toBeCloseTo(0.3, 6);
  });

  it('dentro da zona morta (<0.06 m) não se move e fica idle (Caso 3)', () => {
    const { athlete, char } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(0.04, 0);
    athlete.update(0.1, 6);
    expect(athlete.pos.x).toBeCloseTo(0, 6);
    expect(char.lastAction).toBe('idle'); // moving == false
    expect(char.moveSpeed).toBe(0);
  });

  it('no ar o avanço cai para 0.25x do valor em solo (Caso 4)', () => {
    const { athlete } = makeAthlete();
    athlete.warpTo(0, 0);
    athlete.moveTo(10, 0);
    athlete.jump(); // torna o atleta aéreo antes do update
    athlete.update(0.1, 6);
    expect(athlete.pos.x).toBeCloseTo(0.0775, 6);
  });

  it('a velocidade é por instância: dois atletas não se contaminam', () => {
    const a = makeAthlete();
    const b = makeAthlete();
    a.athlete.warpTo(0, 0);
    a.athlete.moveTo(10, 0); // A anda só no eixo +x
    b.athlete.warpTo(0, 0);
    b.athlete.moveTo(0, 10); // B anda só no eixo +z
    // atualiza intercalado por vários frames (como no loop do jogo)
    for (let i = 0; i < 3; i++) {
      a.athlete.update(0.1, 6);
      b.athlete.update(0.1, 6);
    }
    // cada um seguiu apenas o seu eixo — nenhuma contaminação cruzada
    expect(a.athlete.pos.x).toBeGreaterThan(0);
    expect(a.athlete.pos.z).toBeCloseTo(0, 6);
    expect(b.athlete.pos.z).toBeGreaterThan(0);
    expect(b.athlete.pos.x).toBeCloseTo(0, 6);
    expect(a.athlete.velocity).not.toBe(b.athlete.velocity);
    expect(a.athlete.velocity.z).toBeCloseTo(0);
    expect(b.athlete.velocity.x).toBeCloseTo(0);
  });
});
