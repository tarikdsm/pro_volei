import * as THREE from 'three';
import { CharAction, CharLook, CharVisual, CharFactory } from '../entities/PlayerCharacter';
import { createRiggedCharacter } from '../entities/rig/RiggedCharacter';
import { AWAY_ROSTER, HOME_ROSTER } from '../entities/rig/roster';
import { BASE_SLOTS, COLORS, PLAYER, TeamSide, SETTER_SPOT } from '../core/constants';
import { initialSlots, rotateSlots } from './rules/rotation';
import { lerp, lerpAngle } from '../core/math3d';
import { advancePlanarMotion } from './control/kinematics';

const GRAV = -22; // gravidade do pulo dos atletas (mais pesada = pulos secos)

// Atleta: casca lógica sobre o personagem visual — movimento, pulo, ação com duração.
export class Athlete {
  char: CharVisual;
  pos = new THREE.Vector3();
  target = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private previousPos = new THREE.Vector3();
  facing = 0;
  private previousFacing = 0;
  faceNet = true;
  jumpY = 0;
  private previousJumpY = 0;
  private jumpVel = 0;
  private airborne = false;
  private actionUntil = 0;
  private clock = 0;
  speedMul = 1;

  constructor(
    public side: TeamSide,
    public index: number,
    look: CharLook,
    // Fábrica injetável do visual; default = atleta rigada 2.0 (Fase 4A).
    makeChar: CharFactory = (l) => createRiggedCharacter(l),
  ) {
    this.char = makeChar(look);
  }

  get isAirborne(): boolean {
    return this.airborne;
  }

  moveTo(x: number, z: number): void {
    this.target.set(x, 0, z);
  }

  warpTo(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.previousPos.copy(this.pos);
    this.target.copy(this.pos);
    this.present(1);
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

    // O solver e o movimento compartilham a mesma aceleração. Os objetos são da atleta e o
    // helper os muta diretamente, sem criar vetores no tick.
    const movementScale = this.speedMul * (this.airborne ? 0.25 : 1);
    const speed = advancePlanarMotion(
      this.pos,
      this.velocity,
      this.target,
      dt,
      maxSpeed * movementScale,
      PLAYER.acceleration * movementScale,
      PLAYER.deceleration * movementScale,
    );
    const moving = speed > 0.5;
    if (!this.faceNet && moving) this.facing = Math.atan2(this.velocity.x, this.velocity.z);
    this.char.moveSpeed = speed;

    // Locomoção direcional no referencial da atleta (frente = +z local, esquerda = +x local).
    if (this.char.setPlanarMotion) {
      const sinF = Math.sin(this.facing);
      const cosF = Math.cos(this.facing);
      const forward = this.velocity.x * sinF + this.velocity.z * cosF;
      const lateral = this.velocity.x * cosF - this.velocity.z * sinF;
      // Freando quando a distância restante ao alvo cabe na desaceleração atual.
      const remaining = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      const braking = remaining < (speed * speed) / (2 * PLAYER.deceleration) + 0.05;
      this.char.setPlanarMotion(forward, lateral, braking);
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

  beginFixedStep(): void {
    this.previousPos.copy(this.pos);
    this.previousFacing = this.facing;
    this.previousJumpY = this.jumpY;
  }

  /** Interpola somente o visual entre os dois últimos estados lógicos. */
  present(alpha: number): void {
    const t = Math.max(0, Math.min(1, alpha));
    this.char.root.position.set(
      lerp(this.previousPos.x, this.pos.x, t),
      0,
      lerp(this.previousPos.z, this.pos.z, t),
    );
    this.char.root.rotation.y = lerpAngle(this.previousFacing, this.facing, t);
    this.char.presentJump?.(lerp(this.previousJumpY, this.jumpY, t));
  }

  /** posição das mãos p/ contato (aproximada) */
  reachPoint(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, 1.0 + this.jumpY, this.pos.z);
  }

  /** Alvo de contato para o visual (antecipação/IK): converte mundo → referencial do root. */
  aimContact(point: { x: number; y: number; z: number }, inSeconds: number): void {
    if (!this.char.setContactAim) return;
    const dx = point.x - this.pos.x;
    const dz = point.z - this.pos.z;
    const sinF = Math.sin(this.facing);
    const cosF = Math.cos(this.facing);
    // Ry(-facing): local x = esquerda da atleta, local z = frente.
    const localX = cosF * dx - sinF * dz;
    const localZ = sinF * dx + cosF * dz;
    this.char.setContactAim(localX, point.y - this.jumpY, localZ, inSeconds);
  }
}

// Time de 6 com rodízio oficial. Slots: [pos1, pos6, pos5, pos4, pos3, pos2]
export class Team {
  athletes: Athlete[] = [];
  group = new THREE.Group();
  /** slots[i] = índice do atleta na posição de rodízio i */
  slots: number[] = initialSlots();

