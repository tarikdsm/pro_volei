import * as THREE from 'three';
import { Ball } from '../entities/Ball';
import { Team, Athlete } from './Team';
import { AudioEngine } from '../core/AudioEngine';
import { Effects } from '../systems/Effects';
import { CameraDirector, camModeForTouch } from '../systems/CameraDirector';
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
  CAMERA_FEEL,
} from '../core/constants';
import { ballisticArc, clamp } from '../core/math3d';
import { RandomHub } from '../core/random';
import { computeNetCrossing, netTouchPoint } from './mechanics/net';
import { RallyState, TouchPlan } from './RallyState';
import { prepareBlock } from './mechanics/block';
import { executeTouch } from './mechanics/touch';
import { MechanicsCtx, type GameplayRandomStreams } from './mechanics/context';
import { HumanController } from './control/HumanController';
import type { ControlFrame } from './control/ControlFrame';
import type { InputCancelReason } from '../core/input/InputFrame';
import { AiController } from './ai/AiController';
import { resolvePoint, awardPoint, pushScore, endSet, ScoringCtx } from './rules/SetMatch';
import { outOfAntennaWinner, isMatchOver } from './rules/scoring';
import { MatchTimeline } from './simulation/MatchTimeline';
import type { FeedbackPort } from './feedback/TimingFeedback';
import type { CameraFrame, CameraPhase } from '../systems/camera/CameraFrame';

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
  feedback: FeedbackPort;
  audio: AudioEngine;
  effects: Effects;
  camera: CameraDirector;
  crowd: Crowd;
  referee: Referee;
  arena: Arena;
}

type MState = 'idle' | 'servePrep' | 'rally' | 'point' | 'setEnd' | 'matchEnd';

const CAMERA_BOUNDS = {
  min: { x: -14, y: 0, z: -8 },
  max: { x: 14, y: 10, z: 8 },
} as const;

type MutableCameraPoint = { x: number; y: number; z: number };
type MutableCameraFrame = {
  ball: MutableCameraPoint;
  controlled?: MutableCameraPoint;
  destination?: MutableCameraPoint;
  bounds: CameraFrame['bounds'];
  phase: CameraPhase;
  contactIn: number | null;
};

export interface MatchOptions {
  readonly random?: RandomHub;
  readonly humanSide?: TeamSide.HOME | null;
}

export class Match {
  group = new THREE.Group();
  ball = new Ball();
  home = new Team(TeamSide.HOME);
  away = new Team(TeamSide.AWAY);

  state: MState = 'idle';
  private stateTime = 0;
  private timeline!: MatchTimeline;

  private diff: Difficulty = DIFFICULTIES[1];
  private format = MATCH_FORMATS[0];
  score: [number, number] = [0, 0];
  sets: [number, number] = [0, 0];
  setNumber = 1;
  servingTeam: TeamSide = TeamSide.HOME;
  // quem sacou primeiro no set atual — base da alternância do primeiro saque entre sets
  firstServerOfSet: TeamSide = TeamSide.HOME;

  // estado do rally (posse, toques, plano do próximo contato, eventos de rede)
  private rally = new RallyState();

  // controle humano (estado de interação + input por frame + marker)
  private human = new HumanController();
  // decisões da IA (agendamento de aproximação/pulo, qualidade, saque)
  private ai = new AiController();
  private readonly randomHub: RandomHub;
  private readonly random: GameplayRandomStreams;
  private readonly humanSide: TeamSide.HOME | null;

  private stats: MatchStats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
  private readonly cameraBall: MutableCameraPoint = { x: 0, y: 0, z: 0 };
  private readonly cameraControlled: MutableCameraPoint = { x: 0, y: 0, z: 0 };
  private readonly cameraDestination: MutableCameraPoint = { x: 0, y: 0, z: 0 };
  private readonly cameraFrame: MutableCameraFrame = {
    ball: this.cameraBall,
    bounds: CAMERA_BOUNDS,
    phase: 'rally',
    contactIn: null,
  };

  // contextos injetados (mecânica e pontuação), montados no construtor
  private ctx!: MechanicsCtx;
  private scoringCtx!: ScoringCtx;

