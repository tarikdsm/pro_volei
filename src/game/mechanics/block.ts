// Bloqueio: geometria pura do cruzamento (onde/quando a cortada cruza a rede e se um
// bloqueador chega nela) + a mecânica de preparar/resolver o bloqueio sobre o MechanicsCtx.
import * as THREE from 'three';
import { CONTACT, COURT, GRAVITY, TeamSide, otherSide, sideSign } from '../../core/constants';
import { ballisticDrive, rand, chance, clamp } from '../../core/math3d';
import type { MechanicsCtx } from './context';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Janela de tempo (s) após o contato em que o bloqueio ainda pode acontecer. */
const BLOCK_WINDOW = 0.8;
/** Distância máx. na rede (eixo x) para o bloqueador contar como "na rede". */
const NEAR_NET_X = 1.4;
/** Distância máx. em z entre bloqueador e ponto de cruzamento para alcançar a bola. */
const BLOCK_Z_REACH = 0.85;

export interface BlockCrossing {
  t: number; // instante do cruzamento
  y: number; // altura da bola no cruzamento
  z: number; // z da bola no cruzamento
}

/**
 * Quando/onde a bola cruza o plano da rede (x = 0) dentro da janela de bloqueio.
 * `null` se não cruza a tempo: sem componente horizontal, cruzamento no passado
 * ou tarde demais (fora de {@link BLOCK_WINDOW}).
 */
export function blockCrossing(pos: Vec3, vel: Vec3): BlockCrossing | null {
  if (Math.abs(vel.x) < 0.01) return null;
  const t = -pos.x / vel.x;
  if (t <= 0 || t > BLOCK_WINDOW) return null;
  const y = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
  const z = pos.z + vel.z * t;
  return { t, y, z };
}

/** O bloqueador (posição na rede + altura do pulo) alcança a bola no cruzamento? */
export function blockerReaches(
  blockerX: number,
  blockerZ: number,
  jumpY: number,
  cross: BlockCrossing,
): boolean {
  const nearNet = Math.abs(blockerX) < NEAR_NET_X;
  const zDist = Math.abs(blockerZ - cross.z);
  if (!nearNet || zDist > BLOCK_Z_REACH) return false;
  const reach = CONTACT.blockReach + jumpY * 0.5;
  return cross.y <= reach;
}

/** Proximidade [0..1] do bloqueador ao ponto de cruzamento (1 = em cima, 0 = no limite). */
export function blockProximity(blockerZ: number, crossZ: number): number {
  return 1 - Math.abs(blockerZ - crossZ) / BLOCK_Z_REACH;
}

// Bloqueio da IA (ou preparação do lado da IA contra ataque humano)
export function prepareBlock(
  ctx: MechanicsCtx,
  side: TeamSide,
  z: number,
  contactIn: number,
): void {
  ctx.rally.blockers = [];
  const team = ctx.teamOf(side);
  const isAI = side === TeamSide.AWAY;
  const blocker = team.nearestFrontRowTo(z);
  const bx = sideSign(side) * 0.72;
  blocker.moveTo(bx, clamp(z, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4));
  if (isAI && chance(ctx.diff.blockChance)) {
    ctx.rally.blockers.push({ athlete: blocker, jumpIn: contactIn + rand(0.0, 0.12) });
  }
}

/** verifica bloqueio no cruzamento da rede (chamado no lançamento da cortada) */
export function resolveBlock(ctx: MechanicsCtx, attackSide: TeamSide): void {
  const defSide = otherSide(attackSide);
  const cross = blockCrossing(ctx.ball.pos, ctx.ball.vel);
  if (!cross) return;

  // candidatos: bloqueadores da linha de frente que estarão no ar
  const team = ctx.teamOf(defSide);
  const isHumanDef = defSide === TeamSide.HOME;
  for (const blocker of team.frontRow()) {
    // no momento do cruzamento o bloqueador precisa estar no ar
    const willBeAirborne = isHumanDef
      ? blocker.isAirborne && blocker.jumpY > 0.18
      : ctx.rally.blockers.some((b) => b.athlete === blocker);
    if (!willBeAirborne) continue;
    if (!blockerReaches(blocker.pos.x, blocker.pos.z, blocker.jumpY, cross)) continue;

    // BLOQUEIO! resolve no instante do cruzamento (prox congelada no agendamento)
    const prox = blockProximity(blocker.pos.z, cross.z);
    ctx.after(cross.t, () => {
      const r = Math.random();
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

      if (r < prox * 0.5) {
        // STUFF: devolve no chão do atacante
        const tgt = new THREE.Vector3(
          sideSign(attackSide) * rand(1, 3.5),
          0,
          bp.z + rand(-1.5, 1.5),
        );
        const { v0 } = ballisticDrive(bp, tgt, 0.32);
        ctx.ball.launch(bp, v0);
        if (defSide === TeamSide.HOME) ctx.stats.blocks++;
        ctx.hooks.banner(defSide === TeamSide.HOME ? 'MONSTER BLOCK!' : 'BLOQUEADO!');
        ctx.hooks.crowd.excite(1);
        ctx.hooks.audio.cheer(true);
        ctx.planNext('dig');
      } else if (r < prox * 0.95) {
        // pingo: bola sobe devagar e continua no lado defensor — jogável
        const v = ctx.ball.vel.clone();
        v.x *= 0.25;
        v.z *= 0.4;
        v.y = Math.abs(v.y) * 0.3 + 3.2;
        ctx.ball.launch(bp, v);
        // toque de bloqueio não conta: posse continua limpa p/ defesa
        ctx.rally.possessionTeam = null;
        ctx.rally.possessionTouches = 0;
        ctx.planNext('pass');
      } else {
        // explode no bloqueio pra fora (ponto do atacante)
        const v = ctx.ball.vel.clone();
        v.x *= -0.3;
        v.y = 2;
        v.z = rand(-6, 6);
        ctx.ball.launch(bp, v);
        ctx.planNext('pass');
      }
    });
    return; // um bloqueador resolve
  }
}
