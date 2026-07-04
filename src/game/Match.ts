import * as THREE from 'three';
import { Ball } from '../entities/Ball';
import { Team, Athlete } from './Team';
import { Input } from '../core/Input';
import { AudioEngine } from '../core/AudioEngine';
import { Effects } from '../systems/Effects';
import { CameraDirector } from '../systems/CameraDirector';
import { Crowd } from '../world/Crowd';
import { Referee } from '../world/Referee';
import { Arena } from '../world/Arena';
import {
  COURT, CONTACT, PLAYER, GRAVITY, BALL_RADIUS,
  TeamSide, otherSide, sideSign, Difficulty, DIFFICULTIES,
  ATTACK_ZONES, SERVE_SPOT, MATCH_FORMATS, TouchKind,
} from '../core/constants';
import { ballisticArc, ballisticDrive, clamp, lerp, rand, chance, randPick } from '../core/math3d';

export interface MatchStats {
  aces: number; blocks: number; longestRally: number; points: [number, number];
}

export interface Hooks {
  banner(text: string, sub?: string): void;
  hint(text: string): void;
  setScore(h: number, a: number, hs: number, as: number, setNum: number, serving: TeamSide): void;
  serveMeter(visible: boolean, value?: number): void;
  zoneHint(zone: number | null): void;
  slowMo(scale: number, dur: number): void;
  matchEnd(homeWon: boolean, stats: MatchStats, scoreline: string): void;
  audio: AudioEngine;
  effects: Effects;
  camera: CameraDirector;
  crowd: Crowd;
  referee: Referee;
  arena: Arena;
}

type MState = 'idle' | 'servePrep' | 'rally' | 'point' | 'setEnd' | 'matchEnd';
type CtlMode = 'none' | 'serve' | 'receive' | 'attack' | 'block';

interface TouchPlan {
  side: TeamSide;
  athlete: Athlete;
  contactIn: number;       // segundos até o contato ideal
  point: THREE.Vector3;    // onde a bola estará no contato
  kind: TouchKind;         // o que este toque deve ser
  isHuman: boolean;
  jumpScheduledIn?: number; // p/ ataque IA
  done: boolean;
}

interface PendingEvent { t: number; fn: () => void }

const PERFECT_LO = 0.72, PERFECT_HI = 0.92;

export class Match {
  group = new THREE.Group();
  ball = new Ball();
  home = new Team(TeamSide.HOME);
  away = new Team(TeamSide.AWAY);

  state: MState = 'idle';
  private stateTime = 0;
  private events: PendingEvent[] = [];

  private diff: Difficulty = DIFFICULTIES[1];
  private format = MATCH_FORMATS[0];
  score: [number, number] = [0, 0];
  sets: [number, number] = [0, 0];
  setNumber = 1;
  servingTeam: TeamSide = TeamSide.HOME;

  // posse e toques
  private possessionTeam: TeamSide | null = null;
  private possessionTouches = 0;
  private lastTouchTeam: TeamSide | null = null;
  private lastKind: TouchKind = 'serve';
  private rallyTouches = 0;

  private plan: TouchPlan | null = null;
  private netEventIn: number | null = null;
  private crossIn: number | null = null;
  private prevBallX = 0;

  // controle humano
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private serveCharging = false;
  private servePower = 0;
  private serveDir = 1;
  private aim = new THREE.Vector3(5.5, 0, 0);
  private timingQ = -1;          // qualidade do aperto de ESPAÇO na recepção
  private jumpQ = -1;            // qualidade do timing do pulo no ataque
  private chosenZone = 0;        // 0 esq, 1 centro, 2 dir
  private marker: THREE.Mesh;    // anel sob o jogador controlado

  private stats: MatchStats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
  private setterHold: Athlete | null = null;

  constructor(private hooks: Hooks) {
    this.group.add(this.ball.group, this.home.group, this.away.group);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x40ff9f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.group.add(this.marker);
    this.ball.hold(new THREE.Vector3(0, 1.2, 0));
  }

  startMatch(diffIdx: number, fmtIdx: number): void {
    this.diff = DIFFICULTIES[clamp(diffIdx, 0, DIFFICULTIES.length - 1)];
    this.format = MATCH_FORMATS[clamp(fmtIdx, 0, MATCH_FORMATS.length - 1)];
    this.score = [0, 0];
    this.sets = [0, 0];
    this.setNumber = 1;
    this.stats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
    this.servingTeam = chance(0.5) ? TeamSide.HOME : TeamSide.AWAY;
    this.pushScore();
    this.beginServePrep();
  }

