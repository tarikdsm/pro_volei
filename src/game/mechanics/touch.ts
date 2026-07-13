// Mecânica dos toques: despacho do toque e as três ações (passe, levantamento, cortada).
// Funções livres sobre o MechanicsCtx, extraídas de Match.ts.
import * as THREE from 'three';
import {
  CONTACT,
  ATTACK_ZONES,
  STRATEGIC_OFFENSE_REALIZATION,
  TeamSide,
  otherSide,
  sideSign,
} from '../../core/constants';
import { ballisticArc, ballisticDrive, clamp, lerp } from '../../core/math3d';
import { TouchPlan } from '../RallyState';
import type { ActionIntent } from '../control/ActionIntent';
import { resolveBlock } from './block';
import type { MechanicsCtx } from './context';
import type { CpuTouchExecution } from '../strategy/StrategicTouchExecution';

export function executeTouch(
  ctx: MechanicsCtx,
  plan: TouchPlan,
  quality: number,
  intent?: ActionIntent,
  cpuExecution?: CpuTouchExecution,
): void {
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

  // No terceiro toque, o mesmo botão vira automaticamente passe para a quadra rival.
  if ((kind === 'pass' || kind === 'dig') && ctx.rally.possessionTouches >= 3) {
    ctx.rally.lastKind = 'freeball';
    doFreeball(ctx, plan, quality, intent);
    return;
  }

  switch (kind) {
    case 'pass':
    case 'dig':
      doPass(ctx, plan, quality, intent);
      break;
    case 'freeball':
      doFreeball(ctx, plan, quality, intent);
      break;
    case 'set':
      doSet(ctx, plan, quality, intent, cpuExecution?.kind === 'set' ? cpuExecution : undefined);
      break;
    case 'spike':
      doSpike(
        ctx,
        plan,
        quality,
        intent,
        cpuExecution?.kind === 'spike' ? cpuExecution : undefined,
      );
      break;
    default:
      doPass(ctx, plan, quality);
  }
}

function doPass(ctx: MechanicsCtx, plan: TouchPlan, q: number, intent?: ActionIntent): void {
  const { athlete, side } = plan;
  athlete.act(intent?.technique === 'emergency-dive' || q < 0.3 ? 'dive' : 'bump', 0.55);
  ctx.hooks.audio.hitSoft();
  // lança a partir de plan.point (ponto analítico do contato), não de ctx.ball.pos
  // (posição stale do frame anterior — a bola só avança em ball.step depois deste handler).
  ctx.hooks.effects.burst(plan.point, 0xfff2b0, 8, 2);

  const team = ctx.teamOf(side);
  const sp = team.setterSpot();
  let target: THREE.Vector3;
  if (q < 0.15) {
    // escorregou: bola explode em direção imprevisível (pode sair, voltar, tudo)
    target = new THREE.Vector3(
      plan.point.x + ctx.random.contact.range(-6, 6),
      CONTACT.set,
      plan.point.z + ctx.random.contact.range(-6, 6),
    );
  } else {
    const noise = (1 - q) * 2.6;
    target = new THREE.Vector3(
      clamp(
        sp.x + ctx.random.contact.range(-noise, noise),
        side === TeamSide.HOME ? -8.5 : 0.6,
        side === TeamSide.HOME ? -0.6 : 8.5,
      ),
      CONTACT.set,
      clamp(sp.z + ctx.random.contact.range(-noise, noise), -4, 4),
    );
    if (intent) {
      target.x = clamp(
        target.x + intent.direction.x * 1.2,
        side === TeamSide.HOME ? -8.5 : 0.6,
        side === TeamSide.HOME ? -0.6 : 8.5,
      );
      target.z = clamp(target.z + intent.direction.z * 2.2, -4, 4);
    }
  }
  const { v0 } = ballisticArc(plan.point.clone(), target, 2.6 + (1 - q) * 1.2);
  ctx.ball.launch(plan.point.clone(), v0);

  // se o time já gastou os 3 toques, esta bola precisa ter ido para o outro lado — senão cai
  if (ctx.rally.possessionTouches >= 3) {
    emitContact(ctx, plan, plan.kind, q, target);
    ctx.planNext('pass');
    return;
  }

  // designa levantador para o próximo toque
  ctx.rally.setterHold = team.nearestTo(sp.x, sp.z, athlete);
  ctx.rally.plannedAttacker = null;

  // passe horrível vira bola de graça pro outro lado às vezes
  if (q < 0.18 && ctx.random.contact.chance(0.5)) {
    emitContact(ctx, plan, plan.kind, q, target);
    ctx.planNext('pass'); // deixa o motor decidir pelo lado em que vai cair
    return;
  }
  emitContact(ctx, plan, plan.kind, q, target);
  ctx.planNext('set');
}

