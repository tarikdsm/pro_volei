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
  CONTACT,
  PLAYER,
  BALL_RADIUS,
  TeamSide,
  otherSide,
  sideSign,
  Difficulty,
  DIFFICULTIES,
  SERVE_SPOT,
  MATCH_FORMATS,
  TouchKind,
} from '../core/constants';
import { ballisticArc, clamp, lerp, rand, chance, randPick } from '../core/math3d';
import {
  isSetOver,
  setWinner,
  isMatchOver,
  setPointLeader,
  isAce,
  resolveRallyOutcome,
} from './rules/scoring';
import { computeNetCrossing } from './mechanics/net';
import { RallyState, TouchPlan } from './RallyState';
import { prepareBlock } from './mechanics/block';
import { executeTouch } from './mechanics/touch';
import { performServe, aiServe } from './mechanics/serve';
import { MechanicsCtx } from './mechanics/context';

export interface MatchStats {
  aces: number;
  blocks: number;
  longestRally: number;
  points: [number, number];
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

interface PendingEvent {
  t: number;
  fn: () => void;
}

const PERFECT_LO = 0.72,
  PERFECT_HI = 0.92;

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

  // estado do rally (posse, toques, plano do próximo contato, eventos de rede)
  private rally = new RallyState();

  // controle humano
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private serveCharging = false;
  private servePower = 0;
  private serveDir = 1;
  private aim = new THREE.Vector3(5.5, 0, 0);
  private timingQ = -1; // qualidade do aperto de ESPAÇO na recepção
  private jumpQ = -1; // qualidade do timing do pulo no ataque
  private chosenZone = 0; // 0 esq, 1 centro, 2 dir
  private marker: THREE.Mesh; // anel sob o jogador controlado

