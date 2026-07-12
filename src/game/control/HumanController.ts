// Controle humano: estado de interação (modo, atleta controlado, mira, timing, zona, saque) e
// o processamento de Input por frame. Reage ao teclado; escreve intenções que as mecânicas leem
// via ctx (aim/chosenZone). Extraído do Match (1.5b).
import * as THREE from 'three';
import { BLOCK, PLAYER, SERVE_TUNING, TeamSide } from '../../core/constants';
import { clamp, lerp, rand, chance, randPick } from '../../core/math3d';
import { Athlete } from '../Team';
import { TouchPlan } from '../RallyState';
import { performServe } from '../mechanics/serve';
import type { MechanicsCtx } from '../mechanics/context';
import { receiveTimingQuality, jumpTimingQuality, humanContactQuality } from './timing';
import type { ControlFrame } from './ControlFrame';

export type CtlMode = 'none' | 'serve' | 'receive' | 'attack' | 'block';

interface TimedInputEvent {
  readonly atMs: number;
  readonly sequence: number;
}

function compareInputEvents(left: TimedInputEvent, right: TimedInputEvent): number {
  return left.atMs - right.atMs || left.sequence - right.sequence;
}

export class HumanController {
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private serveCharging = false;
  private servePower = 0;
  private serveDir = 1;
  readonly aim = new THREE.Vector3(5.5, 0, 0);
  private timingQ = -1; // qualidade do aperto de ESPAÇO na recepção
  private jumpQ = -1; // qualidade do timing do pulo no ataque
  chosenZone = 0; // 0 esq, 1 centro, 2 dir
  readonly marker: THREE.Mesh; // anel sob o jogador controlado

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
    return (
      this.controlled !== null &&
      (this.ctl === 'receive' ||
        this.ctl === 'attack' ||
        this.ctl === 'block' ||
        this.ctl === 'serve')
    );
  }

  /** Libera o controle (fim de ponto). */
  release(): void {
    this.ctl = 'none';
    this.controlled = null;
  }

  /** Reset por saque: zera timing e sorteia a zona de ataque inicial. */
  resetForServe(): void {
    this.timingQ = -1;
    this.jumpQ = -1;
    this.chosenZone = randPick([0, 1, 2]);
  }

  /** Humano vai sacar: assume o sacador e liga o medidor. */
  beginServe(server: Athlete, ctx: MechanicsCtx): void {
    this.ctl = 'serve';
    this.controlled = server;
    this.servePower = 0;
    this.serveCharging = false;
    this.aim.set(rand(4, 6.5), 0, rand(-2, 2));
    ctx.hooks.hint(
      'SEGURE ESPAÇO para carregar o saque — solte na zona verde · setas ajustam a mira',
    );
    ctx.hooks.serveMeter(true, 0);
  }

  /** IA saca: humano só espera para receber. */
  awaitOpponentServe(): void {
    this.release();
  }

  /** Setup de controle do lado humano após o planejamento do próximo contato. */
  onAssigned(ctx: MechanicsCtx, plan: TouchPlan): void {
    if (plan.kind === 'spike') {
      this.ctl = 'attack';
      this.controlled = plan.athlete;
      this.jumpQ = -1;
      this.aim.set(rand(4.5, 6.5), 0, rand(-2.5, 2.5));
      ctx.hooks.hint('ESPAÇO pula (timing = força) · setas miram a cortada');
    } else if (plan.kind === 'set') {
      this.ctl = 'none';
      this.controlled = null;
      ctx.hooks.hint('Escolha o ataque: setas escolhem o ataque');
      ctx.hooks.zoneHint(this.chosenZone);
    } else {
      this.ctl = 'receive';
      this.controlled = plan.athlete;
      this.timingQ = -1;
      ctx.hooks.hint('SETAS movem · ESPAÇO no momento do toque = passe perfeito');
      ctx.hooks.effects.showLanding(plan.point);
    }
  }

  /** Humano pode bloquear a cortada da IA. */
  assignBlock(blocker: Athlete, ctx: MechanicsCtx): void {
    this.ctl = 'block';
    this.controlled = blocker;
    ctx.hooks.hint('BLOQUEIO: setas deslizam na rede · ESPAÇO pula!');
  }

  /** IA com a bola num contato não-bloqueável: humano fica ocioso. */
  idle(ctx: MechanicsCtx): void {
    if (this.ctl !== 'block') {
      this.ctl = 'none';
      this.controlled = null;
    }
    ctx.hooks.effects.showLanding(null);
  }

  /** Qualidade do toque humano no alcance (não reseta timingQ — ver clearTiming). -1 = não defende. */
  reachQuality(hard: boolean, medium: boolean, ctx: MechanicsCtx): number {
    if (this.timingQ >= 0) {
      // apertou no tempo: defende, qualidade cai um pouco contra bola forte
      const q = humanContactQuality(this.timingQ, hard);
      if (this.timingQ > 0.8 && !hard) ctx.hooks.banner('PERFEITO!', '');
      if (this.timingQ > 0.7 && hard) ctx.hooks.banner('DEFESAÇA!', '');
      return q;
    }
    // sem apertar: o toque automático falha contra bolas rápidas
    const missP = hard ? 0.6 : medium ? 0.28 : 0;
    if (chance(missP)) return chance(0.5) ? rand(0.02, 0.12) : -1; // escorrega ou perde limpo
    return hard ? 0.3 : 0.45;
  }

  /** Qualidade da cortada humana (não reseta jumpQ — ver clearJump). */
  spikeQuality(): number {
    return this.jumpQ >= 0 ? this.jumpQ : 0.4;
  }

  /** Reset do timing de recepção após uma tentativa de contato (defendida ou não). */
  clearTiming(): void {
    this.timingQ = -1;
  }

  /** Reset do timing de pulo após uma tentativa de cortada. */
  clearJump(): void {
    this.jumpQ = -1;
  }

  /**
   * Cancela o carregamento do saque ao pausar: zera o medidor (mantém-o visível em 0) e o
   * jogador recarrega ao retomar. Necessário porque durante a pausa o Match não processa
   * input, então o edge de soltar ESPAÇO seria engolido e o saque ficaria travado carregando.
   * Só age se o humano está sacando e carregando; caso contrário é no-op.
   */
  cancelServeCharge(ctx: MechanicsCtx): void {
    if (this.ctl === 'serve' && this.serveCharging) {
      this.serveCharging = false;
      this.servePower = 0;
      this.serveDir = 1;
      ctx.hooks.serveMeter(true, 0);
    }
  }

  /** Processa o frame semântico; DOM, teclas concretas e câmera ficam fora do gameplay. */
  update(dt: number, frame: ControlFrame, ctx: MechanicsCtx): void {
    if (frame.cancellations.length > 0) {
      this.cancelServeCharge(ctx);
    }

    const axis = frame.courtAxis;
    const lastCancellation = frame.cancellations.reduce<
      (typeof frame.cancellations)[number] | null
    >(
      (latest, cancellation) =>
        !latest || compareInputEvents(cancellation, latest) > 0 ? cancellation : latest,
      null,
    );
    const actionEdges = frame.actionEdges
      .filter((edge) => !lastCancellation || compareInputEvents(edge, lastCancellation) > 0)
      .slice()
      .sort(compareInputEvents);
    const actionPressed = actionEdges.some((edge) => edge.kind === 'press');

    if (this.ctl === 'serve' && this.controlled) {
      // mira
      this.aim.x = clamp(this.aim.x + axis.x * dt * 5, 1.2, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 5, -4.2, 4.2);
      ctx.hooks.effects.showAim(this.aim);

      for (const edge of actionEdges) {
        if (this.ctl !== 'serve' || !this.controlled) break;
        if (edge.kind === 'press') {
          this.serveCharging = true;
          this.servePower = 0;
          this.serveDir = 1;
        } else if (this.serveCharging) {
          this.finishServe(ctx);
        }
      }

      if (this.ctl === 'serve' && this.serveCharging) {
        this.servePower += this.serveDir * dt * SERVE_TUNING.chargeRate;
        if (this.servePower >= 1) {
          this.servePower = 1;
          this.serveDir = -1;
        }
        if (this.servePower <= 0) {
          this.servePower = 0;
          this.serveDir = 1;
        }
        ctx.hooks.serveMeter(true, this.servePower);
      }
    }

    if (this.ctl === 'receive' && this.controlled && ctx.rally.plan && !ctx.rally.plan.done) {
      // movimento direto
      if (axis.x !== 0 || axis.z !== 0) {
        this.controlled.moveTo(
          this.controlled.pos.x + axis.x * 1.2,
          this.controlled.pos.z + axis.z * 1.2,
        );
      }
      // timing do passe
      if (actionPressed && ctx.rally.plan.contactIn < 0.5) {
        this.timingQ = receiveTimingQuality(ctx.rally.plan.contactIn);
      }
      // A escolha de zona NÃO acontece aqui: a direção só move a atleta na recepção. A troca de
      // zona tem janela dedicada no levantamento para não mudar o ataque sem querer.
    }

    if (
      this.ctl === 'none' &&
      ctx.rally.plan &&
      ctx.rally.plan.kind === 'set' &&
      ctx.rally.plan.side === TeamSide.HOME
    ) {
      // A direção transversal da quadra seleciona uma ponta; neutro preserva a recomendação atual.
      const selectedZone = axis.z < -0.35 ? 0 : axis.z > 0.35 ? 2 : this.chosenZone;
      if (selectedZone !== this.chosenZone) {
        this.chosenZone = selectedZone;
        ctx.hooks.zoneHint(selectedZone);
      }
    }

    if (this.ctl === 'attack' && this.controlled && ctx.rally.plan && !ctx.rally.plan.done) {
      // mira aérea
      this.aim.x = clamp(this.aim.x + axis.x * dt * 6, 1.0, 8.6);
      this.aim.z = clamp(this.aim.z + axis.z * dt * 6, -4.2, 4.2);
      ctx.hooks.effects.showAim(this.aim);

      if (actionPressed && !this.controlled.isAirborne) {
        // qualidade = quão perto do instante ideal (0.26s antes do contato)
        this.jumpQ = jumpTimingQuality(ctx.rally.plan.contactIn);
        this.controlled.act('spikeWindup', 0.4);
        this.controlled.jump(PLAYER.jumpVel);
      }
    }

    if (this.ctl === 'block' && this.controlled) {
      // desliza na rede
      if (axis.z !== 0) {
        this.controlled.moveTo(-BLOCK.netX, clamp(this.controlled.pos.z + axis.z * 1.2, -4.2, 4.2));
      }
      if (actionPressed && !this.controlled.isAirborne) {
        this.controlled.act('block', 0.8);
        this.controlled.jump(PLAYER.blockJumpVel);
      }
    }
  }

  private finishServe(ctx: MechanicsCtx): void {
    if (!this.controlled) return;

    this.serveCharging = false;
    this.ctl = 'none';
    const p = this.servePower;
    const target = this.aim.clone();
    let power = p;
    // folga sobre a rede: força alta = raspando na fita, baixa = flutuante
    let clearance =
      lerp(SERVE_TUNING.clearanceHi, SERVE_TUNING.clearanceLo, p) *
      rand(SERVE_TUNING.clearanceJitter[0], SERVE_TUNING.clearanceJitter[1]);
    if (p > SERVE_TUNING.perfectHi) {
      // arriscou demais: pode sair longa
      if (chance((p - SERVE_TUNING.perfectHi) * 4)) {
        target.x = rand(9.6, 11.5);
        clearance = rand(0.25, 0.6);
      }
    } else if (p >= SERVE_TUNING.perfectLo) {
      ctx.hooks.banner('SAQUE PERFEITO!', '');
      power = SERVE_TUNING.perfectPower;
      clearance = rand(0.16, 0.28);
    }
    // pouca força morre na rede às vezes
    if (p < 0.25 && chance(0.7)) clearance = -rand(0.2, 0.5);
    performServe(ctx, this.controlled, Math.max(0.3, power), target, clearance);
  }

  /** Atualiza o anel sob o jogador controlado. Chamar após o movimento dos times integrar. */
  updateMarker(): void {
    if (this.isControlling && this.controlled) {
      this.marker.visible = true;
      this.marker.position.set(this.controlled.pos.x, 0.02, this.controlled.pos.z);
    } else {
      this.marker.visible = false;
    }
  }

  /** Faz o marker acompanhar a transform visual interpolada da atleta controlada. */
  presentMarker(): void {
    if (this.isControlling && this.controlled) {
      this.marker.visible = true;
      this.marker.position.set(
        this.controlled.char.root.position.x,
        0.02,
        this.controlled.char.root.position.z,
      );
    } else {
      this.marker.visible = false;
    }
  }
}
