// Mecânica do saque: execução do saque (física + efeitos) e escolha de saque da IA.
// Funções livres sobre o MechanicsCtx, extraídas de Match.ts.
import * as THREE from 'three';
import { COURT, otherSide, sideSign } from '../../core/constants';
import { serveDrive, rand, chance, lerp } from '../../core/math3d';
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
    ctx.hooks.audio.hitHard();
    ctx.startRally();
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
  const power = rand(ctx.diff.servePower[0], ctx.diff.servePower[1]);
  const err = chance(ctx.diff.serveError);
  const s = sideSign(otherSide(ctx.servingTeam)); // lado alvo
  let target: THREE.Vector3;
  let clearance: number;
  if (err) {
    if (chance(0.5)) {
      target = new THREE.Vector3(s * rand(9.6, 11), 0, rand(-4, 4)); // fora, longa
      clearance = rand(0.3, 0.8);
    } else {
      target = new THREE.Vector3(s * rand(3.5, 7), 0, rand(-3, 3)); // na rede
      clearance = -rand(0.18, 0.5);
    }
  } else {
    target = new THREE.Vector3(s * rand(3.5, 8.4), 0, rand(-3.9, 3.9));
    clearance = lerp(1.3, 0.16, power) * rand(0.9, 1.1);
  }
  performServe(ctx, server, power, target, clearance);
}