  constructor(
    private hooks: Hooks,
    options: MatchOptions = {},
  ) {
    this.randomHub = options.random ?? new RandomHub(0);
    this.random = {
      rules: this.randomHub.stream('rules'),
      ai: this.randomHub.stream('ai'),
      contact: this.randomHub.stream('contact'),
      control: this.randomHub.stream('control'),
    };
    this.humanSide = options.humanSide === undefined ? TeamSide.HOME : options.humanSide;
    this.group.add(this.ball.group, this.home.group, this.away.group);
    this.group.add(this.human.marker);
    this.ball.hold(new THREE.Vector3(0, 1.2, 0));
    this.ctx = this.makeCtx();
    this.scoringCtx = this.makeScoringCtx();
    this.timeline = new MatchTimeline({
      rally: this.rally,
      ball: this.ball,
      ai: this.ai,
      mechanics: this.ctx,
      isRally: () => this.state === 'rally',
      advanceWorld: (seconds) => {
        this.stateTime += seconds;
        this.home.update(seconds, this.humanSpeed());
        this.away.update(seconds, PLAYER.aiSpeed * this.diff.moveSpeed);
      },
      resolveContact: (plan) => this.attemptContact(plan),
      resolveNet: () => this.onNetTouch(),
      resolveAntenna: () => this.onOutOfAntenna(),
      resolveFloor: () => this.resolveFloorContact(),
    });
  }

  startMatch(diffIdx: number, fmtIdx: number): void {
    this.diff = DIFFICULTIES[clamp(diffIdx, 0, DIFFICULTIES.length - 1)];
    this.format = MATCH_FORMATS[clamp(fmtIdx, 0, MATCH_FORMATS.length - 1)];
    this.score = [0, 0];
    this.sets = [0, 0];
    this.setNumber = 1;
    this.stats = { aces: 0, blocks: 0, longestRally: 0, points: [0, 0] };
    this.servingTeam = this.random.rules.chance(0.5) ? TeamSide.HOME : TeamSide.AWAY;
    // registra o sacador inicial (moeda da partida) para alimentar a alternância entre sets
    this.firstServerOfSet = this.servingTeam;
    // nova partida: restaura o rodízio inicial dos dois times (não herda o da partida anterior)
    this.home.resetLineup();
    this.away.resetLineup();
    pushScore(this.scoringCtx);
    this.beginServePrep();
  }

  /** Cancela ações pendentes sem expor o controle humano ao composition root. */
  cancelPendingAction(reason: InputCancelReason = 'pause'): void {
    this.human.cancelPendingAction(reason, this.ctx);
  }

  selectionSnapshot() {
    return this.human.selectionSnapshot();
  }

  actionSnapshot() {
    return this.human.actionSnapshot();
  }

  /** Snapshot readonly para o solver de apresentação; não permite mutar gameplay pela câmera. */
  cameraFrameSnapshot(): Readonly<CameraFrame> {
    const plan = this.rally.plan && !this.rally.plan.done ? this.rally.plan : null;
    const phase: CameraPhase =
      this.state === 'servePrep'
        ? 'serve'
        : this.state === 'point'
          ? 'point'
          : this.state === 'setEnd' || this.state === 'matchEnd'
            ? 'setEnd'
            : plan?.kind === 'spike' && plan.contactIn <= CAMERA_FEEL.spikeAnticipationSeconds
              ? 'spike'
              : 'rally';
    this.cameraBall.x = this.hooks.camera.ballPos.x;
    this.cameraBall.y = this.hooks.camera.ballPos.y;
    this.cameraBall.z = this.hooks.camera.ballPos.z;
    this.cameraFrame.controlled = this.human.writeCameraSubject(this.cameraControlled)
      ? this.cameraControlled
      : undefined;
    if (plan) {
      this.cameraDestination.x = plan.point.x;
      this.cameraDestination.y = plan.point.y;
      this.cameraDestination.z = plan.point.z;
      this.cameraFrame.destination = this.cameraDestination;
    } else {
      this.cameraFrame.destination = undefined;
    }
    this.cameraFrame.phase = phase;
    this.cameraFrame.contactIn = plan?.contactIn ?? null;
    return this.cameraFrame;
  }

  /**
   * Costura DE TESTE, só em desenvolvimento (import.meta.env.DEV): força o fim da partida a favor
   * de `side`, encerrando sets até bater os sets necessários do formato. Reaproveita
   * endSet(rules/SetMatch) sobre o scoringCtx — não duplica regra nem incha o orquestrador; o
   * guard de DEV a mantém fora do bundle de produção (mesmo com ?debug), então nunca vira cheat.
   * Usada pelo e2e (forceMatchEnd) para exercitar o painel de vitória sem jogar um set inteiro.
   */
  debugWinMatch(side: TeamSide): void {
    if (!import.meta.env.DEV) return;
    // cada endSet soma 1 set ao vencedor; laço com trava defensiva contra formato inesperado
    let guard = 0;
    while (!isMatchOver(this.sets[side], this.format.sets) && guard++ < 8) {
      endSet(this.scoringCtx, side);
    }
  }

