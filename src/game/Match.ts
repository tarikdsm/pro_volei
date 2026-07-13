import * as THREE from 'three';
import { Ball } from '../entities/Ball';
import { Team, Athlete, type TeamFactory } from './Team';
import { camModeForTouch } from './camera/CameraMode';
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
  BLOCK,
} from '../core/constants';
import { ballisticArc, clamp } from '../core/math3d';
import { RandomHub } from '../core/random';
import { computeNetCrossing, netTouchPoint } from './mechanics/net';
import { contactSideAt } from './mechanics/contactSide';
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
import type { CameraFrame, CameraPhase } from '../systems/camera/CameraFrame';
import type { MatchHooks as Hooks, MatchStats } from './ports/MatchHooks';
import type { CharFactory } from '../entities/PlayerCharacter';
import type { MatchBallPort } from './simulation/BallSimulationPort';
import type {
  SimulationEventDraft,
  SimulationTelemetryEvent,
  SimulationTelemetryPort,
} from './simulation/SimulationTelemetry';
import { TeamTacticsSystem } from './team/TeamTacticsSystem';
import type { AthleteTacticalSnapshot, TeamPlan, TeamTacticsPhase } from './team/TeamTactics';

export type { MatchHooks as Hooks, MatchStats } from './ports/MatchHooks';

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
  readonly ball?: MatchBallPort;
  readonly charFactory?: CharFactory;
  readonly teamFactory?: TeamFactory;
  readonly telemetry?: SimulationTelemetryPort;
}

