// Bloqueio: geometria pura do cruzamento (onde/quando a cortada cruza a rede e se um
// bloqueador chega nela) + a mecânica de preparar/resolver o bloqueio sobre o MechanicsCtx.
import * as THREE from 'three';
import {
  BLOCK,
  CONTACT,
  COURT,
  GRAVITY,
  TeamSide,
  otherSide,
  sideSign,
} from '../../core/constants';
import { ballisticDrive, clamp } from '../../core/math3d';
import { computeNetCrossing } from './net';
import type { MechanicsCtx } from './context';
import type { BlockPlan } from '../team/TeamTactics';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BlockCrossing {
  t: number; // instante do cruzamento
  y: number; // altura da bola no cruzamento
  z: number; // z da bola no cruzamento
}

/**
 * Quando/onde a bola cruza o plano da rede (x = 0) dentro da janela de bloqueio.
 * `null` se não cruza a tempo: sem componente horizontal, cruzamento no passado
 * ou tarde demais (fora de {@link BLOCK}.window).
 */
export function blockCrossing(pos: Vec3, vel: Vec3): BlockCrossing | null {
  if (Math.abs(vel.x) < 0.01) return null;
  const t = -pos.x / vel.x;
  if (t <= 0 || t > BLOCK.window) return null;
  const y = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
  const z = pos.z + vel.z * t;
  return { t, y, z };
}

/**
 * A cortada é bloqueável? Falso quando a bola vai bater na rede (deve ser falta de rede,
 * não bloqueio). Usa `computeNetCrossing` (net.ts) como única fonte de verdade da faixa da
 * rede — evita duplicar o piso de altura aqui. Obs.: `blockCrossing` (janela 0.8s) e
 * `computeNetCrossing` (t <= 0.005 → none) têm limiares de borda ligeiramente diferentes;
 * em cruzamentos quase imediatos podem divergir por poucos ms, sem impacto prático.
 */
export function isBlockable(pos: Vec3, vel: Vec3): boolean {
  return computeNetCrossing(pos, vel).kind === 'cross';
}

/** O bloqueador (posição na rede + altura do pulo) alcança a bola no cruzamento? */
export function blockerReaches(
  blockerX: number,
  blockerZ: number,
  jumpY: number,
  cross: BlockCrossing,
  zReachBonus = 0,
  heightBonus = 0,
): boolean {
  const nearNet = Math.abs(blockerX) < BLOCK.nearNetX;
  const zDist = Math.abs(blockerZ - cross.z);
  if (!nearNet || zDist > BLOCK.zReach + zReachBonus) return false;
  const reach = CONTACT.blockReach + jumpY * BLOCK.jumpReachFactor + heightBonus;
  return cross.y <= reach;
}

/** Proximidade [0..1] do bloqueador ao ponto de cruzamento (1 = em cima, 0 = no limite). */
export function blockProximity(
  blockerZ: number,
  crossZ: number,
  zReach: number = BLOCK.zReach,
): number {
  return 1 - Math.abs(blockerZ - crossZ) / zReach;
}

// Bloqueio da IA (ou preparação do lado da IA contra ataque humano)
export function prepareBlock(
  ctx: MechanicsCtx,
  side: TeamSide,
  z: number,
  contactIn: number,
  plan?: BlockPlan | null,
): void {
  ctx.rally.blockers = [];
  const team = ctx.teamOf(side);
  const isAI = !ctx.isHumanSide(side);
  const primary = plan
    ? team.athletes.find((athlete) => athlete.index === plan.primaryAthleteId)
    : team.nearestFrontRowTo(z);
  if (!primary) throw new Error(`Bloqueadora primária ${String(plan?.primaryAthleteId)} ausente`);
  const assist =
    plan?.assistAthleteId === null || plan?.assistAthleteId === undefined
      ? null
      : (team.athletes.find((athlete) => athlete.index === plan.assistAthleteId) ?? null);
  if (plan?.assistAthleteId !== null && plan?.assistAthleteId !== undefined && !assist) {
    throw new Error(`Assistente de bloqueio ${plan.assistAthleteId} ausente`);
  }
  if (!plan) {
    const bx = sideSign(side) * BLOCK.netX;
    primary.moveTo(bx, clamp(z, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4));
  }
  if (isAI && ctx.random.ai.chance(ctx.diff.blockChance)) {
    for (const blocker of [primary, assist].filter((athlete) => athlete !== null)) {
      ctx.rally.blockers.push({
        athlete: blocker,
        jumpIn: contactIn + ctx.random.ai.range(BLOCK.jumpDelayRange[0], BLOCK.jumpDelayRange[1]),
        jumped: false,
      });
    }
  }
}

