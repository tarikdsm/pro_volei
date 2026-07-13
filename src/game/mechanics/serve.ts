// Mecânica do saque: execução do saque (física + efeitos) e escolha de saque da IA.
// Funções livres sobre o MechanicsCtx, extraídas de Match.ts.
import * as THREE from 'three';
import {
  COURT,
  STRATEGIC_SERVE_TUNING,
  otherSide,
  sideSign,
  type TeamSide,
} from '../../core/constants';
import { clamp, serveDrive, lerp } from '../../core/math3d';
import type { Athlete } from '../Team';
import type {
  ServeCommitmentRef,
  StrategicServeDirective,
  StrategicServeRealization,
} from '../strategy/StrategicServeSystem';
import type { MechanicsCtx } from './context';

export type StrategicServeGuardStage = 'toss' | 'hit';

export interface StrategicServeHooks {
  guard(ref: ServeCommitmentRef, stage: StrategicServeGuardStage): boolean;
  onLaunched(ref: ServeCommitmentRef, realization: StrategicServeRealization): boolean;
}

function finishServe(
  ctx: MechanicsCtx,
  side: TeamSide,
  athleteIndex: number,
  power: number,
  target: THREE.Vector3,
  clearance: number,
): void {
  const p0 = ctx.ball.pos.clone();
  const { v0 } = serveDrive(p0, target, COURT.netHeight + clearance);
  ctx.ball.launch(p0, v0);
  ctx.startRally();
  ctx.emitTelemetry({
    type: 'serve',
    side,
    athlete: athleteIndex,
    power,
    target: { x: target.x, y: target.y, z: target.z },
    clearance,
  });
  ctx.hooks.audio.hitHard();
  ctx.rally.lastTouchTeam = side;
  ctx.rally.lastKind = 'serve';
  ctx.rally.possessionTeam = side;
  ctx.rally.possessionTouches = 0;
  ctx.hooks.camera.setMode('rally');
  ctx.planNext('pass');
}

function realizeStrategicServe(
  ctx: MechanicsCtx,
  side: TeamSide,
  directive: StrategicServeDirective,
): StrategicServeRealization {
  // Orçamento fixo: power, error, errorMode, dx, dz, clearance.
  const powerDraw = ctx.random.contact.nextFloat();
  const errorDraw = ctx.random.contact.nextFloat();
  const errorModeDraw = ctx.random.contact.nextFloat();
  const dxDraw = ctx.random.contact.nextFloat();
  const dzDraw = ctx.random.contact.nextFloat();
  const clearanceDraw = ctx.random.contact.nextFloat();
  const tuning = STRATEGIC_SERVE_TUNING.families[directive.family];
  const basePower = lerp(ctx.diff.servePower[0], ctx.diff.servePower[1], powerDraw);
  const power = clamp(basePower + tuning.powerBias, 0, 1);
  const dx = (dxDraw * 2 - 1) * tuning.dispersion.x;
  const dz = (dzDraw * 2 - 1) * tuning.dispersion.z;
  const errorChance = clamp(ctx.diff.serveError * tuning.errorMultiplier, 0, 1);
  const error = errorDraw < errorChance;
  const longError = error && errorModeDraw < STRATEGIC_SERVE_TUNING.longErrorModeBelow;
  const netError = error && !longError;
  const x = longError
    ? sideSign(otherSide(side)) *
      lerp(
        STRATEGIC_SERVE_TUNING.longErrorDepth[0],
        STRATEGIC_SERVE_TUNING.longErrorDepth[1],
        dxDraw,
      )
    : directive.target.x + dx;
  const target = Object.freeze({ x, z: directive.target.z + dz });
  const clearance = netError
    ? lerp(
        STRATEGIC_SERVE_TUNING.netErrorClearance[0],
        STRATEGIC_SERVE_TUNING.netErrorClearance[1],
        clearanceDraw,
      )
    : longError
      ? lerp(
          STRATEGIC_SERVE_TUNING.longErrorClearance[0],
          STRATEGIC_SERVE_TUNING.longErrorClearance[1],
          clearanceDraw,
        )
      : Math.max(
          STRATEGIC_SERVE_TUNING.validClearanceMin,
          lerp(tuning.clearance[0], tuning.clearance[1], clearanceDraw) -
            power * STRATEGIC_SERVE_TUNING.validClearancePowerDrop,
        );
  return Object.freeze({ target, power, clearance });
}

