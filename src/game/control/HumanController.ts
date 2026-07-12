// Controle humano: adapta a gramática única do botão aos contextos da partida e preserva
// AutoSelector, mira e movimento sem conhecer DOM, teclado concreto ou câmera.
import * as THREE from 'three';
import { ACTION_WINDOWS, CONTACT, PLAYER, SERVE_TUNING, TeamSide } from '../../core/constants';
import type { InputCancelReason } from '../../core/input/InputFrame';
import { chance, clamp, lerp, rand, randPick } from '../../core/math3d';
import type { TouchPlan } from '../RallyState';
import type { Athlete } from '../Team';
import type { MechanicsCtx } from '../mechanics/context';
import { performServe } from '../mechanics/serve';
import {
  ActionControl,
  type ActionControlRequest,
  type ActionControlSnapshot,
} from './ActionControl';
import type { ActionContext, ActionIntent } from './ActionIntent';
import type { ControlFrame } from './ControlFrame';
import { HumanAutoControl } from './HumanAutoControl';
import { humanContactQuality } from './timing';

export type CtlMode = 'none' | 'serve' | 'receive' | 'set' | 'attack' | 'block' | 'freeball';

const FIXED_HZ = 60;
const CONTACT_CONTEXTS = new Set<ActionContext>(['receive', 'set', 'attack', 'freeball']);

export class HumanController {
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private readonly actionControl = new ActionControl();
  private readonly autoControl = new HumanAutoControl();
  private activeToken: number | null = null;
  private activeContext: ActionContext | null = null;
  private nextServeToken = -1;
  private lastFrame: ControlFrame | null = null;
  private lastRequest: ActionControlRequest | null = null;
  private consumedContactIntent: ActionIntent | null = null;
  private resolvedTimingQuality = 0;
  private jumpedToken: number | null = null;

  readonly aim = new THREE.Vector3(5.5, 0, 0);
  chosenZone = 0;
  readonly marker: THREE.Mesh;

  constructor() {
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
  }

  get mode(): CtlMode {
    return this.ctl;
  }

  get isControlling(): boolean {
    return this.controlled !== null && this.ctl !== 'none';
  }

  /** Libera o controle e revoga qualquer gesto do ponto encerrado. */
  release(): void {
    this.ctl = 'none';
    this.controlled = null;
    this.autoControl.release();
    this.actionControl.cancel('point-end');
    this.clearResolvedIntent();
    this.activeToken = null;
    this.activeContext = null;
    this.lastFrame = null;
    this.lastRequest = null;
  }

  resetForServe(): void {
    this.clearResolvedIntent();
    this.chosenZone = randPick([0, 1, 2]);
  }

  /** Cada saque recebe identidade negativa monotônica, separada dos planIds do rally. */
  beginServe(server: Athlete, ctx: MechanicsCtx): void {
    this.bindAction(this.nextServeToken--, 'serve');
    this.ctl = 'serve';
    this.controlled = server;
    this.aim.set(rand(4, 6.5), 0, rand(-2, 2));
    ctx.hooks.hint('Toque para saque flutuante · segure para saque potente · setas miram');
    ctx.hooks.serveMeter(true, 0);
  }

  awaitOpponentServe(): void {
    this.release();
  }

  onAssigned(ctx: MechanicsCtx, plan: TouchPlan): void {
    this.autoControl.release();
    const context = contextForPlan(plan);
    this.bindAction(plan.planId, context);

    if (context === 'attack') {
      this.ctl = 'attack';
      this.controlled = plan.athlete;
      this.aim.set(rand(4.5, 6.5), 0, rand(-2.5, 2.5));
      ctx.hooks.hint('Toque para largada · segure para cortada potente · setas miram');
      return;
    }

    if (context === 'set') {
      this.ctl = 'set';
      this.controlled = plan.athlete;
      ctx.hooks.hint('Toque para bola alta · segure para tempo rápido · setas escolhem');
      ctx.hooks.zoneHint(this.chosenZone);
      return;
    }

    this.ctl = context;
    this.controlled = this.autoControl.beginReceive(ctx, plan);
    ctx.hooks.hint(
      context === 'freeball'
        ? 'Toque para salvar · segure para alcançar mais longe'
        : 'Toque para manchete · segure para mergulho de emergência',
    );
    ctx.hooks.effects.showLanding(plan.point);
  }

  /** O token do bloqueio é sempre o planId da cortada rival. */
  assignBlock(blocker: Athlete, ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (plan) this.bindAction(plan.planId, 'block');
    this.ctl = 'block';
    this.controlled = this.autoControl.beginBlock(ctx, blocker);
    ctx.hooks.hint('Toque para bloqueio rápido · segure para penetrar');
  }