  // ---------------------------------------------------------------- SAQUE
  private beginServePrep(): void {
    this.state = 'servePrep';
    this.stateTime = 0;
    this.events = [];
    this.plan = null;
    this.netEventIn = null;
    this.possessionTeam = null;
    this.possessionTouches = 0;
    this.rallyTouches = 0;
    this.lastTouchTeam = null;
    this.timingQ = -1;
    this.jumpQ = -1;
    this.chosenZone = randPick([0, 1, 2]);
    this.hooks.zoneHint(null);
    this.hooks.effects.showLanding(null);
    this.hooks.effects.showAim(null);

    this.home.resetToBase();
    this.away.resetToBase();

    const team = this.teamOf(this.servingTeam);
    const server = team.server();
    const spot = this.servingTeam === TeamSide.HOME
      ? SERVE_SPOT : { x: -SERVE_SPOT.x, z: -SERVE_SPOT.z };
    server.warpTo(spot.x, spot.z);
    this.ball.hold(new THREE.Vector3(spot.x + sideSign(otherSide(this.servingTeam)) * 0.25, 1.15, spot.z));

    this.hooks.camera.servePos.set(spot.x, 1.6, spot.z);
    const humanServes = this.servingTeam === TeamSide.HOME;
    this.hooks.camera.setMode(humanServes ? 'serveHome' : 'serveAway', { cut: true });
    this.after(0.5, () => this.hooks.audio.whistle());

    if (humanServes) {
      this.ctl = 'serve';
      this.controlled = server;
      this.servePower = 0;
      this.serveCharging = false;
      this.aim.set(rand(4, 6.5), 0, rand(-2, 2));
      this.hooks.hint('SEGURE ESPAÇO para carregar o saque — solte na zona verde · WASD ajusta a mira');
      this.hooks.serveMeter(true, 0);
    } else {
      this.ctl = 'none';
      this.controlled = null;
      this.hooks.hint('Saque do adversário — prepare a recepção!');
      this.after(rand(1.4, 2.4), () => this.aiServe());
    }
  }

  private aiServe(): void {
    const team = this.teamOf(this.servingTeam);
    const server = team.server();
    const power = rand(this.diff.servePower[0], this.diff.servePower[1]);
    const err = chance(this.diff.serveError);
    const s = sideSign(otherSide(this.servingTeam)); // lado alvo
    let target: THREE.Vector3;
    if (err) {
      target = chance(0.5)
        ? new THREE.Vector3(s * rand(9.6, 11), 0, rand(-4, 4))                 // fora, longa
        : new THREE.Vector3(s * 0.35, 1.2, rand(-3, 3));                        // na rede
    } else {
      target = new THREE.Vector3(s * rand(3.5, 8.4), 0, rand(-3.9, 3.9));
    }
    this.performServe(server, power, target);
  }

  private performServe(server: Athlete, power: number, target: THREE.Vector3): void {
    this.hooks.serveMeter(false);
    this.hooks.effects.showAim(null);
    server.act('serveToss', 0.5);
    const hand = server.reachPoint();
    this.ball.launch(new THREE.Vector3(hand.x, 1.15, hand.z), new THREE.Vector3(0, 5.6, 0));
    this.after(0.34, () => server.act('serveHit', 0.5));
    this.after(0.42, () => {
      const p0 = this.ball.pos.clone();
      const T = lerp(1.5, 0.82, power);
      const { v0 } = ballisticDrive(p0, target, T);
      this.ball.launch(p0, v0);
      this.hooks.audio.hitHard();
      this.state = 'rally';
      this.lastTouchTeam = this.servingTeam;
      this.lastKind = 'serve';
      this.possessionTeam = this.servingTeam;
      this.possessionTouches = 0;
      this.hooks.camera.setMode('rally');
      this.planNext('pass');
    });
  }

  // ---------------------------------------------------------------- PLANEJAMENTO
  /** Após cada lançamento da bola, agenda o próximo contato e eventos de rede/queda. */
  private planNext(nextKind: TouchKind): void {
    this.plan = null;
    this.computeNetEvent();

    const landing = this.ball.predictLanding();
    if (landing.time <= 0) return;

    const landSide: TeamSide = landing.point.x < 0 ? TeamSide.HOME : TeamSide.AWAY;

    // bola indo para o time que já usou 3 toques (e não pode mais) → ninguém joga, deixa cair
    if (this.possessionTeam === landSide && this.possessionTouches >= 3) return;

    const contactH = nextKind === 'set' ? CONTACT.set : nextKind === 'spike' ? CONTACT.spike : CONTACT.pass;
    let cT = this.ball.timeToDescend(contactH);
    const cPoint = new THREE.Vector3();
    if (cT < 0.05 || cT > landing.time) {
      cT = Math.max(0.06, landing.time - 0.1); // bola rasteira: contato de emergência
    }
    this.ball.posAt(cT, cPoint);

    const team = this.teamOf(landSide);
    let athlete: Athlete;
    if (nextKind === 'set') {
      const sp = team.setterSpot();
      athlete = this.setterHold ?? team.nearestTo(sp.x, sp.z, this.lastToucher ?? undefined);
    } else if (nextKind === 'spike') {
      athlete = this.plannedAttacker ?? team.nearestFrontRowTo(cPoint.z, this.lastToucher ?? undefined);
    } else {
      athlete = team.nearestTo(cPoint.x, cPoint.z);
    }

    const isHuman = landSide === TeamSide.HOME;
    this.plan = {
      side: landSide, athlete, contactIn: cT, point: cPoint, kind: nextKind, isHuman, done: false,
    };

    // IA (ou aproximação automática p/ humano): manda o atleta para o ponto de contato
    const delay = isHuman ? 0 : this.diff.reactionDelay;
    if (nextKind === 'spike') {
      // atacante corre para trás do ponto de contato; o pulo leva até ele
      const backoff = sideSign(landSide) * 0.85;
      this.after(delay, () => athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z));
      if (!isHuman) {
        // IA pula para contato no ápice
        this.plan.jumpScheduledIn = cT - 0.26;
      }
      // câmera de ataque + bloqueio adversário
      this.hooks.camera.setMode('spike');
      this.prepareBlock(otherSide(landSide), cPoint.z, cT);
    } else if (nextKind !== 'set' || !isHuman) {
      this.after(delay, () => athlete.moveTo(cPoint.x, cPoint.z));
    } else {
      athlete.moveTo(cPoint.x, cPoint.z); // levantador humano é automático
    }

