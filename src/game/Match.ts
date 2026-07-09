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
import { ballisticArc, clamp, rand, chance } from '../core/math3d';
import { computeNetCrossing, netTouchPoint } from './mechanics/net';
import { RallyState, TouchPlan } from './RallyState';
import { prepareBlock } from './mechanics/block';
import { executeTouch } from './mechanics/touch';
import { MechanicsCtx } from './mechanics/context';
import { HumanController } from './control/HumanController';
import { AiController } from './ai/AiController';
import { resolvePoint, awardPoint, pushScore, ScoringCtx } from './rules/SetMatch';
import { outOfAntennaWinner } from './rules/scoring';

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

interface PendingEvent {
  t: number;
  fn: () => void;
}

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

  // controle humano (estado de interação + input por frame + marker)
  private human = new HumanController();
  // decisões da IA (agendamento de aproximação/pulo, qualidade, saque)
  private ai = new AiController();

  private stats: MatchStats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };

  // contextos injetados (mecânica e pontuação), montados no construtor
  private ctx!: MechanicsCtx;
  private scoringCtx!: ScoringCtx;

  constructor(private hooks: Hooks) {
    this.group.add(this.ball.group, this.home.group, this.away.group);
    this.group.add(this.human.marker);
    this.ball.hold(new THREE.Vector3(0, 1.2, 0));
    this.ctx = this.makeCtx();
    this.scoringCtx = this.makeScoringCtx();
  }

  startMatch(diffIdx: number, fmtIdx: number): void {
    this.diff = DIFFICULTIES[clamp(diffIdx, 0, DIFFICULTIES.length - 1)];
    this.format = MATCH_FORMATS[clamp(fmtIdx, 0, MATCH_FORMATS.length - 1)];
    this.score = [0, 0];
    this.sets = [0, 0];
    this.setNumber = 1;
    this.stats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
    this.servingTeam = chance(0.5) ? TeamSide.HOME : TeamSide.AWAY;
    pushScore(this.scoringCtx);
    this.beginServePrep();
  }

  // ---------------------------------------------------------------- SAQUE
  private beginServePrep(): void {
    this.state = 'servePrep';
    this.stateTime = 0;
    this.events = [];
    this.rally.reset();
    this.human.resetForServe();
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
      this.human.beginServe(server, this.ctx);
    } else {
      this.human.awaitOpponentServe();
      this.hooks.hint('Saque do adversário — prepare a recepção!');
      this.after(rand(1.4, 2.4), () => this.ai.serve(this.ctx));
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
      athlete = team.nearestTo(cPoint.x, cPoint.z, this.rally.excludedPasser(landSide));
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

    // aproximação: a IA agenda o deslocamento (reactionDelay) e o pulo no ataque; o humano recebe
    // um nudge inicial (delay 0) e assume com WASD — o levantador humano é automático.
    if (isHuman) {
      if (nextKind === 'spike') {
        const backoff = sideSign(landSide) * 0.85;
        this.after(0, () => athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z));
      } else if (nextKind === 'set') {
        athlete.moveTo(cPoint.x, cPoint.z);
      } else {
        this.after(0, () => athlete.moveTo(cPoint.x, cPoint.z));
      }
    } else {
      this.ai.scheduleApproach(this.ctx, this.rally.plan);
    }

    // spike: câmera de ataque + preparação do bloqueio adversário (mecânica; independe do atacante)
    if (nextKind === 'spike') {
      this.hooks.camera.setMode('spike');
      prepareBlock(this.ctx, otherSide(landSide), cPoint.z, cT);
    }

    // controle: humano assume seu lado; contra a cortada da IA, pode bloquear
    if (isHuman) {
      this.human.onAssigned(this.ctx, this.rally.plan);
    } else if (nextKind === 'spike') {
      this.human.assignBlock(this.home.nearestFrontRowTo(cPoint.z), this.ctx);
    } else {
      this.human.idle(this.ctx);
    }
  }

  private computeNetEvent(): void {
    this.rally.netEventIn = null;
    this.rally.outAntennaIn = null;
    this.rally.netEventPoint = null;
    const crossing = computeNetCrossing(this.ball.pos, this.ball.vel);
    if (crossing.kind === 'net') {
      this.rally.netEventIn = crossing.t;
      this.rally.netEventPoint = netTouchPoint(crossing);
    } else if (crossing.kind === 'outAntenna') {
      this.rally.outAntennaIn = crossing.t;
    }
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
    this.human.update(dt, input, this.ctx);

    // contato agendado
    if (this.rally.plan && !this.rally.plan.done && this.state === 'rally') {
      this.rally.plan.contactIn -= dt;

      // pulos agendados da IA (atacante no ápice + bloqueadores)
      this.ai.updateScheduledJumps(dt, this.ctx);

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

    // cruzamento fora do corredor das antenas → falta imediata de quem enviou
    if (this.rally.outAntennaIn !== null && this.state === 'rally') {
      this.rally.outAntennaIn -= dt;
      if (this.rally.outAntennaIn <= 0) {
        this.rally.outAntennaIn = null;
        this.onOutOfAntenna();
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
      resolvePoint(this.scoringCtx);
    }

    // física e visual
    this.ball.step(dt);
    this.hooks.camera.ballPos.copy(this.ball.pos);
    this.home.update(dt, this.humanSpeed());
    this.away.update(dt, PLAYER.aiSpeed * this.diff.moveSpeed);

    // anel do jogador controlado (após o movimento dos times integrar)
    this.human.updateMarker();
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
      const q = isHuman
        ? this.human.reachQuality(hard, medium, this.ctx)
        : this.ai.reachQuality(this.ctx, hard);
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
    this.human.clearTiming();
  }

  private attemptSpikeContact(plan: TouchPlan, d: number): void {
    const a = plan.athlete;
    const isHuman = plan.isHuman;
    const airborne = a.isAirborne && a.jumpY > 0.2;

    if (airborne && d <= 1.0) {
      const q = isHuman ? this.human.spikeQuality() : this.ai.spikeQuality();
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
      const { v0 } = ballisticArc(plan.point.clone(), target, 3.2);
      this.ball.launch(plan.point.clone(), v0);
      // conta o toque
      this.rally.countTouch(plan.side);
      this.rally.lastTouchTeam = plan.side;
      this.rally.lastKind = 'freeball';
      this.rally.lastToucher = a;
      this.rally.rallyTouches++;
      this.hooks.banner('', '');
      this.planNext('pass');
    }
    this.human.clearJump();
  }

  private onNetTouch(): void {
    this.hooks.audio.netTouch();
    this.hooks.camera.addShake(0.2);
    // snap ao ponto analítico de cruzamento antes de amortecer a velocidade
    // (a bola ainda está na posição integrada do frame anterior neste handler)
    if (this.rally.netEventPoint) {
      this.ball.pos.copy(this.rally.netEventPoint);
      this.rally.netEventPoint = null;
    }
    const wasServe = this.rally.lastKind === 'serve';
    // bola morre na rede: cai do lado de quem tocou
    const v = this.ball.vel;
    this.ball.vel.set(-Math.sign(v.x) * Math.abs(v.x) * 0.06, Math.min(v.y, 0.5), v.z * 0.25);

    if (wasServe) {
      // saque na rede = ponto do recebedor
      this.after(0.5, () => {
        if (this.state === 'rally') {
          awardPoint(this.scoringCtx, otherSide(this.servingTeam), 'Saque na rede');
        }
      });
      return;
    }
    // rally: a bola ainda é jogável no lado de quem atacou (escaparam do bloqueio etc.)
    this.hooks.banner('NA REDE!', 'bola viva!');
    this.planNext('pass');
  }

  /**
   * Cruzamento fora do corredor das antenas: falta imediata de quem enviou a bola.
   * Concede o ponto na hora — assim o estado sai de 'rally' e a queda da bola não é
   * mais resolvida como ponto normal (evita premiar quem enviou fora da antena).
   */
  private onOutOfAntenna(): void {
    this.hooks.camera.addShake(0.2);
    const winner = outOfAntennaWinner(this.rally.lastTouchTeam, this.servingTeam);
    // awardPoint já apita (whistleLong), monta o banner e faz o guard isRally interno.
    awardPoint(this.scoringCtx, winner, 'Fora da antena');
  }

  /** Monta o contexto passado às funções de mecânica; getters mantêm vivos os valores mutáveis. */
  private makeCtx(): MechanicsCtx {
    // arrows capturam `this` (Match) lexicamente; getters mantêm vivos os valores mutáveis
    const diff = () => this.diff;
    const servingTeam = () => this.servingTeam;
    const chosenZone = () => this.human.chosenZone;
    const stats = () => this.stats;
    return {
      ball: this.ball,
      rally: this.rally,
      hooks: this.hooks,
      aim: this.human.aim,
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

  /** Contexto do fluxo de pontuação (rules/SetMatch): acesso ao placar + transições de estado. */
  private makeScoringCtx(): ScoringCtx {
    // closures capturam `this` (Match); getters/setters mantêm vivos os valores mutáveis
    const score = () => this.score;
    const sets = () => this.sets;
    const stats = () => this.stats;
    const format = () => this.format;
    const getServing = () => this.servingTeam;
    const setServing = (s: TeamSide) => {
      this.servingTeam = s;
    };
    const getSetNumber = () => this.setNumber;
    const setSetNumber = (n: number) => {
      this.setNumber = n;
    };
    return {
      ball: this.ball,
      rally: this.rally,
      hooks: this.hooks,
      get score() {
        return score();
      },
      get sets() {
        return sets();
      },
      get stats() {
        return stats();
      },
      get format() {
        return format();
      },
      get servingTeam() {
        return getServing();
      },
      set servingTeam(s) {
        setServing(s);
      },
      get setNumber() {
        return getSetNumber();
      },
      set setNumber(n) {
        setSetNumber(n);
      },
      teamOf: (side) => this.teamOf(side),
      after: (t, fn) => this.after(t, fn),
      releaseControl: () => this.human.release(),
      beginServePrep: () => this.beginServePrep(),
      enterPoint: () => {
        this.state = 'point';
        this.stateTime = 0;
        this.events = [];
      },
      enterSetEnd: () => {
        this.state = 'setEnd';
        this.stateTime = 0;
      },
      enterMatchEnd: () => {
        this.state = 'matchEnd';
      },
      isRally: () => this.state === 'rally',
    };
  }

  private teamOf(side: TeamSide): Team {
    return side === TeamSide.HOME ? this.home : this.away;
  }

  private after(t: number, fn: () => void): void {
    this.events.push({ t, fn });
  }
}