  idle(ctx: MechanicsCtx): void {
    if (this.ctl !== 'block') {
      this.ctl = 'none';
      this.controlled = null;
      this.autoControl.release();
      this.actionControl.cancel('plan-changed');
      this.activeToken = null;
      this.activeContext = null;
    }
    ctx.hooks.effects.showLanding(null);
  }

  /** Compatibilidade: qualidade não consome; Match pode chamar takeContactIntent depois. */
  reachQuality(hard: boolean, medium: boolean, ctx: MechanicsCtx): number {
    const intent = this.contactQualityIntent();
    if (intent && intent.context !== 'attack') {
      const semanticQuality =
        this.resolvedTimingQuality * intent.precision * (0.85 + intent.power * 0.15);
      const quality = humanContactQuality(semanticQuality, hard);
      if (semanticQuality > 0.8 && !hard) ctx.hooks.banner('PERFEITO!', '');
      if (semanticQuality > 0.7 && hard) ctx.hooks.banner('DEFESAÇA!', '');
      return quality;
    }

    const missProbability = hard ? 0.6 : medium ? 0.28 : 0;
    if (chance(missProbability)) return chance(0.5) ? rand(0.02, 0.12) : -1;
    return hard ? 0.3 : 0.45;
  }

  /** Potência e precisão semânticas substituem o antigo jumpQ paralelo. */
  spikeQuality(): number {
    const intent = this.contactQualityIntent();
    if (!intent || intent.context !== 'attack') return 0.4;
    return clamp(
      0.2 + intent.power * 0.6 + intent.precision * this.resolvedTimingQuality * 0.2,
      0,
      1,
    );
  }

  clearTiming(): void {
    this.consumeCurrentContactIntent();
    this.clearResolvedIntent();
  }

  clearJump(): void {
    this.consumeCurrentContactIntent();
    this.clearResolvedIntent();
  }

  /** API legada delegada para a maquina unica. */
  cancelServeCharge(ctx: MechanicsCtx): void {
    if (this.ctl === 'serve' && this.actionControl.snapshot().status !== 'idle') {
      this.cancelPendingAction('pause', ctx);
    }
  }

  cancelPendingAction(reason: InputCancelReason, ctx: MechanicsCtx): void {
    this.actionControl.cancel(reason);
    this.clearResolvedIntent();
    this.lastFrame = null;
    this.lastRequest = null;
    if (this.ctl === 'serve') ctx.hooks.serveMeter(true, 0);
  }

  update(dt: number, frame: ControlFrame, ctx: MechanicsCtx): void {
    const latestCancellation = frame.cancellations
      .slice()
      .sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence)
      .at(-1);
    if (latestCancellation) this.cancelPendingAction(latestCancellation.reason, ctx);

    const axis = frame.courtAxis;
    this.refreshAutoSelection(ctx);
    this.updateMovementAndAim(dt, axis, ctx);

    const request = this.currentRequest(ctx);
    if (!request) return;

    const before = this.actionControl.snapshot();
    const intent = this.actionControl.step(frame, request);
    this.lastFrame = frame;
    this.lastRequest = request;
    if (intent) this.registerResolvedIntent(intent, request.contactInTicks);

    const after = this.actionControl.snapshot();
    if (request.context === 'attack' || request.context === 'block') {
      const actionStarted =
        intent !== null ||
        ((after.status === 'pressed' || after.status === 'charging') &&
          before.status !== 'pressed' &&
          before.status !== 'charging');
      if (actionStarted) this.startJump(request.token, request.context);
    }