function doSet(
  ctx: MechanicsCtx,
  plan: TouchPlan,
  q: number,
  intent?: ActionIntent,
  cpuExecution?: Extract<CpuTouchExecution, { kind: 'set' }>,
): void {
  const { athlete, side } = plan;
  athlete.act('set', 0.55);
  ctx.hooks.audio.hitSoft();

  const team = ctx.teamOf(side);
  // zona de ataque: humano escolheu com A/W/D; IA escolhe aleatória
  if (!plan.isHuman && cpuExecution) {
    const noiseX = ctx.random.contact.range(-1, 1);
    const noiseZ = ctx.random.contact.range(-1, 1);
    ctx.rally.setterHold = null;
    if (cpuExecution.execution.mode === 'safety-freeball') {
      const tuning = STRATEGIC_OFFENSE_REALIZATION.safety;
      const target = new THREE.Vector3(
        sideSign(otherSide(side)) * (tuning.depth + noiseX * 0.35),
        0,
        noiseZ * tuning.lateral,
      );
      const { v0 } = ballisticArc(plan.point.clone(), target, tuning.apex);
      ctx.ball.launch(plan.point.clone(), v0);
      ctx.rally.lastKind = 'freeball';
      ctx.rally.plannedAttacker = null;
      emitContact(ctx, plan, 'freeball', q, target);
      ctx.hooks.zoneHint(null);
      ctx.planNext('pass');
      return;
    }

    const spread = 1 - clamp(q, 0, 1);
    const dispersion = STRATEGIC_OFFENSE_REALIZATION.setDispersion;
    const contact = new THREE.Vector3(
      cpuExecution.execution.target.x + noiseX * dispersion.x * spread,
      CONTACT.spike,
      clamp(cpuExecution.execution.target.z + noiseZ * dispersion.z * spread, -4.1, 4.1),
    );
    const attackerId = cpuExecution.attackerAthleteId;
    ctx.rally.plannedAttacker =
      attackerId === null
        ? team.nearestFrontRowTo(contact.z, athlete)
        : (team.athletes[attackerId] ?? team.nearestFrontRowTo(contact.z, athlete));
    const apex = STRATEGIC_OFFENSE_REALIZATION.setApex[cpuExecution.execution.family];
    const { v0 } = ballisticArc(plan.point.clone(), contact, apex + spread * 0.7);
    ctx.ball.launch(plan.point.clone(), v0);
    emitContact(ctx, plan, 'set', q, contact);
    ctx.hooks.zoneHint(null);
    ctx.planNext('spike');
    return;
  }

  const zoneIdx = plan.isHuman ? ctx.chosenZone : ctx.random.ai.pick([0, 1, 2]);
  const zoneZ = side === TeamSide.HOME ? ATTACK_ZONES[zoneIdx] : -ATTACK_ZONES[zoneIdx];
  const attacker = team.nearestFrontRowTo(zoneZ, athlete);
  ctx.rally.plannedAttacker = attacker;
  ctx.rally.setterHold = null;

  const contact = new THREE.Vector3(
    sideSign(side) * ctx.random.contact.range(0.8, 1.1),
    CONTACT.spike,
    clamp(zoneZ + ctx.random.contact.range(-0.3, 0.3) * (1 - q), -4.1, 4.1),
  );
  const baseApex = zoneIdx === 1 ? 0.6 : 1.5;
  const apex =
    intent?.technique === 'quick-set'
      ? lerp(baseApex * 0.72, 0.35, intent.power)
      : intent?.technique === 'high-set'
        ? baseApex + 0.8
        : baseApex;
  const { v0 } = ballisticArc(plan.point.clone(), contact, apex + (1 - q) * 0.8);
  ctx.ball.launch(plan.point.clone(), v0);
  emitContact(ctx, plan, 'set', q, contact);
  ctx.hooks.zoneHint(null);
  ctx.planNext('spike');
}

