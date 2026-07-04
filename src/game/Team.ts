import * as THREE from 'three';
import { PlayerCharacter, CharAction, CharLook } from '../entities/PlayerCharacter';
import { BASE_SLOTS, COLORS, PLAYER, TeamSide, sideSign, SETTER_SPOT } from '../core/constants';

const GRAV = -22; // gravidade do pulo dos atletas (mais pesada = pulos secos)

// Atleta: casca lógica sobre o personagem visual — movimento, pulo, ação com duração.
export class Athlete {
  char: PlayerCharacter;
  pos = new THREE.Vector3();
  target = new THREE.Vector3();
  facing = 0;
  faceNet = true;
  jumpY = 0;
  private jumpVel = 0;
  private airborne = false;
  private actionUntil = 0;
  private clock = 0;
  speedMul = 1;

  constructor(
    public side: TeamSide,
    public index: number,
    look: CharLook,
  ) {
    this.char = new PlayerCharacter(look);
  }

  get isAirborne(): boolean { return this.airborne; }

  moveTo(x: number, z: number): void {
    this.target.set(x, 0, z);
  }

  warpTo(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.target.copy(this.pos);
  }

  jump(vel = PLAYER.jumpVel): void {
    if (!this.airborne) {
      this.airborne = true;
      this.jumpVel = vel;
    }
  }

  /** define a animação por uma duração; depois volta a idle/run automático */
  act(action: CharAction, duration: number): void {
    this.char.setAction(action);
    this.actionUntil = this.clock + duration;
  }

  update(dt: number, maxSpeed: number): void {
    this.clock += dt;

    // deslocamento no plano (não se move no ar, exceto leve deriva)
    const delta = new THREE.Vector3().subVectors(this.target, this.pos);
    delta.y = 0;
    const dist = delta.length();
    let moving = false;
    if (dist > 0.06) {
      const speed = maxSpeed * this.speedMul * (this.airborne ? 0.25 : 1);
      const step = Math.min(dist, speed * dt);
      delta.normalize();
      this.pos.addScaledVector(delta, step);
      moving = step > 0.5 * dt;
      if (!this.faceNet) this.facing = Math.atan2(delta.x, delta.z) ;
      this.char.moveSpeed = speed;
    } else {
      this.char.moveSpeed = 0;
    }

    // encara a rede por padrão (mais legível para vôlei)
    if (this.faceNet) {
      const targetFacing = this.side === TeamSide.HOME ? Math.PI / 2 : -Math.PI / 2;
      this.facing += (targetFacing - this.facing) * Math.min(1, dt * 10);
    }

    // pulo
    if (this.airborne) {
      this.jumpVel += GRAV * dt;
      this.jumpY += this.jumpVel * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.airborne = false;
        this.jumpVel = 0;
      }
    }

    // animação automática quando nenhuma ação está ativa
    if (this.clock >= this.actionUntil) {
      this.char.setAction(moving ? 'run' : 'idle');
    }

    this.char.jumpY = this.jumpY;
    this.char.root.position.set(this.pos.x, 0, this.pos.z);
    this.char.root.rotation.y = this.facing;
    this.char.update(dt);
  }

  /** posição das mãos p/ contato (aproximada) */
  reachPoint(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, 1.0 + this.jumpY, this.pos.z);
  }
}

// Time de 6 com rodízio oficial. Slots: [pos1, pos6, pos5, pos4, pos3, pos2]
export class Team {
  athletes: Athlete[] = [];
  group = new THREE.Group();
  /** slots[i] = índice do atleta na posição de rodízio i */
  slots: number[] = [0, 1, 2, 3, 4, 5];

  constructor(public side: TeamSide) {
    const skins = [0xd6a77a, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xb07b52];
    const hairs = [0x2b1b12, 0x101010, 0x4e342e, 0x6d4c41, 0x1a1a1a, 0x3e2723];
    for (let i = 0; i < 6; i++) {
      const look: CharLook = {
        jersey: side === TeamSide.HOME ? COLORS.homeJersey : COLORS.awayJersey,
        shorts: side === TeamSide.HOME ? COLORS.homeShorts : COLORS.awayShorts,
        skin: skins[(i + side * 3) % skins.length],
        hair: hairs[(i + side * 2) % hairs.length],
        number: i + (side === TeamSide.HOME ? 1 : 7),
      };
      const a = new Athlete(side, i, look);
      this.athletes.push(a);
      this.group.add(a.char.root);
    }
    this.resetToBase(true);
  }

  /** posição-base do slot de rodízio i, no referencial mundial deste time */
  slotPos(i: number): { x: number; z: number } {
    const s = BASE_SLOTS[i];
    const m = sideSign(this.side) === -1 ? 1 : -1;
    // HOME usa como está; AWAY é reflexão pelo centro (x,z → -x,-z)
    return this.side === TeamSide.HOME ? { x: s.x, z: s.z } : { x: -s.x, z: -s.z };
  }

  setterSpot(): { x: number; z: number } {
    return this.side === TeamSide.HOME
      ? { x: SETTER_SPOT.x, z: SETTER_SPOT.z }
      : { x: -SETTER_SPOT.x, z: -SETTER_SPOT.z };
  }

  /** rodízio no sentido horário (quando o time recupera o saque) */
  rotate(): void {
    const old = [...this.slots];
    for (let i = 0; i < 6; i++) this.slots[i] = old[(i + 5) % 6];
  }

  server(): Athlete { return this.athletes[this.slots[0]]; }

  frontRow(): Athlete[] {
    return [this.athletes[this.slots[3]], this.athletes[this.slots[4]], this.athletes[this.slots[5]]];
  }

  backRow(): Athlete[] {
    return [this.athletes[this.slots[0]], this.athletes[this.slots[1]], this.athletes[this.slots[2]]];
  }

  /** manda todos para as posições-base (rodízio atual) */
  resetToBase(warp = false): void {
    for (let i = 0; i < 6; i++) {
      const a = this.athletes[this.slots[i]];
      const p = this.slotPos(i);
      if (warp) a.warpTo(p.x, p.z);
      else a.moveTo(p.x, p.z);
    }
  }

  nearestTo(x: number, z: number, exclude?: Athlete): Athlete {
    let best: Athlete = this.athletes[0];
    let bestD = Infinity;
    for (const a of this.athletes) {
      if (a === exclude) continue;
      const d = (a.pos.x - x) ** 2 + (a.pos.z - z) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  nearestFrontRowTo(z: number, exclude?: Athlete): Athlete {
    let best: Athlete | null = null;
    let bestD = Infinity;
    for (const a of this.frontRow()) {
      if (a === exclude) continue;
      const d = Math.abs(a.pos.z - z);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best ?? this.frontRow()[0];
  }

  celebrate(): void {
    for (const a of this.athletes) a.act('celebrate', 2.2);
  }

  deject(): void {
    for (const a of this.athletes) a.act('dejected', 2.2);
  }

  update(dt: number, maxSpeed: number): void {
    for (const a of this.athletes) a.update(dt, maxSpeed);
  }
}