    if (request.context === 'serve') {
      if (intent) this.finishServe(intent, ctx);
      else if (after.status !== 'idle' && after.status !== 'blocked') {
        ctx.hooks.serveMeter(true, after.charge);
      }
    }
  }

  selectionSnapshot() {
    return this.autoControl.snapshot();
  }

  actionSnapshot(): Readonly<ActionControlSnapshot> {
    return this.actionControl.snapshot();
  }

  peekActionIntent(): ActionIntent | null {
    return this.actionControl.peek();
  }

  /** Recebe intenção de toque, nunca saque/bloqueio, e resolve hold no contato analítico. */
  takeContactIntent(planId: number): ActionIntent | null {
    if (!this.activeContext || !CONTACT_CONTEXTS.has(this.activeContext)) return null;
    this.resolveAtAnalyticalContact(planId, this.activeContext);
    const intent = this.actionControl.take(planId, this.activeContext);
    if (intent) this.consumedContactIntent = intent;
    return intent;
  }

  takeBlockIntent(planId: number): ActionIntent | null {
    if (this.activeContext !== 'block') return null;
    this.resolveAtAnalyticalContact(planId, 'block');
    return this.actionControl.take(planId, 'block');
  }

  /** Alcance contínuo disponível antes ou logo depois do consumo mecânico. */
  contactReach(): number {
    const intent = this.contactQualityIntent();
    if (!intent || !CONTACT_CONTEXTS.has(intent.context)) return CONTACT.reach;
    return lerp(CONTACT.reach, CONTACT.lungeReach, intent.reach);
  }

  updateMarker(): void {
    if (this.isControlling && this.controlled) {
      this.marker.visible = true;
      this.marker.position.set(this.controlled.pos.x, 0.02, this.controlled.pos.z);
      this.presentActionMarkerState();
    } else {
      this.marker.visible = false;
    }
  }

  presentMarker(): void {
    if (this.isControlling && this.controlled) {
      this.marker.visible = true;
      this.marker.position.set(
        this.controlled.char.root.position.x,
        0.02,
        this.controlled.char.root.position.z,
      );
      this.presentActionMarkerState();
    } else {
      this.marker.visible = false;
    }
  }

  private bindAction(token: number, context: ActionContext): void {
    if (token === this.activeToken && context === this.activeContext) return;
    this.actionControl.cancel('plan-changed');
    this.clearResolvedIntent();
    this.activeToken = token;
    this.activeContext = context;
    this.lastFrame = null;
    this.lastRequest = null;
    this.jumpedToken = null;
  }

  private currentRequest(ctx: MechanicsCtx): ActionControlRequest | null {
    if (this.activeToken === null || this.activeContext === null) return null;
    if (this.activeContext === 'serve') {
      return {
        token: this.activeToken,
        context: 'serve',
        contactInTicks: Number.POSITIVE_INFINITY,
        compatibleContact: false,
        lockedIllegal: false,
      };
    }

    const plan = ctx.rally.plan;
    const samePlan = plan?.planId === this.activeToken && !plan.done;
    const lockedIllegal =
      !samePlan ||
      ((this.activeContext === 'receive' ||
        this.activeContext === 'freeball' ||
        this.activeContext === 'block') &&
        this.autoControl.snapshot().status === 'locked-illegal');
    return {
      token: this.activeToken,
      context: this.activeContext,
      contactInTicks: samePlan ? secondsToTicks(plan.contactIn) : Number.POSITIVE_INFINITY,
      compatibleContact: false,
      lockedIllegal,
    };
  }

  private resolveAtAnalyticalContact(token: number, context: ActionContext): void {
    if (
      this.actionControl.peek() ||
      token !== this.activeToken ||
      context !== this.activeContext ||
      !this.lastFrame ||
      !this.lastRequest
    ) {
      return;
    }

    const intent = this.actionControl.step(
      {
        ...this.lastFrame,
        actionEdges: [],
        cancellations: [],
      },
      {
        ...this.lastRequest,
        contactInTicks: 0,
        compatibleContact: true,
      },
    );
    if (intent) this.registerResolvedIntent(intent, 0);
  }

  private registerResolvedIntent(intent: ActionIntent, contactInTicks: number): void {
    const ideal = idealLeadTicks(intent.context);
    const pressLead = contactInTicks + (intent.resolvedTick - intent.pressedTick);
    const measuredLead =
      intent.context === 'attack' || intent.context === 'block' ? pressLead : contactInTicks;
    this.resolvedTimingQuality = clamp(
      1 - Math.abs(measuredLead - ideal) / Math.max(12, ideal),
      0,
      1,
    );
  }

  private contactQualityIntent(): ActionIntent | null {
    return this.consumedContactIntent ?? this.actionControl.peek();
  }

  private consumeCurrentContactIntent(): void {
    if (
      this.activeToken !== null &&
      this.activeContext !== null &&
      CONTACT_CONTEXTS.has(this.activeContext)
    ) {
      this.actionControl.take(this.activeToken, this.activeContext);
    }
  }

  private clearResolvedIntent(): void {
    this.consumedContactIntent = null;
    this.resolvedTimingQuality = 0;
  }

  private startJump(token: number, context: 'attack' | 'block'): void {
    if (!this.controlled || this.controlled.isAirborne || this.jumpedToken === token) return;
    this.jumpedToken = token;
    if (context === 'attack') {
      this.controlled.act('spikeWindup', 0.4);
      this.controlled.jump(PLAYER.jumpVel);
    } else {
      this.controlled.act('block', 0.8);
      this.controlled.jump(PLAYER.blockJumpVel);
    }
  }

  private updateMovementAndAim(
    dt: number,
    axis: ControlFrame['courtAxis'],
    ctx: MechanicsCtx,
  ): void {
    const plan = ctx.rally.plan;
    if (
      (this.ctl === 'receive' || this.ctl === 'freeball') &&
      this.controlled &&
      plan &&
      !plan.done
    ) {
      const route = this.autoControl.receiveRoute(axis, plan, this.controlled);
      this.controlled.moveTo(route.x, route.z);
    }

    if (
      (this.ctl === 'set' || this.ctl === 'none') &&
      plan?.kind === 'set' &&
      plan.side === TeamSide.HOME &&
      !plan.done
    ) {
      const selectedZone = axis.z < -0.35 ? 0 : axis.z > 0.35 ? 2 : this.chosenZone;
      if (selectedZone !== this.chosenZone) {
        this.chosenZone = selectedZone;
        ctx.hooks.zoneHint(selectedZone);
      }
    }

    if (this.ctl === 'serve' && this.controlled) {
      this.aim.x = clamp(this.aim.x + axis.x * dt * 5, 1.2, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 5, -4.2, 4.2);
      ctx.hooks.effects.showAim(this.aim);
    } else if (this.ctl === 'attack' && this.controlled && plan && !plan.done) {
      this.aim.x = clamp(this.aim.x + axis.x * dt * 6, 1, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 6, -4.2, 4.2);
      ctx.hooks.effects.showAim(this.aim);
    } else if (this.ctl === 'block' && this.controlled && plan) {
      const route = this.autoControl.blockRoute(axis, plan, this.controlled);
      this.controlled.moveTo(route.x, route.z);
    }
  }

  private refreshAutoSelection(ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (!plan || plan.done) return;
    if ((this.ctl === 'receive' || this.ctl === 'freeball') && this.controlled) {
      this.controlled = this.autoControl.refreshReceive(ctx, plan, this.controlled);
    } else if (this.ctl === 'block' && this.controlled && !this.controlled.isAirborne) {
      this.controlled = this.autoControl.refreshBlock(ctx, plan, this.controlled);
    }
  }

  private finishServe(intent: ActionIntent, ctx: MechanicsCtx): void {
    if (!this.controlled || intent.context !== 'serve') return;

    const target = this.aim.clone();
    target.x = clamp(target.x + intent.direction.x * 1.2, 1.2, 10.8);
    target.z = clamp(target.z + intent.direction.z * 1.4, -4.8, 4.8);
    let clearance =
      lerp(SERVE_TUNING.clearanceHi, SERVE_TUNING.clearanceLo, intent.power) *
      rand(SERVE_TUNING.clearanceJitter[0], SERVE_TUNING.clearanceJitter[1]);
    if (intent.technique === 'power-serve' && chance((1 - intent.precision) * 0.65)) {
      target.x = rand(9.6, 11.5);
      clearance = rand(0.18, 0.5);
    }

    const server = this.controlled;
    this.ctl = 'none';
    this.controlled = null;
    ctx.hooks.serveMeter(false);
    performServe(ctx, server, Math.max(0.3, intent.power), target, clearance);
  }

  /** Feedback compacto por forma/cor; não adiciona instrução textual ao gameplay. */
  private presentActionMarkerState(): void {
    const snapshot = this.actionControl.snapshot();
    const material = this.marker.material as THREE.MeshBasicMaterial;
    let color = 0x40ff9f;
    let scale = 1;
    let opacity = 0.9;

    switch (snapshot.status) {
      case 'buffered':
        color = 0xffc857;
        scale = 1.12;
        opacity = 0.78;
        break;
      case 'pressed':
        color = 0x56d8ff;
        scale = 1.08;
        break;
      case 'charging':
        color = 0xff7a45;
        scale = 1.1 + snapshot.charge * 0.18;
        break;
      case 'committed':
        color = 0xffffff;
        scale = 1.16;
        break;
      case 'blocked':
        color = 0xff4d67;
        opacity = 0.72;
        break;
      case 'idle':
        break;
    }

    material.color.setHex(color);
    material.opacity = opacity;
    this.marker.scale.setScalar(scale);
  }
}

function contextForPlan(plan: TouchPlan): ActionContext {
  switch (plan.kind) {
    case 'pass':
    case 'dig':
      return 'receive';
    case 'set':
      return 'set';
    case 'spike':
      return 'attack';
    case 'freeball':
      return 'freeball';
    case 'block':
      return 'block';
    case 'serve':
      return 'serve';
  }
}

function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.ceil(seconds * FIXED_HZ - 1e-9));
}

function idealLeadTicks(context: ActionContext): number {
  switch (context) {
    case 'receive':
      return ACTION_WINDOWS.receiveIdealTicks;
    case 'set':
      return ACTION_WINDOWS.setIdealTicks;
    case 'attack':
      return ACTION_WINDOWS.attackIdealTicks;
    case 'block':
      return ACTION_WINDOWS.blockIdealTicks;
    case 'freeball':
      return ACTION_WINDOWS.freeballIdealTicks;
    case 'serve':
      return 0;
  }
}