  /** Cenário DEV determinístico para o E2E observar seleção e lock sem depender do rally aleatório. */
  debugAutoSelectionScenario(): void {
    if (!import.meta.env.DEV) return;
    this.timeline.clearScheduled();
    this.state = 'idle';
    this.rally.reset();
    const far = this.home.athletes[0]!;
    const close = this.home.athletes[1]!;
    far.warpTo(-8, 0);
    close.warpTo(-4, 0);
    const plan: TouchPlan = {
      planId: this.rally.allocatePlanId(),
      side: TeamSide.HOME,
      athlete: far,
      contactIn: 0.34,
      point: new THREE.Vector3(-3.5, CONTACT.pass, 0),
      kind: 'pass',
      isHuman: true,
      done: false,
    };
    this.rally.plan = plan;
    this.ball.hold(new THREE.Vector3(plan.point.x, plan.point.y + 0.4, plan.point.z));
    this.human.onAssigned(this.ctx, plan);
    this.hooks.camera.setMode('rally', { cut: true });
  }

  /** Cenário DEV determinístico de saque para E2E de tap/hold/cancelamento. */
  debugActionServeScenario(): void {
    if (!import.meta.env.DEV) return;
    this.servingTeam = TeamSide.HOME;
    this.beginServePrep();
  }

  // ---------------------------------------------------------------- SAQUE
  private beginServePrep(): void {
    this.state = 'servePrep';
    this.stateTime = 0;
    this.timeline.clearScheduled();
    this.rally.reset();
    this.human.resetForServe(this.ctx);
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
    const humanServes = this.isHumanSide(this.servingTeam);
    this.hooks.camera.setMode(humanServes ? 'serveHome' : 'serveAway', { cut: true });
    this.after(0.5, () => this.hooks.audio.whistle());

    if (humanServes) {
      this.human.beginServe(server, this.ctx);
    } else {
      this.human.awaitOpponentServe();
      this.hooks.hint('Saque do adversário — prepare a recepção!');
      this.after(this.random.ai.range(1.4, 2.4), () => this.ai.serve(this.ctx));
    }
  }

  // ---------------------------------------------------------------- PLANEJAMENTO
  /** Após cada lançamento da bola, agenda o próximo contato e eventos de rede/queda. */
  private planNext(nextKind: TouchKind): void {
    this.rally.plan = null;
    this.timeline.beginPlan();
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

    const isHuman = this.isHumanSide(landSide);
    this.rally.plan = {
      planId: this.rally.allocatePlanId(),
      side: landSide,
      athlete,
      contactIn: cT,
      point: cPoint,
      kind: nextKind,
      isHuman,
      done: false,
    };

    // Aproximação: a IA agenda o deslocamento e o pulo. No humano, ataque e levantamento mantêm
    // rotas táticas; recepção fica nas setas + assistência limitada do AutoSelector.
    if (isHuman) {
      if (nextKind === 'spike') {
        const backoff = sideSign(landSide) * 0.85;
        this.after(0, () => athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z));
      } else if (nextKind === 'set') {
        athlete.moveTo(cPoint.x, cPoint.z);
      }
    } else {
      this.ai.scheduleApproach(this.ctx, this.rally.plan);
    }

    // câmera: dramática na cortada, broadcast no resto — volta a rally após o spike
    // (defesa/passe/levantamento não ficam mais travados no enquadramento de ataque)
    this.hooks.camera.setMode(camModeForTouch(nextKind));

    // spike: preparação do bloqueio adversário (mecânica; independe do atacante)
    if (nextKind === 'spike') {
      prepareBlock(this.ctx, otherSide(landSide), cPoint.z, cT);
    }