export function performServe(
  ctx: MechanicsCtx,
  server: Athlete,
  power: number,
  target: THREE.Vector3,
  clearance: number,
): void {
  const side = ctx.servingTeam;
  const serverIndex = server.index;
  ctx.hooks.serveMeter(false);
  ctx.hooks.effects.showAim(null);
  server.act('serveToss', 0.5);
  const hand = server.reachPoint();
  ctx.ball.launch(new THREE.Vector3(hand.x, 1.15, hand.z), new THREE.Vector3(0, 5.6, 0));
  ctx.after(0.34, () => server.act('serveHit', 0.5));
  ctx.after(0.42, () => {
    finishServe(ctx, side, serverIndex, power, target, clearance);
  });
}

export function performStrategicServe(
  ctx: MechanicsCtx,
  server: Athlete,
  directive: StrategicServeDirective,
  hooks: StrategicServeHooks,
): void {
  const capturedServer = server;
  const ref = Object.freeze({ ...directive.ref });
  if (
    ctx.servingTeam !== ref.side ||
    capturedServer.side !== ref.side ||
    capturedServer.index !== ref.serverAthleteId
  ) {
    return;
  }
  const side = ref.side;
  const serverIndex = ref.serverAthleteId;
  const capturedDirective = Object.freeze({
    ref,
    family: directive.family,
    target: Object.freeze({ x: directive.target.x, z: directive.target.z }),
  });
  const visual = STRATEGIC_SERVE_TUNING.families[capturedDirective.family].visual;

  if (!hooks.guard(ref, 'toss')) return;
  ctx.hooks.serveMeter(false);
  ctx.hooks.effects.showAim(null);
  capturedServer.act('serveToss', visual.tossDuration);
  const hand = capturedServer.reachPoint();
  ctx.ball.launch(
    new THREE.Vector3(hand.x, 1.15, hand.z),
    new THREE.Vector3(0, visual.tossVelocity, 0),
  );
  ctx.after(0.34, () => {
    if (!hooks.guard(ref, 'hit')) return;
    capturedServer.act('serveHit', visual.hitDuration);
  });
  ctx.after(0.42, () => {
    if (!hooks.guard(ref, 'hit')) return;
    const realization = realizeStrategicServe(ctx, side, capturedDirective);
    if (!hooks.onLaunched(ref, realization)) return;
    const target = new THREE.Vector3(realization.target.x, 0, realization.target.z);
    finishServe(ctx, side, serverIndex, realization.power, target, realization.clearance);
  });
}

export function aiServe(ctx: MechanicsCtx): void {
  const team = ctx.teamOf(ctx.servingTeam);
  const server = team.server();
  const power = ctx.random.ai.range(ctx.diff.servePower[0], ctx.diff.servePower[1]);
  const err = ctx.random.contact.chance(ctx.diff.serveError);
  const s = sideSign(otherSide(ctx.servingTeam)); // lado alvo
  let target: THREE.Vector3;
  let clearance: number;
  if (err) {
    if (ctx.random.contact.chance(0.5)) {
      target = new THREE.Vector3(
        s * ctx.random.contact.range(9.6, 11),
        0,
        ctx.random.contact.range(-4, 4),
      ); // fora, longa
      clearance = ctx.random.contact.range(0.3, 0.8);
    } else {
      target = new THREE.Vector3(
        s * ctx.random.contact.range(3.5, 7),
        0,
        ctx.random.contact.range(-3, 3),
      ); // na rede
      clearance = -ctx.random.contact.range(0.18, 0.5);
    }
  } else {
    target = new THREE.Vector3(
      s * ctx.random.ai.range(3.5, 8.4),
      0,
      ctx.random.ai.range(-3.9, 3.9),
    );
    clearance = lerp(1.3, 0.16, power) * ctx.random.contact.range(0.9, 1.1);
  }
  performServe(ctx, server, power, target, clearance);
}