function doSpike(
  ctx: MechanicsCtx,
  plan: TouchPlan,
  q: number,
  intent?: ActionIntent,
  cpuExecution?: Extract<CpuTouchExecution, { kind: 'spike' }>,
): void {
  const { athlete, side } = plan;
  athlete.act('spikeHit', 0.5);
  ctx.hooks.audio.hitHard();
  ctx.hooks.camera.kickFov(9);
  ctx.hooks.camera.addShake(0.5);
  ctx.hooks.slowMo(0.35, 0.4);
  ctx.hooks.effects.burst(plan.point, 0xffcf6b, 16, 5);

  const enemy = otherSide(side);
  const s = sideSign(enemy);
  let target: THREE.Vector3;
  let strategicNetMiss = false;
  const isAI = !plan.isHuman;

  if (isAI && cpuExecution) {
    const missed = ctx.random.contact.chance(ctx.diff.attackError);
    const netError = ctx.random.contact.chance(STRATEGIC_OFFENSE_REALIZATION.error.netModeBelow);
    const noiseX = ctx.random.contact.range(-1, 1);
    const noiseZ = ctx.random.contact.range(-1, 1);
    if (missed) {
      const error = STRATEGIC_OFFENSE_REALIZATION.error;
      strategicNetMiss = netError;
      target = netError
        ? new THREE.Vector3(s * error.netDepth, error.netHeight, noiseZ * 3)
        : new THREE.Vector3(
            s * lerp(error.longDepth[0], error.longDepth[1], (noiseX + 1) / 2),
            0,
            noiseZ * error.lateral,
          );
    } else {
      const dispersion =
        STRATEGIC_OFFENSE_REALIZATION.attackDispersion[cpuExecution.execution.family];
      const spread = dispersion * (0.2 + (1 - clamp(q, 0, 1)) * 0.8);
      target = new THREE.Vector3(
        cpuExecution.execution.target.x + noiseX * spread,
        0,
        cpuExecution.execution.target.z + noiseZ * spread,
      );
    }
  } else if (isAI && ctx.random.contact.chance(ctx.diff.attackError)) {
    target = ctx.random.contact.chance(0.5)
      ? new THREE.Vector3(
          s * ctx.random.contact.range(9.5, 11.5),
          0,
          ctx.random.contact.range(-5, 5),
        ) // pra fora
      : new THREE.Vector3(s * 0.3, 1.0, ctx.random.contact.range(-3, 3)); // na rede
  } else if (isAI) {
    const spots = [
      new THREE.Vector3(s * ctx.random.ai.range(6.5, 8.5), 0, ctx.random.ai.range(-3.8, -2.2)),
      new THREE.Vector3(s * ctx.random.ai.range(6.5, 8.5), 0, ctx.random.ai.range(2.2, 3.8)),
      new THREE.Vector3(s * ctx.random.ai.range(2.5, 4.5), 0, ctx.random.ai.range(-3.5, 3.5)),
      new THREE.Vector3(s * ctx.random.ai.range(5, 8), 0, ctx.random.ai.range(-1.5, 1.5)),
    ];
    target = ctx.random.ai.pick(spots);
  } else {
    // humano: mira + erro pela qualidade do pulo
    const err = (1 - q) * 2.4;
    target = new THREE.Vector3(
      ctx.aim.x + (intent?.direction.x ?? 0) * 1.1 + ctx.random.contact.range(-err, err),
      0,
      ctx.aim.z + (intent?.direction.z ?? 0) * 1.4 + ctx.random.contact.range(-err, err),
    );
  }

  const dist = Math.hypot(target.x - plan.point.x, target.z - plan.point.z);
  let v0: THREE.Vector3;
  if (isAI && cpuExecution && strategicNetMiss) {
    const time = clamp(dist / 16, 0.18, 0.45);
    v0 = ballisticDrive(plan.point.clone(), target, time).v0;
  } else if (isAI && cpuExecution?.execution.family === 'tip') {
    v0 = ballisticArc(plan.point.clone(), target, STRATEGIC_OFFENSE_REALIZATION.tipApex).v0;
  } else if (isAI && cpuExecution && cpuExecution.execution.family !== 'tip') {
    const speedRange = STRATEGIC_OFFENSE_REALIZATION.attackSpeed[cpuExecution.execution.family];
    const speed = lerp(speedRange[0], speedRange[1], clamp(q, 0, 1));
    const time = clamp(dist / speed, 0.3, 0.9);
    v0 = ballisticDrive(plan.point.clone(), target, time).v0;
  } else if (!isAI && intent?.technique === 'tip') {
    v0 = ballisticArc(plan.point.clone(), target, 0.65).v0;
  } else {
    const speed =
      !isAI && intent?.technique === 'power-spike'
        ? lerp(15, 23, intent.power)
        : !isAI && intent?.technique === 'placed-shot'
          ? lerp(11, 16, intent.precision)
          : lerp(11, 20, q);
    const time = clamp(dist / speed, 0.34, 0.85);
    v0 = ballisticDrive(plan.point.clone(), target, time).v0;
  }
  ctx.ball.launch(plan.point.clone(), v0);
  emitContact(ctx, plan, 'spike', q, target);
  ctx.hooks.effects.showAim(null);

  resolveBlock(ctx, side);
  ctx.planNext('pass');
}