  constructor(
    public side: TeamSide,
    // Injeta a fábrica visual (testes passam um dublê; browser usa o default).
    makeChar?: CharFactory,
  ) {
    // Elenco nomeado 2.0 (Fase 4C): identidades visuais vêm do roster; uniforme vem do time.
    const roster = side === TeamSide.HOME ? HOME_ROSTER : AWAY_ROSTER;
    for (let i = 0; i < 6; i++) {
      const look: CharLook = {
        jersey: side === TeamSide.HOME ? COLORS.homeJersey : COLORS.awayJersey,
        shorts: side === TeamSide.HOME ? COLORS.homeShorts : COLORS.awayShorts,
        ...roster[i],
      };
      const a = new Athlete(side, i, look, makeChar);
      this.athletes.push(a);
      this.group.add(a.char.root);
    }
    this.resetToBase(true);
  }

  /** posição-base do slot de rodízio i, no referencial mundial deste time */
  slotPos(i: number): { x: number; z: number } {
    const s = BASE_SLOTS[i];
    // HOME usa como está; AWAY é reflexão pelo centro (x,z → -x,-z)
    return this.side === TeamSide.HOME ? { x: s.x, z: s.z } : { x: -s.x, z: -s.z };
  }

  setterSpot(): { x: number; z: number } {
    return this.side === TeamSide.HOME
      ? { x: SETTER_SPOT.x, z: SETTER_SPOT.z }
      : { x: -SETTER_SPOT.x, z: -SETTER_SPOT.z };
  }

  slotIndexOf(athlete: Athlete): number {
    return this.slots.indexOf(athlete.index);
  }

  basePositionOf(athlete: Athlete): { x: number; z: number } | null {
    const slot = this.slotIndexOf(athlete);
    return slot >= 0 ? this.slotPos(slot) : null;
  }

  /** rodízio no sentido horário (quando o time recupera o saque) */
  rotate(): void {
    this.slots = rotateSlots(this.slots);
  }

  /**
   * Restaura o rodízio inicial (nova partida) e reposiciona nas bases.
   * Reset de line-up só ao iniciar nova partida, não a cada set: o rodízio
   * persiste entre sets da mesma partida (fiel ao vôlei — o elenco é fixo).
   */
  resetLineup(): void {
    this.slots = initialSlots();
    this.resetToBase(true);
  }

  server(): Athlete {
    return this.athletes[this.slots[0]];
  }

  frontRow(): Athlete[] {
    return [
      this.athletes[this.slots[3]],
      this.athletes[this.slots[4]],
      this.athletes[this.slots[5]],
    ];
  }

  backRow(): Athlete[] {
    return [
      this.athletes[this.slots[0]],
      this.athletes[this.slots[1]],
      this.athletes[this.slots[2]],
    ];
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
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  nearestFrontRowTo(z: number, exclude?: Athlete): Athlete {
    let best: Athlete | null = null;
    let bestD = Infinity;
    for (const a of this.frontRow()) {
      if (a === exclude) continue;
      const d = Math.abs(a.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best ?? this.frontRow()[0];
  }

  celebrate(): void {
    for (const a of this.athletes) a.act('celebrate', 2.2);
  }

  deject(): void {
    for (const a of this.athletes) a.act('dejected', 2.2);
  }

  update(dt: number, maxSpeed: number | ((athlete: Athlete) => number)): void {
    for (const a of this.athletes) {
      a.update(dt, typeof maxSpeed === 'number' ? maxSpeed : maxSpeed(a));
    }
  }

  beginFixedStep(): void {
    for (const athlete of this.athletes) athlete.beginFixedStep();
  }

  present(alpha: number): void {
    for (const athlete of this.athletes) athlete.present(alpha);
  }
}

export type TeamFactory = (side: TeamSide, makeChar?: CharFactory) => Team;