export class Match {
  readonly group = new THREE.Group();
  readonly ball: MatchBallPort;
  readonly home: Team;
  readonly away: Team;

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
  private readonly human: HumanController;
  // decisões da IA (agendamento de aproximação/pulo, qualidade, saque)
  private ai = new AiController();
  private readonly randomHub: RandomHub;
  private readonly random: GameplayRandomStreams;
  private readonly humanSide: TeamSide.HOME | null;
  private readonly telemetry: SimulationTelemetryPort | null;
  private readonly telemetryOutbox: Readonly<SimulationTelemetryEvent>[] = [];
  private telemetryEnabled = true;
  private simulationTick = 0;
  private readonly teamTactics = new TeamTacticsSystem();
  private lastHumanSelectionRevision = 0;

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
    const makeTeam = options.teamFactory ?? ((side, makeChar) => new Team(side, makeChar));
    this.humanSide = options.humanSide === undefined ? TeamSide.HOME : options.humanSide;
    this.telemetry = options.telemetry ?? null;
    this.human = new HumanController(this.humanSide !== null);
    this.ball = options.ball ?? new Ball();
    this.home = makeTeam(TeamSide.HOME, options.charFactory);
    this.away = makeTeam(TeamSide.AWAY, options.charFactory);
    this.randomHub = options.random ?? new RandomHub(0);
    this.random = {
      rules: this.randomHub.stream('rules'),
      ai: this.randomHub.stream('ai'),
      contact: this.randomHub.stream('contact'),
      control: this.randomHub.stream('control'),
    };
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
        const controlledAthleteId = this.human.controlSnapshot().athleteId;
        this.home.update(seconds, (athlete) => this.speedFor(athlete, controlledAthleteId));
        this.away.update(seconds, (athlete) => this.speedFor(athlete, controlledAthleteId));
      },
      resolveContact: (plan) => this.attemptContact(plan),
      resolveNet: () => this.onNetTouch(),
      resolveAntenna: () => this.onOutOfAntenna(),
      resolveFloor: () => this.resolveFloorContact(),
    });
  }

  startMatch(diffIdx: number, fmtIdx: number): void {
    this.simulationTick = 0;
    this.teamTactics.reset();
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

  teamTacticsSnapshot(side: TeamSide): TeamPlan | null {
    return this.teamTactics.snapshot(side);
  }

  /** Estado físico observado pelo trace headless; separado das promessas do TeamBrain. */
  teamTacticsAthletesSnapshot(side: TeamSide): readonly AthleteTacticalSnapshot[] {
    const team = side === TeamSide.HOME ? this.home : this.away;
    return Object.freeze(
      team.slots.map((athleteId, slot) => {
        const athlete = team.athletes[athleteId];
        const base = team.slotPos(slot);
        return Object.freeze({
          athleteId,
          slot,
          row: slot <= 2 ? ('back' as const) : ('front' as const),
          position: Object.freeze({ x: athlete.pos.x, z: athlete.pos.z }),
          velocity: Object.freeze({ x: athlete.velocity.x, z: athlete.velocity.z }),
          base: Object.freeze({ x: base.x, z: base.z }),
          airborne: athlete.isAirborne,
        });
      }),
    );
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
    this.coordinateTeamPlan(plan);
    this.hooks.camera.setMode('rally', { cut: true });
  }

  /** Cenário DEV determinístico de saque para E2E de tap/hold/cancelamento. */
  debugActionServeScenario(): void {
    if (!import.meta.env.DEV) return;
    this.servingTeam = TeamSide.HOME;
    this.beginServePrep();
  }

  /** Cenário DEV determinístico para validar autoridade humana e assistente no bloqueio duplo. */
  debugBlockTacticsScenario(): void {
    if (!import.meta.env.DEV) return;
    this.timeline.clearScheduled();
    this.state = 'rally';
    this.rally.reset();
    const attacker = this.away.frontRow()[1];
    const plan: TouchPlan = {
      planId: this.rally.allocatePlanId(),
      side: TeamSide.AWAY,
      athlete: attacker,
      contactIn: 0.6,
      point: new THREE.Vector3(0.9, CONTACT.spike, 0),
      kind: 'spike',
      isHuman: false,
      tacticalRevision: 0,
      done: false,
    };
    this.rally.plan = plan;
    this.human.assignBlock(this.home.nearestFrontRowTo(0), this.ctx);
    const primaryId = this.human.controlSnapshot().athleteId;
    this.coordinateBlockDefense(plan, TeamSide.HOME, 0, plan.contactIn, primaryId);
  }

  // ---------------------------------------------------------------- SAQUE
  private beginServePrep(): void {
    this.state = 'servePrep';
    this.stateTime = 0;
    this.timeline.clearScheduled();
    this.rally.reset();
    if (this.humanSide === null) this.human.release();
    else this.human.resetForServe(this.ctx);
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
    this.teamTactics.coordinate({
      team,
      phase: 'serve-formation',
      serverAthleteId: server.index,
      serverPoint: spot,
    });
    this.teamTactics.coordinate({
      team: this.teamOf(otherSide(this.servingTeam)),
      phase: 'recompose',
    });
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

    const contactH =
      nextKind === 'set' ? CONTACT.set : nextKind === 'spike' ? CONTACT.spike : CONTACT.pass;
    let cT = this.ball.timeToDescend(contactH);
    const cPoint = new THREE.Vector3();
    if (cT < 0.05 || cT > landing.time) {
      cT = Math.max(0.06, landing.time - 0.1); // bola rasteira: contato de emergência
    }
    this.ball.posAt(cT, cPoint);

    // O contato pertence ao lado em que a bola cruza a altura técnica. Usar a queda futura fazia
    // algumas levantadas escolherem uma atacante da equipe oposta antes de cruzar a rede.
    const landSide = contactSideAt(
      cPoint.x,
      this.ball.vel.x,
      this.rally.possessionTeam ?? this.servingTeam,
    );
    if (this.rally.possessionTeam === landSide && this.rally.possessionTouches >= 3) return;

    const team = this.teamOf(landSide);
    let athlete: Athlete;
    if (nextKind === 'set') {
      const sp = team.setterSpot();
      athlete =
        (this.rally.setterHold?.side === landSide ? this.rally.setterHold : null) ??
        team.nearestTo(sp.x, sp.z, this.rally.lastToucher ?? undefined);
    } else if (nextKind === 'spike') {
      athlete =
        (this.rally.plannedAttacker?.side === landSide ? this.rally.plannedAttacker : null) ??
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
      tacticalRevision: 0,
      done: false,
    };

    let humanReceptionAssigned = false;
    if (isHuman && isReceptionTouch(nextKind)) {
      this.human.onAssigned(this.ctx, this.rally.plan);
      humanReceptionAssigned = true;
    }
    this.coordinateTeamPlan(this.rally.plan);

    // Aproximação: a IA agenda o deslocamento e o pulo. No humano, ataque e levantamento mantêm
    // rotas táticas; recepção fica nas setas + assistência limitada do AutoSelector.
    if (isHuman) {
      if (nextKind === 'spike') {
        const backoff = sideSign(landSide) * 0.85;
        const ownedPlan = this.rally.plan;
        const ownedRevision = ownedPlan.tacticalRevision ?? 0;
        this.after(0, () => {
          if (
            this.rally.plan !== ownedPlan ||
            ownedPlan.athlete !== athlete ||
            (ownedPlan.tacticalRevision ?? 0) !== ownedRevision
          )
            return;
          athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z);
        });
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
    let humanBlockAssigned = false;
    if (nextKind === 'spike') {
      const defenseSide = otherSide(landSide);
      let humanPrimaryId: number | null = null;
      if (this.isHumanSide(defenseSide)) {
        const humanTeam = this.teamOf(defenseSide);
        this.human.assignBlock(humanTeam.nearestFrontRowTo(cPoint.z), this.ctx);
        humanPrimaryId = this.human.controlSnapshot().athleteId;
        humanBlockAssigned = true;
      }
      const defense = this.coordinateBlockDefense(
        this.rally.plan,
        defenseSide,
        cPoint.z,
        cT,
        humanPrimaryId,
      );
      prepareBlock(this.ctx, defenseSide, cPoint.z, cT, defense.block);
    }

    // controle: humano assume seu lado; contra a cortada da IA, pode bloquear
    if (isHuman) {
      if (!humanReceptionAssigned) this.human.onAssigned(this.ctx, this.rally.plan);
    } else if (nextKind === 'spike' && this.isHumanSide(otherSide(landSide))) {
      if (!humanBlockAssigned) throw new Error('Bloqueio humano sem autoridade definida');
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
    this.simulationTick = frame.simulationTick;
    this.ball.beginFixedStep();
    this.home.beginFixedStep();
    this.away.beginFixedStep();
    this.human.update(dt, frame, this.ctx);
    this.syncHumanSelectionTactics();
    this.applyHumanBlockCommit();
    this.timeline.step(dt);
    this.ball.endFixedStep();
    this.flushTelemetry();
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

  private speedFor(athlete: Athlete, controlledAthleteId: number | null): number {
    return this.isHumanSide(athlete.side) && controlledAthleteId === athlete.index
      ? PLAYER.speed
      : PLAYER.aiSpeed;
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
      this.emitTelemetry({
        type: 'contact',
        side: plan.side,
        kind: 'freeball',
        athlete: a.index,
        possessionTouch: this.rally.possessionTouches,
        rallyTouch: this.rally.rallyTouches,
        quality: 0,
        point: { x: plan.point.x, y: plan.point.y, z: plan.point.z },
        target: { x: target.x, y: target.y, z: target.z },
      });
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
          awardPoint(this.scoringCtx, otherSide(this.servingTeam), 'Saque na rede', 'serve-net');
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
    awardPoint(this.scoringCtx, winner, 'Fora da antena', 'antenna');
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
      emitTelemetry: (event) => this.emitTelemetry(event),
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
        this.emitTelemetry({ type: 'rally-start', serving: this.servingTeam });
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
      emitTelemetry: (event) => this.emitTelemetry(event),
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
        this.teamTactics.hold(this.home);
        this.teamTactics.hold(this.away);
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

  private coordinateTeamPlan(plan: TouchPlan): void {
    let phase: TeamTacticsPhase;
    let setterAthleteId: number | null;
    if (isReceptionTouch(plan.kind)) {
      phase = 'reception';
      setterAthleteId =
        this.rally.setterHold?.side === plan.side ? this.rally.setterHold.index : null;
    } else if (plan.kind === 'set') {
      phase = 'offense-transition';
      setterAthleteId = plan.athlete.index;
    } else if (plan.kind === 'spike') {
      phase = 'attack-coverage';
      const lastSetter =
        this.rally.lastKind === 'set' && this.rally.lastToucher?.side === plan.side
          ? this.rally.lastToucher
          : null;
      if (lastSetter && lastSetter !== plan.athlete) {
        setterAthleteId = lastSetter.index;
      } else {
        const team = this.teamOf(plan.side);
        const spot = team.setterSpot();
        setterAthleteId = team.nearestTo(spot.x, spot.z, plan.athlete).index;
      }
    } else {
      return;
    }
    const tactical = this.teamTactics.coordinate({
      team: this.teamOf(plan.side),
      phase,
      planId: plan.planId,
      activeAthleteId: plan.athlete.index,
      contactPoint: { x: plan.point.x, z: plan.point.z },
      setterAthleteId,
    });
    plan.tacticalRevision = tactical.revision;
    if (plan.isHuman) {
      this.lastHumanSelectionRevision = this.human.controlSnapshot().selectionRevision;
    }
  }

  private syncHumanSelectionTactics(): void {
    const control = this.human.controlSnapshot();
    if (control.selectionRevision === this.lastHumanSelectionRevision) return;
    this.lastHumanSelectionRevision = control.selectionRevision;
    const plan = this.rally.plan;
    if (plan?.isHuman && isReceptionTouch(plan.kind)) {
      this.coordinateTeamPlan(plan);
    } else if (
      plan?.kind === 'spike' &&
      control.mode === 'block' &&
      control.athleteId !== null &&
      this.isHumanSide(otherSide(plan.side))
    ) {
      this.coordinateBlockDefense(
        plan,
        otherSide(plan.side),
        plan.point.z,
        plan.contactIn,
        control.athleteId,
      );
    }
  }

  private coordinateBlockDefense(
    attackPlan: TouchPlan,
    defenseSide: TeamSide,
    crossZ: number,
    contactIn: number,
    humanPrimaryId: number | null,
  ): TeamPlan {
    const tactical = this.teamTactics.coordinate({
      team: this.teamOf(defenseSide),
      phase: 'block-defense',
      planId: attackPlan.planId,
      activeAthleteId: humanPrimaryId,
      contactPoint: { x: sideSign(defenseSide) * BLOCK.netX, z: crossZ },
      contactIn,
    });
    if (tactical.block) {
      this.rally.blockPlan = Object.freeze({
        planId: attackPlan.planId,
        tacticalRevision: tactical.revision,
        side: defenseSide,
        primaryAthleteId: tactical.block.primaryAthleteId,
        assistAthleteId: tactical.block.assistAthleteId,
      });
    }
    return tactical;
  }

  private applyHumanBlockCommit(): void {
    const commit = this.human.takeBlockCommit();
    if (!commit) return;
    const plan = this.rally.plan;
    if (!plan || plan.kind !== 'spike' || plan.planId !== commit.planId) return;
    const defenseSide = otherSide(plan.side);
    if (!this.isHumanSide(defenseSide)) return;
    const block = this.teamTactics.snapshot(defenseSide)?.block;
    if (!block || block.primaryAthleteId !== commit.athleteId || block.assistAthleteId === null) {
      return;
    }
    const assist = this.teamOf(defenseSide).athletes.find(
      (athlete) => athlete.index === block.assistAthleteId,
    );
    if (!assist || assist.isAirborne) return;
    assist.act('block', 0.8);
    assist.jump(PLAYER.blockJumpVel);
  }

  private emitTelemetry(event: Readonly<SimulationEventDraft>): void {
    if (!this.telemetry || !this.telemetryEnabled) return;
    const draws = Object.freeze({
      rules: this.random.rules.draws,
      ai: this.random.ai.draws,
      contact: this.random.contact.draws,
      control: this.random.control.draws,
    });
    this.telemetryOutbox.push(Object.freeze({ ...event, tick: this.simulationTick, draws }));
  }

  private flushTelemetry(): void {
    if (!this.telemetry || !this.telemetryEnabled || this.telemetryOutbox.length === 0) return;
    const pending = this.telemetryOutbox.splice(0);
    try {
      for (const event of pending) this.telemetry.emit(event);
    } catch {
      this.telemetryEnabled = false;
      this.telemetryOutbox.length = 0;
    }
  }

  private after(t: number, fn: () => void): void {
    this.timeline.after(t, fn);
  }
}

function isReceptionTouch(kind: TouchKind): boolean {
  return kind === 'pass' || kind === 'dig' || kind === 'freeball';
}