    // controle: humano assume seu lado; contra a cortada da IA, pode bloquear
    if (isHuman) {
      this.human.onAssigned(this.ctx, this.rally.plan);
    } else if (nextKind === 'spike' && this.isHumanSide(otherSide(landSide))) {
      const humanTeam = this.teamOf(otherSide(landSide));
      this.human.assignBlock(humanTeam.nearestFrontRowTo(cPoint.z), this.ctx);
    } else {
      this.human.idle(this.ctx);
    }
  }

  private computeNetEvent(): void {
    this.timeline.beginTrajectory();
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
  update(dt: number, frame: ControlFrame): void {
    this.ball.beginFixedStep();
    this.home.beginFixedStep();
    this.away.beginFixedStep();
    this.human.update(dt, frame, this.ctx);
    this.timeline.step(dt);
    this.ball.endFixedStep();
  }

  /** Apresentação interpolada; não altera posições ou timers lógicos da simulação. */
  present(alpha: number): void {
    this.home.present(alpha);
    this.away.present(alpha);
    this.human.presentMarker();
    this.hooks.camera.ballPos.copy(this.ball.present(alpha));
  }

  /** Alinha previous/current após pausas ou teletransportes para a apresentação não recuar. */
  snapPresentation(): void {
    this.ball.beginFixedStep();
    this.home.beginFixedStep();
    this.away.beginFixedStep();
    this.present(1);
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
    const intent = isHuman ? this.human.takeContactIntent(plan.planId) : null;
    const reach = isHuman ? this.human.contactReach() : CONTACT.reach;
    if (d <= reach) {
      const q = isHuman
        ? this.human.reachQuality(hard, medium, this.ctx)
        : this.ai.reachQuality(this.ctx, hard);
      if (isHuman && intent) this.emitTimingFeedback(plan, Math.max(0, q));
      if (q >= 0) executeTouch(this.ctx, plan, q, intent ?? undefined);
      else a.act('dive', 0.8); // tentou e não conseguiu
    } else if (d <= CONTACT.lungeReach) {
      // peixinho!
      a.act('dive', 0.8);
      const saveP = hard ? 0.35 : 0.75;
      if (this.random.contact.chance(saveP)) {
        this.hooks.crowd.excite(0.6);
        const q = this.random.contact.range(0.08, 0.35);
        if (isHuman && intent) this.emitTimingFeedback(plan, q);
        executeTouch(this.ctx, plan, q, intent ?? undefined);
      } else if (isHuman && intent) {
        this.emitTimingFeedback(plan, 0);
      }
    } else if (isHuman && intent) {
      this.emitTimingFeedback(plan, 0);
    }
    // fora de alcance: nada acontece — a bola vai cair e o ponto será resolvido
    this.human.clearTiming();
  }

  private attemptSpikeContact(plan: TouchPlan, d: number): void {
    const a = plan.athlete;
    const isHuman = plan.isHuman;
    const airborne = a.isAirborne && a.jumpY > 0.2;
    const intent = isHuman ? this.human.takeContactIntent(plan.planId) : null;

    if (airborne && d <= 1.0) {
      const q = isHuman ? this.human.spikeQuality() : this.ai.spikeQuality(this.ctx);
      if (isHuman && intent) this.emitTimingFeedback(plan, q);
      executeTouch(this.ctx, plan, q, intent ?? undefined);
    } else if (d <= CONTACT.lungeReach) {
      if (isHuman && intent) this.emitTimingFeedback(plan, 0);
      // não pulou/perdeu o tempo: bola de graça por cima (com risco de sair)
      a.act('set', 0.5);
      this.hooks.audio.hitSoft();
      const enemy = otherSide(plan.side);
      const s = sideSign(enemy);
      const target = this.random.contact.chance(0.12)
        ? new THREE.Vector3(
            s * this.random.contact.range(9.6, 10.8),
            0,
            this.random.contact.range(-5, 5),
          )
        : new THREE.Vector3(
            s * this.random.contact.range(3, 7),
            0,
            this.random.contact.range(-3, 3),
          );
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
    } else if (isHuman && intent) {
      this.emitTimingFeedback(plan, 0);
    }
    this.human.clearJump();
  }

  private emitTimingFeedback(plan: TouchPlan, finalQuality: number): void {
    const event = this.human.takeTimingFeedback(plan.planId, finalQuality, plan.point);
    if (event) this.hooks.feedback.emit(event);
  }

  /** Resolve o primeiro contato analítico com o piso no instante exato do tick. */
  private resolveFloorContact(): void {
    this.ball.pos.y = BALL_RADIUS;
    this.hooks.audio.bounce();
    this.hooks.effects.burst(this.ball.pos, 0xd8b06a, 14, 3);
    this.hooks.camera.addShake(0.25);
    resolvePoint(this.scoringCtx);
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
      random: this.random,
      isHumanSide: (side) => this.isHumanSide(side),
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
      takeHumanBlockIntent: (planId) => {
        const intent = this.human.takeBlockIntent(planId);
        if (intent) {
          const quality = clamp(intent.precision * (0.75 + intent.penetration * 0.25), 0, 1);
          const event = this.human.takeTimingFeedback(planId, quality, this.ball.pos);
          if (event) this.hooks.feedback.emit(event);
        }
        return intent;
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
    const getFirstServer = () => this.firstServerOfSet;
    const setFirstServer = (s: TeamSide) => {
      this.firstServerOfSet = s;
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
      get firstServerOfSet() {
        return getFirstServer();
      },
      set firstServerOfSet(s) {
        setFirstServer(s);
      },
      coinTossSide: () => (this.random.rules.chance(0.5) ? TeamSide.HOME : TeamSide.AWAY),
      teamOf: (side) => this.teamOf(side),
      after: (t, fn) => this.after(t, fn),
      releaseControl: () => this.human.release(),
      beginServePrep: () => this.beginServePrep(),
      enterPoint: () => {
        this.state = 'point';
        this.stateTime = 0;
        this.timeline.clearScheduled();
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

  private isHumanSide(side: TeamSide): boolean {
    return this.humanSide !== null && side === this.humanSide;
  }

  private after(t: number, fn: () => void): void {
    this.timeline.after(t, fn);
  }
}