/** verifica bloqueio no cruzamento da rede (chamado no lançamento da cortada) */
export function resolveBlock(ctx: MechanicsCtx, attackSide: TeamSide): void {
  const defSide = otherSide(attackSide);
  const cross = blockCrossing(ctx.ball.pos, ctx.ball.vel);
  if (!cross) return;
  // bola cruza abaixo da fita → deixa o evento de rede resolver como falta, sem bloqueio
  if (!isBlockable(ctx.ball.pos, ctx.ball.vel)) return;

  // candidatos: bloqueadores da linha de frente que estarão no ar
  const team = ctx.teamOf(defSide);
  const isHumanDef = ctx.isHumanSide(defSide);
  const humanIntent = isHumanDef
    ? (ctx.takeHumanBlockIntent?.(ctx.rally.plan?.planId ?? -1) ?? null)
    : null;
  const zReachBonus = (humanIntent?.reach ?? 0) * 0.35;
  const heightBonus = (humanIntent?.penetration ?? 0) * 0.22;
  const committed = ctx.rally.blockPlan;
  const committedHumanIds =
    isHumanDef &&
    committed &&
    committed.side === defSide &&
    committed.planId === ctx.rally.plan?.planId
      ? new Set(
          [committed.primaryAthleteId, committed.assistAthleteId].filter(
            (athleteId): athleteId is number => athleteId !== null,
          ),
        )
      : null;
  if (isHumanDef && !committedHumanIds) return;
  const candidates: { blocker: ReturnType<typeof team.frontRow>[number]; proximity: number }[] = [];
  for (const blocker of team.frontRow()) {
    // elegibilidade no cruzamento: humano usa o pulo real; a IA usa a pertinência à lista
    // de agendados, agora estável durante todo o ataque (não depende mais do frame exato
    // do pulo, pois o pulo marca `jumped` sem remover a entrada — ver AiController).
    const scheduled = ctx.rally.blockers.find((entry) => entry.athlete === blocker);
    const isScheduledBlocker = isHumanDef
      ? committedHumanIds!.has(blocker.index) && blocker.isAirborne && blocker.jumpY > 0.18
      : scheduled !== undefined && (scheduled.jumped || scheduled.jumpIn <= cross.t);
    if (!isScheduledBlocker) continue;
    // jumpY é real p/ o humano (já no ar); p/ a IA vale ≈0 no lançamento (pulo diferido),
    // então o alcance dela fica congelado em CONTACT.blockReach de propósito, sem prever o ápice.
    if (
      !blockerReaches(blocker.pos.x, blocker.pos.z, blocker.jumpY, cross, zReachBonus, heightBonus)
    )
      continue;

    const baseProximity = blockProximity(blocker.pos.z, cross.z, BLOCK.zReach + zReachBonus);
    const proximity = clamp(
      baseProximity + (1 - baseProximity) * (humanIntent?.penetration ?? 0) * 0.35,
      0,
      1,
    );
    candidates.push({ blocker, proximity });
  }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => a.blocker.index - b.blocker.index);
  const prox = 1 - candidates.reduce((miss, candidate) => miss * (1 - candidate.proximity), 1);
  const blocker = candidates
    .slice()
    .sort((a, b) => b.proximity - a.proximity || a.blocker.index - b.blocker.index)[0].blocker;

  // A dupla amplia a janela lateral, mas produz exatamente um contato, evento e sorteio.
  ctx.after(cross.t, () => {
    const r = ctx.random.contact.nextFloat();
    ctx.rally.blockers = [];
    // origem no ponto analítico de cruzamento da rede (x=0), não na pos stale da bola
    const bp = new THREE.Vector3(0, cross.y, cross.z);
    ctx.hooks.audio.block();
    ctx.hooks.effects.burst(bp, 0x9fd8ff, 20, 6);
    ctx.hooks.camera.addShake(0.6);
    blocker.act('block', 0.5);
    ctx.rally.lastToucher = blocker;
    ctx.rally.lastTouchTeam = defSide;
    ctx.rally.lastKind = 'block';
    ctx.rally.rallyTouches++;
    // toque de bloqueio não conta p/ nenhum lado: quem tocar a seguir recomeça os 3 toques
    ctx.rally.possessionTeam = null;
    ctx.rally.possessionTouches = 0;

    if (r < prox * BLOCK.stuffThreshold) {
      // STUFF: devolve no chão do atacante
      const tgt = new THREE.Vector3(
        sideSign(attackSide) * ctx.random.contact.range(1, 3.5),
        0,
        bp.z + ctx.random.contact.range(-1.5, 1.5),
      );
      const { v0 } = ballisticDrive(bp, tgt, 0.32);
      ctx.ball.launch(bp, v0);
      if (defSide === TeamSide.HOME) ctx.stats.blocks++;
      ctx.hooks.banner(defSide === TeamSide.HOME ? 'MONSTER BLOCK!' : 'BLOQUEADO!');
      ctx.hooks.crowd.excite(1);
      ctx.hooks.audio.cheer(true);
      ctx.emitTelemetry({
        type: 'block',
        side: defSide,
        outcome: 'stuff',
        point: { x: bp.x, y: bp.y, z: bp.z },
      });
      ctx.planNext('dig');
    } else if (r < prox * BLOCK.softThreshold) {
      // pingo: bola sobe devagar e continua no lado defensor — jogável
      const v = ctx.ball.vel.clone();
      v.x *= 0.25;
      v.z *= 0.4;
      v.y = Math.abs(v.y) * 0.3 + 3.2;
      ctx.ball.launch(bp, v);
      ctx.emitTelemetry({
        type: 'block',
        side: defSide,
        outcome: 'soft',
        point: { x: bp.x, y: bp.y, z: bp.z },
      });
      ctx.planNext('pass');
    } else {
      // explode no bloqueio pra fora (ponto do atacante)
      const v = ctx.ball.vel.clone();
      v.x *= -0.3;
      v.y = 2;
      v.z = ctx.random.contact.range(-6, 6);
      ctx.ball.launch(bp, v);
      ctx.emitTelemetry({
        type: 'block',
        side: defSide,
        outcome: 'out',
        point: { x: bp.x, y: bp.y, z: bp.z },
      });
      ctx.planNext('pass');
    }
  });
}