function doFreeball(ctx: MechanicsCtx, plan: TouchPlan, q: number, intent?: ActionIntent): void {
  const { athlete, side } = plan;
  athlete.act(intent?.technique === 'reaching-freeball' ? 'dive' : 'bump', 0.6);
  ctx.hooks.audio.hitSoft();
  ctx.hooks.effects.burst(plan.point, 0xc8efff, 10, 2.5);

  const enemySign = sideSign(otherSide(side));
  const power = intent?.power ?? 0.5;
  const direction = intent?.direction ?? { x: 0, z: 0 };
  const target = new THREE.Vector3(
    enemySign * lerp(4.5, 8, power) + direction.x * 0.8,
    0,
    clamp(direction.z * 3.5, -3.8, 3.8),
  );
  const apex = lerp(2, 1.1, power) + (1 - q) * 0.8;
  const { v0 } = ballisticArc(plan.point.clone(), target, apex);
  ctx.ball.launch(plan.point.clone(), v0);
  emitContact(ctx, plan, 'freeball', q, target);
  ctx.hooks.effects.showAim(null);
  ctx.planNext('pass');
}

function emitContact(
  ctx: MechanicsCtx,
  plan: TouchPlan,
  kind: TouchPlan['kind'],
  quality: number,
  target: THREE.Vector3,
): void {
  ctx.onBallContact({
    side: plan.side,
    kind,
    athleteId: plan.athlete.index,
    outcomeToken: plan.serveOutcomeToken,
  });
  ctx.emitTelemetry({
    type: 'contact',
    side: plan.side,
    kind,
    athlete: plan.athlete.index,
    possessionTouch: ctx.rally.possessionTouches,
    rallyTouch: ctx.rally.rallyTouches,
    quality,
    point: { x: plan.point.x, y: plan.point.y, z: plan.point.z },
    target: { x: target.x, y: target.y, z: target.z },
  });
}
