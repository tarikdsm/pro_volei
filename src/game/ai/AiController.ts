// Decisões da IA: agendamento de aproximação/pulo e rolagens de qualidade, parametrizadas por
// ctx.diff. Sem estado próprio. A seleção de alvo da IA fica em mechanics/ (touch/serve).
import { PLAYER, sideSign } from '../../core/constants';
import { rand, chance } from '../../core/math3d';
import { TouchPlan } from '../RallyState';
import { aiServe } from '../mechanics/serve';
import type { MechanicsCtx } from '../mechanics/context';

export class AiController {
  /** Saque da IA (física + escolha de alvo/erro ficam em mechanics/serve). */
  serve(ctx: MechanicsCtx): void {
    aiServe(ctx);
  }

  /** Manda o atleta da IA ao ponto de contato (com reactionDelay) e agenda o pulo no ataque. */
  scheduleApproach(ctx: MechanicsCtx, plan: TouchPlan): void {
    const { athlete, side, kind, point, contactIn } = plan;
    const delay = ctx.diff.reactionDelay;
    if (kind === 'spike') {
      // atacante corre para trás do ponto de contato; o pulo leva até ele
      const backoff = sideSign(side) * 0.85;
      ctx.after(delay, () => athlete.moveTo(point.x + backoff * 0.9, point.z));
      plan.jumpScheduledIn = contactIn - 0.26; // IA pula para contato no ápice
    } else {
      ctx.after(delay, () => athlete.moveTo(point.x, point.z));
    }
  }

  /** Avança os pulos agendados (atacante no ápice + bloqueadores) durante o rally. */
  updateScheduledJumps(dt: number, ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (plan && plan.jumpScheduledIn !== undefined) {
      plan.jumpScheduledIn -= dt;
      if (plan.jumpScheduledIn <= 0) {
        plan.athlete.act('spikeWindup', 0.4);
        plan.athlete.jump(PLAYER.jumpVel);
        plan.jumpScheduledIn = undefined;
      }
    }
    // não remove a entrada ao pular: marca `jumped` para o pulo disparar uma única vez e
    // a pertinência à lista continuar valendo "bloqueador comprometido" por todo o ataque
    // (desacopla a elegibilidade do frame exato do pulo). A lista é zerada por prepareBlock
    // (a cada ataque) e por RallyState.reset() (a cada ponto).
    for (const b of ctx.rally.blockers) {
      if (b.jumped) continue;
      b.jumpIn -= dt;
      if (b.jumpIn <= 0) {
        b.athlete.act('block', 0.7);
        b.athlete.jump(PLAYER.blockJumpVel);
        b.jumped = true;
      }
    }
  }

  /** Qualidade do toque da IA; contra bola forte depende da dificuldade. -1 = não defende. */
  reachQuality(ctx: MechanicsCtx, hard: boolean): number {
    const diff = ctx.diff;
    if (hard && !chance(diff.digChance)) {
      return chance(0.55) ? rand(0.03, 0.12) : -1;
    }
    return rand(diff.passQuality[0], diff.passQuality[1]) * (hard ? 0.75 : 1);
  }

  /** Qualidade da cortada da IA. */
  spikeQuality(): number {
    return rand(0.6, 1);
  }
}
