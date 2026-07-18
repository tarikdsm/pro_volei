// Decisões da IA: agendamento de aproximação/pulo e rolagens de qualidade, parametrizadas por
// ctx.diff. Sem estado próprio. A seleção de alvo da IA fica em mechanics/ (touch/serve).
import { AI_ATTACK, PLAYER, sideSign } from '../../core/constants';
import { TouchPlan } from '../RallyState';
import type { MechanicsCtx } from '../mechanics/context';

export class AiController {
  /** Manda o atleta da IA ao ponto de contato (com reactionDelay) e agenda o pulo no ataque. */
  scheduleApproach(ctx: MechanicsCtx, plan: TouchPlan): void {
    const { athlete, side, kind, point, contactIn } = plan;
    const delay = ctx.diff.reactionDelay;
    const tacticalRevision = plan.tacticalRevision ?? 0;
    if (kind === 'spike') {
      // Atacante corre para trás do ponto de contato; o pulo leva até ele. A aproximação é
      // imediata: a jogada da própria equipe já foi comprometida pela estratégia — o
      // reactionDelay modela percepção do adversário, não da execução do próprio plano.
      const backoff = sideSign(side) * 0.85;
      ctx.after(0, () => {
        if (
          ctx.rally.plan !== plan ||
          ctx.rally.plan.athlete !== athlete ||
          (plan.tacticalRevision ?? 0) !== tacticalRevision
        )
          return;
        athlete.moveTo(point.x + backoff * 0.9, point.z);
      });
      plan.jumpScheduledIn = contactIn - AI_ATTACK.jumpLeadSeconds; // IA pula para contato no ápice
    } else {
      ctx.after(delay, () => {
        if (
          ctx.rally.plan !== plan ||
          ctx.rally.plan.athlete !== athlete ||
          (plan.tacticalRevision ?? 0) !== tacticalRevision
        )
          return;
        athlete.moveTo(point.x, point.z);
      });
    }
  }

  /** Avança os pulos agendados (atacante no ápice + bloqueadores) durante o rally. */
  updateScheduledJumps(dt: number, ctx: MechanicsCtx): void {
    this.advanceScheduledJumpTimers(dt, ctx);
    this.resolveScheduledJumps(ctx);
  }

  /** Avança somente os relógios; a timeline resolve o pulo após integrar até a fronteira. */
  advanceScheduledJumpTimers(dt: number, ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (plan?.jumpScheduledIn !== undefined) plan.jumpScheduledIn -= dt;
    for (const blocker of ctx.rally.blockers) {
      if (!blocker.jumped) blocker.jumpIn -= dt;
    }
  }

  /** Resolve todos os pulos cujos relógios alcançaram zero no instante analítico atual. */
  resolveScheduledJumps(ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (plan?.jumpScheduledIn !== undefined && plan.jumpScheduledIn <= 0) {
      const d = Math.hypot(plan.athlete.pos.x - plan.point.x, plan.athlete.pos.z - plan.point.z);
      // Longe do ponto, não deixa o chão: no ar a velocidade cai a 25% e a aproximação congela.
      // O agendamento expirado permanece e é reavaliado por tick; se a atacante nunca chegar,
      // o resgate freeball do contato assume em vez de a bola cair sem disputa.
      if (d <= AI_ATTACK.jumpMaxDistance) {
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
    if (hard && !ctx.random.contact.chance(diff.digChance)) {
      return ctx.random.contact.chance(0.55) ? ctx.random.contact.range(0.03, 0.12) : -1;
    }
    return ctx.random.contact.range(diff.passQuality[0], diff.passQuality[1]) * (hard ? 0.75 : 1);
  }

  /** Qualidade da cortada da IA. */
  spikeQuality(ctx: MechanicsCtx): number {
    return ctx.random.contact.range(0.6, 1);
  }
}