  private stats: MatchStats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };

  // contexto injetado nas funções de mecânica (mechanics/*), montado no construtor
  private ctx!: MechanicsCtx;

  constructor(private hooks: Hooks) {
    this.group.add(this.ball.group, this.home.group, this.away.group);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 24),
      new THREE.MeshBasicMaterial({
        color: 0x40ff9f,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.group.add(this.marker);
    this.ball.hold(new THREE.Vector3(0, 1.2, 0));
    this.ctx = this.makeCtx();
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
    this.rally.reset();
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
    const spot =
      this.servingTeam === TeamSide.HOME ? SERVE_SPOT : { x: -SERVE_SPOT.x, z: -SERVE_SPOT.z };
    server.warpTo(spot.x, spot.z);
    this.ball.hold(
      new THREE.Vector3(spot.x + sideSign(otherSide(this.servingTeam)) * 0.25, 1.15, spot.z),
    );

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
      this.hooks.hint(
        'SEGURE ESPAÇO para carregar o saque — solte na zona verde · WASD ajusta a mira',
      );
      this.hooks.serveMeter(true, 0);
    } else {
      this.ctl = 'none';
      this.controlled = null;
      this.hooks.hint('Saque do adversário — prepare a recepção!');
      this.after(rand(1.4, 2.4), () => aiServe(this.ctx));
    }
  }

  // ---------------------------------------------------------------- PLANEJAMENTO
  /** Após cada lançamento da bola, agenda o próximo contato e eventos de rede/queda. */
  private planNext(nextKind: TouchKind): void {
    this.rally.plan = null;
    this.computeNetEvent();

    const landing = this.ball.predictLanding();
    if (landing.time <= 0) return;

    const landSide: TeamSide = landing.point.x < 0 ? TeamSide.HOME : TeamSide.AWAY;

    // bola indo para o time que já usou 3 toques (e não pode mais) → ninguém joga, deixa cair
    if (this.rally.possessionTeam === landSide && this.rally.possessionTouches >= 3) return;

    const contactH =
      nextKind === 'set' ? CONTACT.set : nextKind === 'spike' ? CONTACT.spike : CONTACT.pass;
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
      athlete =
        this.rally.setterHold ?? team.nearestTo(sp.x, sp.z, this.rally.lastToucher ?? undefined);
    } else if (nextKind === 'spike') {
      athlete =
        this.rally.plannedAttacker ??
        team.nearestFrontRowTo(cPoint.z, this.rally.lastToucher ?? undefined);
    } else {
      athlete = team.nearestTo(cPoint.x, cPoint.z);
    }

    const isHuman = landSide === TeamSide.HOME;
    this.rally.plan = {
      side: landSide,
      athlete,
      contactIn: cT,
      point: cPoint,
      kind: nextKind,
      isHuman,
      done: false,
    };

    // IA (ou aproximação automática p/ humano): manda o atleta para o ponto de contato
    const delay = isHuman ? 0 : this.diff.reactionDelay;
    if (nextKind === 'spike') {
      // atacante corre para trás do ponto de contato; o pulo leva até ele
      const backoff = sideSign(landSide) * 0.85;
      this.after(delay, () => athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z));
      if (!isHuman) {
        // IA pula para contato no ápice
        this.rally.plan.jumpScheduledIn = cT - 0.26;
      }
      // câmera de ataque + bloqueio adversário
      this.hooks.camera.setMode('spike');
      prepareBlock(this.ctx, otherSide(landSide), cPoint.z, cT);
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
        this.hooks.effects.showLanding(this.rally.plan.point);
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
    } else if (this.rally.plan.side === TeamSide.AWAY && nextKind === 'spike') {
      // humano pode bloquear
      this.ctl = 'block';
      const blocker = this.home.nearestFrontRowTo(cPoint.z);
      this.controlled = blocker;
      this.hooks.hint('BLOQUEIO: A/D desliza na rede · ESPAÇO pula!');
    } else if (this.rally.plan.side === TeamSide.AWAY) {
      if (this.ctl !== 'block') {
        this.ctl = 'none';
        this.controlled = null;
      }
      this.hooks.effects.showLanding(null);
    }
  }

  private computeNetEvent(): void {
    this.rally.netEventIn = null;
    this.rally.crossIn = null;
    const crossing = computeNetCrossing(this.ball.pos, this.ball.vel);
    if (crossing.kind === 'net') this.rally.netEventIn = crossing.t;
    else if (crossing.kind === 'cross') this.rally.crossIn = crossing.t;
  }

  // ---------------------------------------------------------------- PONTO
  private resolvePoint(): void {
    const { winner, inCourt, landSide } = resolveRallyOutcome(
      this.ball.pos,
      this.rally.lastTouchTeam,
      this.servingTeam,
    );
    const reason = inCourt
      ? landSide === TeamSide.HOME
        ? 'Bola no seu chão'
        : 'Bola no chão deles!'
      : 'Bola fora';
    this.awardPoint(winner, reason);
  }

  private awardPoint(winner: TeamSide, reason: string): void {
    if (this.state !== 'rally') return;
    this.state = 'point';
    this.stateTime = 0;
    this.events = [];
    this.rally.plan = null;
    this.ctl = 'none';
    this.controlled = null;
    this.ball.bouncy = true;
    this.hooks.effects.showLanding(null);
    this.hooks.effects.showAim(null);
    this.hooks.serveMeter(false);
    this.hooks.zoneHint(null);

    const ace = isAce(this.rally.lastKind, winner, this.servingTeam, this.rally.rallyTouches);
    this.score[winner]++;
    this.stats.points[winner]++;
    this.stats.longestRally = Math.max(this.stats.longestRally, this.rally.rallyTouches);

    // banners com personalidade
    let text = winner === TeamSide.HOME ? 'PONTO SEU!' : 'PONTO DO CPU';
    if (ace) {
      text = winner === TeamSide.HOME ? '🔥 ACE!' : 'ACE DO CPU';
      if (winner === TeamSide.HOME) this.stats.aces++;
    } else if (this.rally.rallyTouches >= 8) text = `QUE RALLY! ${this.rally.rallyTouches} toques`;
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
    const setOver = isSetOver(h, a, target);
    this.after(2.6, () => {
      if (setOver) this.endSet(setWinner(h, a));
      else this.beginServePrep();
    });

    // set point / match point aviso
    const spLeader = setPointLeader(h, a, target);
    if (spLeader !== null) {
      this.after(1.4, () =>
        this.hooks.banner(spLeader === TeamSide.HOME ? 'SET POINT — VOCÊ!' : 'SET POINT — CPU', ''),
      );
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

    const matchOver = isMatchOver(this.sets[winner], this.format.sets);
    this.hooks.banner(
      matchOver ? '' : winner === TeamSide.HOME ? 'SET SEU! 🏐' : 'SET DO CPU',
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
    this.hooks.setScore(
      this.score[0],
      this.score[1],
      this.sets[0],
      this.sets[1],
      this.setNumber,
      this.servingTeam,
    );
    this.hooks.arena.updateScoreboard(
      this.score[0],
      this.score[1],
      this.sets[0],
      this.sets[1],
      this.setNumber,
    );
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
    if (this.rally.plan && !this.rally.plan.done && this.state === 'rally') {
      this.rally.plan.contactIn -= dt;

      // pulo agendado da IA no ataque
      if (this.rally.plan.jumpScheduledIn !== undefined) {
        this.rally.plan.jumpScheduledIn -= dt;
        if (this.rally.plan.jumpScheduledIn <= 0) {
          this.rally.plan.athlete.act('spikeWindup', 0.4);
          this.rally.plan.athlete.jump(PLAYER.jumpVel);
          this.rally.plan.jumpScheduledIn = undefined;
        }
      }

      // bloqueadores IA pulam
      for (let i = this.rally.blockers.length - 1; i >= 0; i--) {
        this.rally.blockers[i].jumpIn -= dt;
        if (this.rally.blockers[i].jumpIn <= 0) {
          this.rally.blockers[i].athlete.act('block', 0.7);
          this.rally.blockers[i].athlete.jump(PLAYER.blockJumpVel);
          this.rally.blockers.splice(i, 1);
        }
      }

      if (this.rally.plan.contactIn <= 0) {
        this.attemptContact(this.rally.plan);
      }
    }

    // evento de rede
    if (this.rally.netEventIn !== null && this.state === 'rally') {
      this.rally.netEventIn -= dt;
      if (this.rally.netEventIn <= 0) {
        this.rally.netEventIn = null;
        this.onNetTouch();
      }
    }

    // bola no chão durante rally
    if (
      this.state === 'rally' &&
      this.ball.inFlight &&
      this.ball.pos.y <= BALL_RADIUS + 0.005 &&
      this.ball.vel.y < 0
    ) {
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
    if (
      this.controlled &&
      (this.ctl === 'receive' ||
        this.ctl === 'attack' ||
        this.ctl === 'block' ||
        this.ctl === 'serve')
    ) {
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

    // bola rápida é mais difícil de defender — cortadas fortes furam defesa passiva
    const speed = this.ball.vel.length();
    const hard = speed > 15;
    const medium = speed > 9.5;

    const isHuman = plan.isHuman;
    if (d <= CONTACT.reach) {
      let q: number;
      if (isHuman) {
        if (this.timingQ >= 0) {
          // apertou no tempo: defende, qualidade cai um pouco contra bola forte
          q = (0.45 + 0.55 * this.timingQ) * (hard ? 0.8 : 1);
          if (this.timingQ > 0.8 && !hard) this.hooks.banner('PERFEITO!', '');
          if (this.timingQ > 0.7 && hard) this.hooks.banner('DEFESAÇA!', '');
        } else {
          // sem apertar: o toque automático falha contra bolas rápidas
          const missP = hard ? 0.6 : medium ? 0.28 : 0;
          if (chance(missP)) {
            q = chance(0.5) ? rand(0.02, 0.12) : -1; // escorrega ou perde limpo
          } else {
            q = hard ? 0.3 : 0.45;
          }
        }
      } else {
        // IA: contra bola forte, defesa depende da dificuldade
        if (hard && !chance(this.diff.digChance)) {
          q = chance(0.55) ? rand(0.03, 0.12) : -1;
        } else {
          q = rand(this.diff.passQuality[0], this.diff.passQuality[1]) * (hard ? 0.75 : 1);
        }
      }
      if (q >= 0) executeTouch(this.ctx, plan, q);
      else a.act('dive', 0.8); // tentou e não conseguiu
    } else if (d <= CONTACT.lungeReach) {
      // peixinho!
      a.act('dive', 0.8);
      const saveP = hard ? 0.35 : 0.75;
      if (chance(saveP)) {
        this.hooks.crowd.excite(0.6);
        executeTouch(this.ctx, plan, rand(0.08, 0.35));
      }
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
      executeTouch(this.ctx, plan, q);
    } else if (d <= CONTACT.lungeReach) {
      // não pulou/perdeu o tempo: bola de graça por cima (com risco de sair)
      a.act('set', 0.5);
      this.hooks.audio.hitSoft();
      const enemy = otherSide(plan.side);
      const s = sideSign(enemy);
      const target = chance(0.12)
        ? new THREE.Vector3(s * rand(9.6, 10.8), 0, rand(-5, 5))
        : new THREE.Vector3(s * rand(3, 7), 0, rand(-3, 3));
      const { v0 } = ballisticArc(this.ball.pos.clone(), target, 3.2);
      this.ball.launch(this.ball.pos.clone(), v0);
      // conta o toque
      this.rally.countTouch(plan.side);
      this.rally.lastTouchTeam = plan.side;
      this.rally.lastKind = 'freeball';
      this.rally.lastToucher = a;
      this.rally.rallyTouches++;
      this.hooks.banner('', '');
      this.planNext('pass');
    }
    this.jumpQ = -1;
  }

  private onNetTouch(): void {
    this.hooks.audio.netTouch();
    this.hooks.camera.addShake(0.2);
    const wasServe = this.rally.lastKind === 'serve';
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
        if (this.servePower >= 1) {
          this.servePower = 1;
          this.serveDir = -1;
        }
        if (this.servePower <= 0) {
          this.servePower = 0;
          this.serveDir = 1;
        }
        this.hooks.serveMeter(true, this.servePower);
        if (input.wasReleased('Space')) {
          this.serveCharging = false;
          this.ctl = 'none';
          const p = this.servePower;
          const target = this.aim.clone();
          let power = p;
          // folga sobre a rede: força alta = raspando na fita, baixa = flutuante
          let clearance = lerp(1.3, 0.16, p) * rand(0.92, 1.08);
          if (p > PERFECT_HI) {
            // arriscou demais: pode sair longa
            if (chance((p - PERFECT_HI) * 4)) {
              target.x = rand(9.6, 11.5);
              clearance = rand(0.25, 0.6);
            }
          } else if (p >= PERFECT_LO) {
            this.hooks.banner('SAQUE PERFEITO!', '');
            power = 0.95;
            clearance = rand(0.16, 0.28);
          }
          // pouca força morre na rede às vezes
          if (p < 0.25 && chance(0.7)) clearance = -rand(0.2, 0.5);
          performServe(this.ctx, this.controlled!, Math.max(0.3, power), target, clearance);
        }
      }
    }

    if (this.ctl === 'receive' && this.controlled && this.rally.plan && !this.rally.plan.done) {
      // movimento direto
      if (axis.x !== 0 || axis.z !== 0) {
        this.controlled.moveTo(
          this.controlled.pos.x + axis.x * 1.2,
          this.controlled.pos.z + axis.z * 1.2,
        );
      }
      // timing do passe
      if (input.wasPressed('Space') && this.rally.plan.contactIn < 0.5) {
        this.timingQ = clamp(1 - Math.abs(this.rally.plan.contactIn - 0.08) * 3.2, 0, 1);
      }
      // escolha de zona já durante a recepção
      if (input.wasPressed('KeyA')) {
        this.chosenZone = 0;
        this.hooks.zoneHint(0);
      }
      if (input.wasPressed('KeyW')) {
        this.chosenZone = 1;
        this.hooks.zoneHint(1);
      }
      if (input.wasPressed('KeyD')) {
        this.chosenZone = 2;
        this.hooks.zoneHint(2);
      }
    }

    if (
      this.ctl === 'none' &&
      this.rally.plan &&
      this.rally.plan.kind === 'set' &&
      this.rally.plan.side === TeamSide.HOME
    ) {
      // durante o voo até o levantador
      if (input.wasPressed('KeyA')) {
        this.chosenZone = 0;
        this.hooks.zoneHint(0);
      }
      if (input.wasPressed('KeyW')) {
        this.chosenZone = 1;
        this.hooks.zoneHint(1);
      }
      if (input.wasPressed('KeyD')) {
        this.chosenZone = 2;
        this.hooks.zoneHint(2);
      }
    }

    if (this.ctl === 'attack' && this.controlled && this.rally.plan && !this.rally.plan.done) {
      // mira aérea
      this.aim.x = clamp(this.aim.x + axis.x * dt * 6, 1.0, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 6, -4.2, 4.2);
      this.hooks.effects.showAim(this.aim);

      if (input.wasPressed('Space') && !this.controlled.isAirborne) {
        // qualidade = quão perto do instante ideal (0.26s antes do contato)
        this.jumpQ = clamp(1 - Math.abs(this.rally.plan.contactIn - 0.26) * 2.8, 0, 1);
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

  /** Monta o contexto passado às funções de mecânica; getters mantêm vivos os valores mutáveis. */
  private makeCtx(): MechanicsCtx {
    // arrows capturam `this` (Match) lexicamente; getters mantêm vivos os valores mutáveis
    const diff = () => this.diff;
    const servingTeam = () => this.servingTeam;
    const chosenZone = () => this.chosenZone;
    const stats = () => this.stats;
    return {
      ball: this.ball,
      rally: this.rally,
      hooks: this.hooks,
      aim: this.aim,
      get diff() {
        return diff();
      },
      get servingTeam() {
        return servingTeam();
      },
      get chosenZone() {
        return chosenZone();
      },
      get stats() {
        return stats();
      },
      teamOf: (side) => this.teamOf(side),
      after: (t, fn) => this.after(t, fn),
      planNext: (kind) => this.planNext(kind),
      startRally: () => {
        this.state = 'rally';
      },
    };
  }

  private teamOf(side: TeamSide): Team {
    return side === TeamSide.HOME ? this.home : this.away;
  }

  private after(t: number, fn: () => void): void {
    this.events.push({ t, fn });
  }
}