    // controle humano
    if (isHuman) {
      if (nextKind === 'pass' || nextKind === 'dig' || nextKind === 'freeball') {
        this.ctl = 'receive';
        this.controlled = athlete;
        this.timingQ = -1;
        this.hooks.hint('WASD move · ESPAÇO no momento do toque = passe perfeito');
        this.hooks.effects.showLanding(this.plan.point);
      } else if (nextKind === 'set') {
        this.ctl = 'none';
        this.controlled = null;
        this.hooks.hint('Escolha o ataque: A esquerda · W centro · D direita');
        this.hooks.zoneHint(this.chosenZone);
      } else if (nextKind === 'spike') {
        this.ctl = 'attack';
        this.controlled = athlete;
        this.jumpQ = -1;
        this.aim.set(rand(4.5, 6.5), 0, rand(-2.5, 2.5));
        this.hooks.hint('ESPAÇO pula (timing = força) · WASD mira a cortada');
      }
    } else if (this.plan.side === TeamSide.AWAY && nextKind === 'spike') {
      // humano pode bloquear
      this.ctl = 'block';
      const blocker = this.home.nearestFrontRowTo(cPoint.z);
      this.controlled = blocker;
      this.hooks.hint('BLOQUEIO: A/D desliza na rede · ESPAÇO pula!');
    } else if (this.plan.side === TeamSide.AWAY) {
      if (this.ctl !== 'block') { this.ctl = 'none'; this.controlled = null; }
      this.hooks.effects.showLanding(null);
    }
  }

  private lastToucher: Athlete | null = null;
  private plannedAttacker: Athlete | null = null;

  private computeNetEvent(): void {
    this.netEventIn = null;
    this.crossIn = null;
    const { pos, vel } = this.ball;
    if (Math.abs(vel.x) < 0.01) return;
    const t = -pos.x / vel.x;
    if (t <= 0.005) return;
    const y = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
    const z = pos.z + vel.z * t;
    if (y > BALL_RADIUS && y < COURT.netHeight + BALL_RADIUS * 0.4 && Math.abs(z) < COURT.halfWidth + 0.5) {
      this.netEventIn = t;
    } else {
      this.crossIn = t;
    }
  }

  // Bloqueio da IA (ou preparação do lado da IA contra ataque humano)
  private blockers: { athlete: Athlete; jumpIn: number }[] = [];
  private prepareBlock(side: TeamSide, z: number, contactIn: number): void {
    this.blockers = [];
    const team = this.teamOf(side);
    const isAI = side === TeamSide.AWAY;
    const blocker = team.nearestFrontRowTo(z);
    const bx = sideSign(side) * 0.72;
    blocker.moveTo(bx, clamp(z, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4));
    if (isAI && chance(this.diff.blockChance)) {
      this.blockers.push({ athlete: blocker, jumpIn: contactIn + rand(0.0, 0.12) });
    }
  }

  // ---------------------------------------------------------------- TOQUES
  private executeTouch(plan: TouchPlan, quality: number): void {
    const { athlete, kind, side } = plan;
    plan.done = true;
    this.lastToucher = athlete;
    this.rallyTouches++;
    this.hooks.crowd.excite(0.25 + Math.min(0.4, this.rallyTouches * 0.04));
    this.hooks.audio.excite(0.3);

    // contagem de toques (bloqueio não conta)
    if (kind !== 'block') {
      if (this.possessionTeam !== side) {
        this.possessionTeam = side;
        this.possessionTouches = 1;
      } else {
        this.possessionTouches++;
      }
    }
    this.lastTouchTeam = side;
    this.lastKind = kind;

    switch (kind) {
      case 'pass': case 'dig': case 'freeball': this.doPass(plan, quality); break;
      case 'set': this.doSet(plan, quality); break;
      case 'spike': this.doSpike(plan, quality); break;
      default: this.doPass(plan, quality);
    }
  }

  private doPass(plan: TouchPlan, q: number): void {
    const { athlete, side } = plan;
    athlete.act(q < 0.3 ? 'dive' : 'bump', 0.55);
    this.hooks.audio.hitSoft();
    this.hooks.effects.burst(this.ball.pos, 0xfff2b0, 8, 2);

    const team = this.teamOf(side);
    const sp = team.setterSpot();
    const noise = (1 - q) * 2.6;
    const target = new THREE.Vector3(
      clamp(sp.x + rand(-noise, noise), side === TeamSide.HOME ? -8.5 : 0.6, side === TeamSide.HOME ? -0.6 : 8.5),
      CONTACT.set,
      clamp(sp.z + rand(-noise, noise), -4, 4),
    );
    const { v0 } = ballisticArc(this.ball.pos.clone(), target, 2.6 + (1 - q) * 1.2);
    this.ball.launch(this.ball.pos.clone(), v0);

    // se o time já gastou os 3 toques, esta bola precisa ter ido para o outro lado — senão cai
    if (this.possessionTouches >= 3) { this.planNext('pass'); return; }

    // designa levantador para o próximo toque
    this.setterHold = team.nearestTo(sp.x, sp.z, athlete);
    this.plannedAttacker = null;

    // passe horrível vira bola de graça pro outro lado às vezes
    if (q < 0.18 && chance(0.5)) {
      this.planNext('pass'); // deixa o motor decidir pelo lado em que vai cair
      return;
    }
    this.planNext('set');
  }

  private doSet(plan: TouchPlan, q: number): void {
    const { athlete, side } = plan;
    athlete.act('set', 0.55);
    this.hooks.audio.hitSoft();

    const team = this.teamOf(side);
    // zona de ataque: humano escolheu com A/W/D; IA escolhe aleatória
    const zoneIdx = side === TeamSide.HOME ? this.chosenZone : randPick([0, 1, 2]);
    const zoneZ = side === TeamSide.HOME ? ATTACK_ZONES[zoneIdx] : -ATTACK_ZONES[zoneIdx];
    const attacker = team.nearestFrontRowTo(zoneZ, athlete);
    this.plannedAttacker = attacker;
    this.setterHold = null;

    const contact = new THREE.Vector3(
      sideSign(side) * rand(0.8, 1.1),
      CONTACT.spike,
      clamp(zoneZ + rand(-0.3, 0.3) * (1 - q), -4.1, 4.1),
    );
    const apex = zoneIdx === 1 ? 0.6 : 1.5; // bola rápida no meio, alta nas pontas
    const { v0 } = ballisticArc(this.ball.pos.clone(), contact, apex + (1 - q) * 0.8);
    this.ball.launch(this.ball.pos.clone(), v0);
    this.hooks.zoneHint(null);
    this.planNext('spike');
  }

  private doSpike(plan: TouchPlan, q: number): void {
    const { athlete, side } = plan;
    athlete.act('spikeHit', 0.5);
    this.hooks.audio.hitHard();
    this.hooks.camera.kickFov(9);
    this.hooks.camera.addShake(0.5);
    this.hooks.slowMo(0.35, 0.4);
    this.hooks.effects.burst(this.ball.pos, 0xffcf6b, 16, 5);

    const enemy = otherSide(side);
    const s = sideSign(enemy);
    let target: THREE.Vector3;
    const isAI = side === TeamSide.AWAY;

    if (isAI && chance(this.diff.attackError)) {
      target = chance(0.5)
        ? new THREE.Vector3(s * rand(9.5, 11.5), 0, rand(-5, 5))     // pra fora
        : new THREE.Vector3(s * 0.3, 1.0, rand(-3, 3));               // na rede
    } else if (isAI) {
      const spots = [
        new THREE.Vector3(s * rand(6.5, 8.5), 0, rand(-3.8, -2.2)),
        new THREE.Vector3(s * rand(6.5, 8.5), 0, rand(2.2, 3.8)),
        new THREE.Vector3(s * rand(2.5, 4.5), 0, rand(-3.5, 3.5)),
        new THREE.Vector3(s * rand(5, 8), 0, rand(-1.5, 1.5)),
      ];
      target = randPick(spots);
    } else {
      // humano: mira + erro pela qualidade do pulo
      const err = (1 - q) * 2.4;
      target = new THREE.Vector3(
        this.aim.x + rand(-err, err),
        0,
        this.aim.z + rand(-err, err),
      );
    }

    const dist = Math.hypot(target.x - this.ball.pos.x, target.z - this.ball.pos.z);
    const T = clamp(dist / lerp(11, 20, q), 0.34, 0.75);
    const { v0 } = ballisticDrive(this.ball.pos.clone(), target, T);
    this.ball.launch(this.ball.pos.clone(), v0);
    this.hooks.effects.showAim(null);

    this.resolveBlock(side);
    this.planNext(this.possessionTouchesOf(enemy) === 0 ? 'pass' : 'pass');
  }

  private possessionTouchesOf(side: TeamSide): number {
    return this.possessionTeam === side ? this.possessionTouches : 0;
  }

  /** verifica bloqueio no cruzamento da rede (chamado no lançamento da cortada) */
  private resolveBlock(attackSide: TeamSide): void {
    const defSide = otherSide(attackSide);
    const { pos, vel } = this.ball;
    if (Math.abs(vel.x) < 0.01) return;
    const t = -pos.x / vel.x;
    if (t <= 0 || t > 0.8) return;
    const yCross = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
    const zCross = pos.z + vel.z * t;

    // candidatos: bloqueadores da linha de frente que estarão no ar
    const team = this.teamOf(defSide);
    const isHumanDef = defSide === TeamSide.HOME;
    for (const blocker of team.frontRow()) {
      const nearNet = Math.abs(blocker.pos.x) < 1.4;
      const zDist = Math.abs(blocker.pos.z - zCross);
      // no momento do cruzamento o bloqueador precisa estar no ar
      const willBeAirborne = isHumanDef
        ? blocker.isAirborne && blocker.jumpY > 0.18
        : this.blockers.some((b) => b.athlete === blocker);
      if (!nearNet || zDist > 0.85 || !willBeAirborne) continue;
      const reach = CONTACT.blockReach + blocker.jumpY * 0.5;
      if (yCross > reach) continue;

      // BLOQUEIO! resolve no instante do cruzamento
      this.after(t, () => {
        const prox = 1 - zDist / 0.85;
        const r = Math.random();
        const bp = this.ball.pos.clone();
        this.hooks.audio.block();
        this.hooks.effects.burst(bp, 0x9fd8ff, 20, 6);
        this.hooks.camera.addShake(0.6);
        blocker.act('block', 0.5);
        this.lastToucher = blocker;
        this.lastTouchTeam = defSide;
        this.lastKind = 'block';
        this.rallyTouches++;

        if (r < prox * 0.5) {
          // STUFF: devolve no chão do atacante
          const tgt = new THREE.Vector3(sideSign(attackSide) * rand(1, 3.5), 0, bp.z + rand(-1.5, 1.5));
          const { v0 } = ballisticDrive(bp, tgt, 0.32);
          this.ball.launch(bp, v0);
          if (defSide === TeamSide.HOME) this.stats.blocks++;
          this.hooks.banner(defSide === TeamSide.HOME ? 'MONSTER BLOCK!' : 'BLOQUEADO!');
          this.hooks.crowd.excite(1);
          this.hooks.audio.cheer(true);
          this.planNext('dig');
        } else if (r < prox * 0.95) {
          // pingo: bola sobe devagar e continua no lado defensor — jogável
          const v = this.ball.vel.clone();
          v.x *= 0.25; v.z *= 0.4; v.y = Math.abs(v.y) * 0.3 + 3.2;
          this.ball.launch(bp, v);
          // toque de bloqueio não conta: posse continua limpa p/ defesa
          this.possessionTeam = null;
          this.possessionTouches = 0;
          this.planNext('pass');
        } else {
          // explode no bloqueio pra fora (ponto do atacante)
          const v = this.ball.vel.clone();
          v.x *= -0.3; v.y = 2; v.z = rand(-6, 6);
          this.ball.launch(bp, v);
          this.planNext('pass');
        }
      });
      return; // um bloqueador resolve
    }
  }

  // ---------------------------------------------------------------- PONTO
  private resolvePoint(): void {
    const landing = this.ball.pos;
    const landSide: TeamSide = landing.x < 0 ? TeamSide.HOME : TeamSide.AWAY;
    const inCourt = Math.abs(landing.x) <= COURT.halfLength + BALL_RADIUS
      && Math.abs(landing.z) <= COURT.halfWidth + BALL_RADIUS;

    let winner: TeamSide;
    let reason: string;
    if (inCourt) {
      winner = otherSide(landSide);
      reason = landSide === TeamSide.HOME ? 'Bola no seu chão' : 'Bola no chão deles!';
    } else {
      winner = this.lastTouchTeam !== null ? otherSide(this.lastTouchTeam) : otherSide(this.servingTeam);
      reason = 'Bola fora';
    }
    this.awardPoint(winner, reason);
  }

  private awardPoint(winner: TeamSide, reason: string): void {
    if (this.state !== 'rally') return;
    this.state = 'point';
    this.stateTime = 0;
    this.events = [];
    this.plan = null;
    this.ctl = 'none';
    this.controlled = null;
    this.ball.bouncy = true;
    this.hooks.effects.showLanding(null);
    this.hooks.effects.showAim(null);
    this.hooks.serveMeter(false);
    this.hooks.zoneHint(null);

    const isAce = this.lastKind === 'serve' && winner === this.servingTeam && this.rallyTouches === 0;
    this.score[winner]++;
    this.stats.points[winner]++;
    this.stats.longestRally = Math.max(this.stats.longestRally, this.rallyTouches);

    // banners com personalidade
    let text = winner === TeamSide.HOME ? 'PONTO SEU!' : 'PONTO DO CPU';
    if (isAce) { text = winner === TeamSide.HOME ? '🔥 ACE!' : 'ACE DO CPU'; if (winner === TeamSide.HOME) this.stats.aces++; }
    else if (this.rallyTouches >= 8) text = `QUE RALLY! ${this.rallyTouches} toques`;
    this.hooks.banner(text, reason);

    this.hooks.audio.whistleLong();
    this.hooks.audio.scoreJingle(winner === TeamSide.HOME);
    this.hooks.audio.cheer(winner === TeamSide.HOME);
    if (winner === TeamSide.HOME) this.hooks.audio.applause(1.4);
    this.hooks.referee.signalPoint(winner);
    this.hooks.crowd.excite(winner === TeamSide.HOME ? 1 : 0.55);
    this.hooks.camera.setMode('point', { side: winner });

    this.teamOf(winner).celebrate();
    this.teamOf(otherSide(winner)).deject();

    // troca de saque + rodízio
    if (winner !== this.servingTeam) {
      this.servingTeam = winner;
      this.teamOf(winner).rotate();
    }
    this.pushScore();

    // fim de set?
    const target = this.format.pointsPerSet;
    const [h, a] = this.score;
    const setOver = (h >= target || a >= target) && Math.abs(h - a) >= 2;
    this.after(2.6, () => {
      if (setOver) this.endSet(h > a ? TeamSide.HOME : TeamSide.AWAY);
      else this.beginServePrep();
    });

    // set point / match point aviso
    if (!setOver) {
      const leader = h > a ? TeamSide.HOME : a > h ? TeamSide.AWAY : null;
      const lead = Math.max(h, a);
      if (leader !== null && lead >= target - 1) {
        this.after(1.4, () => this.hooks.banner(leader === TeamSide.HOME ? 'SET POINT — VOCÊ!' : 'SET POINT — CPU', ''));
      }
    }
  }

  private endSet(winner: TeamSide): void {
    this.sets[winner]++;
    this.state = 'setEnd';
    this.stateTime = 0;
    this.hooks.camera.setMode('setEnd');
    this.hooks.effects.confetti(sideSign(winner) * 4);
    this.hooks.audio.victoryFanfare();
    this.hooks.crowd.excite(1);
    this.hooks.crowd.startWave();

    const needed = Math.ceil(this.format.sets / 2);
    const matchOver = this.sets[winner] >= needed;
    this.hooks.banner(
      matchOver ? '' : (winner === TeamSide.HOME ? 'SET SEU! 🏐' : 'SET DO CPU'),
      matchOver ? '' : `Sets ${this.sets[0]} × ${this.sets[1]}`,
    );
    this.pushScore();

    this.after(matchOver ? 1.2 : 4.0, () => {
      if (matchOver) {
        this.state = 'matchEnd';
        const scoreline = `${this.sets[0]} × ${this.sets[1]}`;
        this.hooks.matchEnd(winner === TeamSide.HOME, this.stats, scoreline);
      } else {
        this.setNumber++;
        this.score = [0, 0];
        this.servingTeam = winner;
        this.pushScore();
        this.beginServePrep();
      }
    });
  }

  private pushScore(): void {
    this.hooks.setScore(this.score[0], this.score[1], this.sets[0], this.sets[1], this.setNumber, this.servingTeam);
    this.hooks.arena.updateScoreboard(this.score[0], this.score[1], this.sets[0], this.sets[1], this.setNumber);
  }

  // ---------------------------------------------------------------- UPDATE
  update(dt: number, input: Input): void {
    this.stateTime += dt;

    // eventos agendados
    for (let i = this.events.length - 1; i >= 0; i--) {
      this.events[i].t -= dt;
      if (this.events[i].t <= 0) {
        const e = this.events.splice(i, 1)[0];
        e.fn();
      }
    }

    // entrada humana
    this.updateHumanControl(dt, input);

    // contato agendado
    if (this.plan && !this.plan.done && this.state === 'rally') {
      this.plan.contactIn -= dt;

      // pulo agendado da IA no ataque
      if (this.plan.jumpScheduledIn !== undefined) {
        this.plan.jumpScheduledIn -= dt;
        if (this.plan.jumpScheduledIn <= 0) {
          this.plan.athlete.act('spikeWindup', 0.4);
          this.plan.athlete.jump(PLAYER.jumpVel);
          this.plan.jumpScheduledIn = undefined;
        }
      }

      // bloqueadores IA pulam
      for (let i = this.blockers.length - 1; i >= 0; i--) {
        this.blockers[i].jumpIn -= dt;
        if (this.blockers[i].jumpIn <= 0) {
          this.blockers[i].athlete.act('block', 0.7);
          this.blockers[i].athlete.jump(PLAYER.blockJumpVel);
          this.blockers.splice(i, 1);
        }
      }

      if (this.plan.contactIn <= 0) {
        this.attemptContact(this.plan);
      }
    }

    // evento de rede
    if (this.netEventIn !== null && this.state === 'rally') {
      this.netEventIn -= dt;
      if (this.netEventIn <= 0) {
        this.netEventIn = null;
        this.onNetTouch();
      }
    }

    // bola no chão durante rally
    if (this.state === 'rally' && this.ball.inFlight && this.ball.pos.y <= BALL_RADIUS + 0.005 && this.ball.vel.y < 0) {
      this.hooks.audio.bounce();
      this.hooks.effects.burst(this.ball.pos, 0xd8b06a, 14, 3);
      this.hooks.camera.addShake(0.25);
      this.resolvePoint();
    }

    // física e visual
    this.ball.step(dt);
    this.hooks.camera.ballPos.copy(this.ball.pos);
    this.home.update(dt, this.humanSpeed());
    this.away.update(dt, PLAYER.aiSpeed * this.diff.moveSpeed);

    // anel do jogador controlado
    if (this.controlled && (this.ctl === 'receive' || this.ctl === 'attack' || this.ctl === 'block' || this.ctl === 'serve')) {
      this.marker.visible = true;
      this.marker.position.set(this.controlled.pos.x, 0.02, this.controlled.pos.z);
    } else {
      this.marker.visible = false;
    }
  }

  private humanSpeed(): number {
    return PLAYER.speed;
  }

  private attemptContact(plan: TouchPlan): void {
    plan.done = true;
    const a = plan.athlete;
    const d = Math.hypot(a.pos.x - plan.point.x, a.pos.z - plan.point.z);

    if (plan.kind === 'spike') {
      this.attemptSpikeContact(plan, d);
      return;
    }

    const isHuman = plan.isHuman;
    if (d <= CONTACT.reach) {
      let q: number;
      if (isHuman) {
        q = this.timingQ >= 0 ? 0.45 + 0.55 * this.timingQ : 0.45;
        if (this.timingQ > 0.8) this.hooks.banner('PERFEITO!', '');
      } else {
        q = rand(this.diff.passQuality[0], this.diff.passQuality[1]);
      }
      this.executeTouch(plan, q);
    } else if (d <= CONTACT.lungeReach) {
      // peixinho!
      a.act('dive', 0.8);
      const q = rand(0.08, 0.35);
      this.hooks.crowd.excite(0.6);
      this.executeTouch(plan, q);
    }
    // fora de alcance: nada acontece — a bola vai cair e o ponto será resolvido
    this.timingQ = -1;
  }

  private attemptSpikeContact(plan: TouchPlan, d: number): void {
    const a = plan.athlete;
    const isHuman = plan.isHuman;
    const airborne = a.isAirborne && a.jumpY > 0.2;

    if (airborne && d <= 1.0) {
      let q: number;
      if (isHuman) {
        q = this.jumpQ >= 0 ? this.jumpQ : 0.4;
      } else {
        q = rand(0.6, 1);
      }
      this.executeTouch(plan, q);
    } else if (d <= CONTACT.lungeReach) {
      // não pulou/perdeu o tempo: bola de graça por cima
      a.act('set', 0.5);
      this.hooks.audio.hitSoft();
      const enemy = otherSide(plan.side);
      const s = sideSign(enemy);
      const target = new THREE.Vector3(s * rand(3, 7), 0, rand(-3, 3));
      const { v0 } = ballisticArc(this.ball.pos.clone(), target, 3.2);
      this.ball.launch(this.ball.pos.clone(), v0);
      // conta o toque
      if (this.possessionTeam !== plan.side) { this.possessionTeam = plan.side; this.possessionTouches = 1; }
      else this.possessionTouches++;
      this.lastTouchTeam = plan.side;
      this.lastKind = 'freeball';
      this.lastToucher = a;
      this.rallyTouches++;
      this.hooks.banner('', '');
      this.planNext('pass');
    }
    this.jumpQ = -1;
  }

  private onNetTouch(): void {
    this.hooks.audio.netTouch();
    this.hooks.camera.addShake(0.2);
    const wasServe = this.lastKind === 'serve';
    // bola morre na rede: cai do lado de quem tocou
    const v = this.ball.vel;
    this.ball.vel.set(-Math.sign(v.x) * Math.abs(v.x) * 0.06, Math.min(v.y, 0.5), v.z * 0.25);

    if (wasServe) {
      // saque na rede = ponto do recebedor
      this.after(0.5, () => {
        if (this.state === 'rally') {
          this.awardPoint(otherSide(this.servingTeam), 'Saque na rede');
        }
      });
      return;
    }
    // rally: a bola ainda é jogável no lado de quem atacou (escaparam do bloqueio etc.)
    this.hooks.banner('NA REDE!', 'bola viva!');
    this.planNext('pass');
  }

  // ---------------------------------------------------------------- CONTROLE HUMANO
  private updateHumanControl(dt: number, input: Input): void {
    const axis = input.moveAxis();

    if (this.ctl === 'serve' && this.controlled) {
      // mira
      this.aim.x = clamp(this.aim.x + axis.x * dt * 5, 1.2, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 5, -4.2, 4.2);
      this.hooks.effects.showAim(this.aim);

      if (input.wasPressed('Space')) {
        this.serveCharging = true;
        this.servePower = 0;
        this.serveDir = 1;
      }
      if (this.serveCharging) {
        this.servePower += this.serveDir * dt * 1.05;
        if (this.servePower >= 1) { this.servePower = 1; this.serveDir = -1; }
        if (this.servePower <= 0) { this.servePower = 0; this.serveDir = 1; }
        this.hooks.serveMeter(true, this.servePower);
        if (input.wasReleased('Space')) {
          this.serveCharging = false;
          this.ctl = 'none';
          const p = this.servePower;
          let target = this.aim.clone();
          let power = p;
          if (p > PERFECT_HI) {
            // arriscou demais: pode sair longa
            if (chance((p - PERFECT_HI) * 4)) target.x = rand(9.6, 11.5);
            power = p;
          } else if (p >= PERFECT_LO) {
            this.hooks.banner('SAQUE PERFEITO!', '');
            power = 0.95;
          }
          // pouca força não passa da rede às vezes
          if (p < 0.25) target.x = rand(-0.5, 1.5);
          this.performServe(this.controlled!, Math.max(0.3, power), target);
        }
      }
    }

    if (this.ctl === 'receive' && this.controlled && this.plan && !this.plan.done) {
      // movimento direto
      if (axis.x !== 0 || axis.z !== 0) {
        this.controlled.moveTo(
          this.controlled.pos.x + axis.x * 1.2,
          this.controlled.pos.z + axis.z * 1.2,
        );
      }
      // timing do passe
      if (input.wasPressed('Space') && this.plan.contactIn < 0.5) {
        this.timingQ = clamp(1 - Math.abs(this.plan.contactIn - 0.08) * 3.2, 0, 1);
      }
      // escolha de zona já durante a recepção
      if (input.wasPressed('KeyA')) { this.chosenZone = 0; this.hooks.zoneHint(0); }
      if (input.wasPressed('KeyW')) { this.chosenZone = 1; this.hooks.zoneHint(1); }
      if (input.wasPressed('KeyD')) { this.chosenZone = 2; this.hooks.zoneHint(2); }
    }

    if (this.ctl === 'none' && this.plan && this.plan.kind === 'set' && this.plan.side === TeamSide.HOME) {
      // durante o voo até o levantador
      if (input.wasPressed('KeyA')) { this.chosenZone = 0; this.hooks.zoneHint(0); }
      if (input.wasPressed('KeyW')) { this.chosenZone = 1; this.hooks.zoneHint(1); }
      if (input.wasPressed('KeyD')) { this.chosenZone = 2; this.hooks.zoneHint(2); }
    }

    if (this.ctl === 'attack' && this.controlled && this.plan && !this.plan.done) {
      // mira aérea
      this.aim.x = clamp(this.aim.x + axis.x * dt * 6, 1.0, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 6, -4.2, 4.2);
      this.hooks.effects.showAim(this.aim);

      if (input.wasPressed('Space') && !this.controlled.isAirborne) {
        // qualidade = quão perto do instante ideal (0.26s antes do contato)
        this.jumpQ = clamp(1 - Math.abs(this.plan.contactIn - 0.26) * 2.8, 0, 1);
        this.controlled.act('spikeWindup', 0.4);
        this.controlled.jump(PLAYER.jumpVel);
      }
    }

    if (this.ctl === 'block' && this.controlled) {
      // desliza na rede
      if (axis.z !== 0) {
        this.controlled.moveTo(-0.72, clamp(this.controlled.pos.z + axis.z * 1.2, -4.2, 4.2));
      }
      if (input.wasPressed('Space') && !this.controlled.isAirborne) {
        this.controlled.act('block', 0.8);
        this.controlled.jump(PLAYER.blockJumpVel);
      }
    }
  }

  private teamOf(side: TeamSide): Team {
    return side === TeamSide.HOME ? this.home : this.away;
  }

  private after(t: number, fn: () => void): void {
    this.events.push({ t, fn });
  }
}
