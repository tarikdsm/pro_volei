// Mecânica dos toques: despacho do toque e as três ações (passe, levantamento, cortada).
// Funções livres sobre o MechanicsCtx, extraídas de Match.ts.
import * as THREE from 'three';
import { CONTACT, ATTACK_ZONES, TeamSide, otherSide, sideSign } from '../../core/constants';
import {
  ballisticArc,
  ballisticDrive,
  rand,
  chance,
  clamp,
  randPick,
  lerp,
} from '../../core/math3d';
import { TouchPlan } from '../RallyState';
import { resolveBlock } from './block';
import type { MechanicsCtx } from './context';

export function executeTouch(ctx: MechanicsCtx, plan: TouchPlan, quality: number): void {
  const { athlete, kind, side } = plan;
  plan.done = true;
  ctx.rally.lastToucher = athlete;
  ctx.rally.rallyTouches++;
  ctx.hooks.crowd.excite(0.25 + Math.min(0.4, ctx.rally.rallyTouches * 0.04));
  ctx.hooks.audio.excite(0.3);

  // contagem de toques (bloqueio não conta)
  if (kind !== 'block') ctx.rally.countTouch(side);
  ctx.rally.lastTouchTeam = side;
  ctx.rally.lastKind = kind;

  switch (kind) {
    case 'pass':
    case 'dig':
    case 'freeball':
      doPass(ctx, plan, quality);
      break;
    case 'set':
      doSet(ctx, plan, quality);
      break;
    case 'spike':
      doSpike(ctx, plan, quality);
      break;
    default:
      doPass(ctx, plan, quality);
  }
}

function doPass(ctx: MechanicsCtx, plan: TouchPlan, q: number): void {
  const { athlete, side } = plan;
  athlete.act(q < 0.3 ? 'dive' : 'bump', 0.55);
  ctx.hooks.audio.hitSoft();
  ctx.hooks.effects.burst(ctx.ball.pos, 0xfff2b0, 8, 2);

  const team = ctx.teamOf(side);
  const sp = team.setterSpot();
  let target: THREE.Vector3;
  if (q < 0.15) {
    // escorregou: bola explode em direção imprevisível (pode sair, voltar, tudo)
    target = new THREE.Vector3(
      ctx.ball.pos.x + rand(-6, 6),
      CONTACT.set,
      ctx.ball.pos.z + rand(-6, 6),
    );
  } else {
    const noise = (1 - q) * 2.6;
    target = new THREE.Vector3(
      clamp(
        sp.x + rand(-noise, noise),
        side === TeamSide.HOME ? -8.5 : 0.6,
        side === TeamSide.HOME ? -0.6 : 8.5,
      ),
      CONTACT.set,
      clamp(sp.z + rand(-noise, noise), -4, 4),
    );
  }
  const { v0 } = ballisticArc(ctx.ball.pos.clone(), target, 2.6 + (1 - q) * 1.2);
  ctx.ball.launch(ctx.ball.pos.clone(), v0);

  // se o time já gastou os 3 toques, esta bola precisa ter ido para o outro lado — senão cai
  if (ctx.rally.possessionTouches >= 3) {
    ctx.planNext('pass');
    return;
  }

  // designa levantador para o próximo toque
  ctx.rally.setterHold = team.nearestTo(sp.x, sp.z, athlete);
  ctx.rally.plannedAttacker = null;

  // passe horrível vira bola de graça pro outro lado às vezes
  if (q < 0.18 && chance(0.5)) {
    ctx.planNext('pass'); // deixa o motor decidir pelo lado em que vai cair
    return;
  }
  ctx.planNext('set');
}

function doSet(ctx: MechanicsCtx, plan: TouchPlan, q: number): void {
  const { athlete, side } = plan;
  athlete.act('set', 0.55);
  ctx.hooks.audio.hitSoft();

  const team = ctx.teamOf(side);
  // zona de ataque: humano escolheu com A/W/D; IA escolhe aleatória
  const zoneIdx = side === TeamSide.HOME ? ctx.chosenZone : randPick([0, 1, 2]);
  const zoneZ = side === TeamSide.HOME ? ATTACK_ZONES[zoneIdx] : -ATTACK_ZONES[zoneIdx];
  const attacker = team.nearestFrontRowTo(zoneZ, athlete);
  ctx.rally.plannedAttacker = attacker;
  ctx.rally.setterHold = null;

  const contact = new THREE.Vector3(
    sideSign(side) * rand(0.8, 1.1),
    CONTACT.spike,
    clamp(zoneZ + rand(-0.3, 0.3) * (1 - q), -4.1, 4.1),
  );
  const apex = zoneIdx === 1 ? 0.6 : 1.5; // bola rápida no meio, alta nas pontas
  const { v0 } = ballisticArc(ctx.ball.pos.clone(), contact, apex + (1 - q) * 0.8);
  ctx.ball.launch(ctx.ball.pos.clone(), v0);
  ctx.hooks.zoneHint(null);
  ctx.planNext('spike');
}

function doSpike(ctx: MechanicsCtx, plan: TouchPlan, q: number): void {
  const { athlete, side } = plan;
  athlete.act('spikeHit', 0.5);
  ctx.hooks.audio.hitHard();
  ctx.hooks.camera.kickFov(9);
  ctx.hooks.camera.addShake(0.5);
  ctx.hooks.slowMo(0.35, 0.4);
  ctx.hooks.effects.burst(ctx.ball.pos, 0xffcf6b, 16, 5);

  const enemy = otherSide(side);
  const s = sideSign(enemy);
  let target: THREE.Vector3;
  const isAI = side === TeamSide.AWAY;

  if (isAI && chance(ctx.diff.attackError)) {
    target = chance(0.5)
      ? new THREE.Vector3(s * rand(9.5, 11.5), 0, rand(-5, 5)) // pra fora
      : new THREE.Vector3(s * 0.3, 1.0, rand(-3, 3)); // na rede
  } else if (isAI) {
    const spots = [
      new THREE.Vector3(s * rand(6.5, 8.5), 0, rand(-3.8, -2.2)),
      new THREE.Vector3(s * rand(6.5, 8.5), 0, rand(2.2, 3.8)),
      new THREE.Vector3(s * rand(2.5, 4.5), 0, rand(-3.5, 3.5)),
      new THREE.Vector3(s * rand(5, 8), 0, rand(-1.5, 1.5)),
    ];
    target = randPick(spots);
  } else {
    // humano: mira + erro pela qualidade do pulo
    const err = (1 - q) * 2.4;
    target = new THREE.Vector3(ctx.aim.x + rand(-err, err), 0, ctx.aim.z + rand(-err, err));
  }

  const dist = Math.hypot(target.x - ctx.ball.pos.x, target.z - ctx.ball.pos.z);
  const T = clamp(dist / lerp(11, 20, q), 0.34, 0.75);
  const { v0 } = ballisticDrive(ctx.ball.pos.clone(), target, T);
  ctx.ball.launch(ctx.ball.pos.clone(), v0);
  ctx.hooks.effects.showAim(null);

  resolveBlock(ctx, side);
  ctx.planNext(ctx.rally.touchesOf(enemy) === 0 ? 'pass' : 'pass');
}
