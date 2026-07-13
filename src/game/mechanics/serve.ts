// Mecânica do saque: execução do saque (física + efeitos) e escolha de saque da IA.
// Funções livres sobre o MechanicsCtx, extraídas de Match.ts.
import * as THREE from 'three';
import { COURT, otherSide, sideSign } from '../../core/constants';
import { serveDrive, lerp } from '../../core/math3d';
import { Athlete } from '../Team';
import type { MechanicsCtx } from './context';

export function performServe(
  ctx: MechanicsCtx,
  server: Athlete,
  power: number,
  target: THREE.Vector3,
  clearance: number,
): void {
  ctx.hooks.serveMeter(false);
  ctx.hooks.effects.showAim(null);
  server.act('serveToss', 0.5);
  const hand = server.reachPoint();
  ctx.ball.launch(new THREE.Vector3(hand.x, 1.15, hand.z), new THREE.Vector3(0, 5.6, 0));
  ctx.after(0.34, () => server.act('serveHit', 0.5));
  ctx.after(0.42, () => {
    const p0 = ctx.ball.pos.clone();
    // trajetória resolvida pela folga sobre a rede: força alta = raspando, baixa = flutuante
    const { v0 } = serveDrive(p0, target, COURT.netHeight + clearance);
    ctx.ball.launch(p0, v0);
    ctx.startRally();
    ctx.emitTelemetry({
      type: 'serve',
      side: ctx.servingTeam,
      athlete: server.index,
      power,
      target: { x: target.x, y: target.y, z: target.z },
      clearance,
    });
    ctx.hooks.audio.hitHard();
    ctx.rally.lastTouchTeam = ctx.servingTeam;
    ctx.rally.lastKind = 'serve';
    ctx.rally.possessionTeam = ctx.servingTeam;
    ctx.rally.possessionTouches = 0;
    ctx.hooks.camera.setMode('rally');
    ctx.planNext('pass');
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
