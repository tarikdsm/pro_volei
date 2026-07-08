import * as THREE from 'three';
import { BALL_RADIUS, GRAVITY, COURT } from '../core/constants';
import { positionAt, timeToHeight } from '../core/math3d';

// Bola com gomos (textura canvas), rastro luminoso e sombra projetada no chão.
export class Ball {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];

  pos = new THREE.Vector3(0, 1, 0);
  vel = new THREE.Vector3();
  inFlight = false;
  /** após o ponto, a bola quica no chão em vez de encerrar o rally */
  bouncy = false;
  private spin = new THREE.Vector3();

  constructor() {
    const tex = makeBallTexture();
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }),
    );
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

    // sombra "blob" no chão (mais legível p/ gameplay que sombra real)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS * 1.4, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.group.add(this.shadow);

    // rastro
    const trailGeo = new THREE.BufferGeometry();
    const maxPts = 26;
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
    const colors = new Float32Array(maxPts * 3);
    trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
  }

  /** lança a bola com velocidade v0 a partir de p0 */
  launch(p0: THREE.Vector3, v0: THREE.Vector3): void {
    this.pos.copy(p0);
    this.vel.copy(v0);
    this.inFlight = true;
    this.bouncy = false;
    this.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
  }

  hold(p: THREE.Vector3): void {
    this.inFlight = false;
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
  }

  step(dt: number): void {
    if (this.inFlight) {
      this.vel.y += GRAVITY * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.mesh.rotation.x += this.spin.x * dt;
      this.mesh.rotation.y += this.spin.y * dt;
      this.mesh.rotation.z += this.spin.z * dt;
      // quicando após o ponto
      if (this.bouncy && this.pos.y <= BALL_RADIUS && this.vel.y < 0) {
        this.pos.y = BALL_RADIUS;
        this.vel.y = -this.vel.y * 0.55;
        this.vel.x *= 0.82;
        this.vel.z *= 0.82;
        if (Math.abs(this.vel.y) < 0.8) this.vel.set(0, 0, 0);
      }
    }
    this.mesh.position.copy(this.pos);

    // sombra segue no chão, some se a bola sai muito da quadra
    this.shadow.position.set(this.pos.x, 0.012, this.pos.z);
    const inArea =
      Math.abs(this.pos.x) < COURT.halfLength + COURT.freeZone &&
      Math.abs(this.pos.z) < COURT.halfWidth + COURT.freeZone;
    this.shadow.visible = inArea && this.pos.y > 0.05;
    const scale = Math.max(0.4, 1.6 - this.pos.y * 0.12);
    this.shadow.scale.set(scale, scale, 1);

    // rastro
    if (this.inFlight && this.vel.length() > 6) {
      this.trailPts.push(this.pos.clone());
    } else if (this.trailPts.length) {
      this.trailPts.shift();
    }
    if (this.trailPts.length > 26) this.trailPts.shift();
    const posAttr = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.trail.geometry.attributes.color as THREE.BufferAttribute;
    const n = this.trailPts.length;
    for (let i = 0; i < 26; i++) {
      const p = this.trailPts[Math.min(i, n - 1)] ?? this.pos;
      posAttr.setXYZ(i, p.x, p.y, p.z);
      const a = n > 1 ? i / (n - 1) : 0;
      colAttr.setXYZ(i, a * 1.0, a * 0.85, a * 0.3);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, Math.max(2, n));
  }

  /** ponto e tempo previstos de queda ao nível do chão (analítico) */
  predictLanding(): { point: THREE.Vector3; time: number } {
    const t = timeToHeight(this.pos, this.vel, BALL_RADIUS);
    const point = new THREE.Vector3();
    if (t < 0) return { point: point.copy(this.pos).setY(0), time: 0 };
    positionAt(this.pos, this.vel, t, point);
    point.y = 0;
    return { point, time: t };
  }

  /** tempo até descer à altura h (para agendar contatos) */
  timeToDescend(h: number): number {
    return timeToHeight(this.pos, this.vel, h);
  }

  posAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    return positionAt(this.pos, this.vel, t, out);
  }
}

function makeBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  // padrão clássico azul/amarelo/branco em faixas
  const bands = ['#ffffff', '#ffd500', '#0057b8', '#ffffff', '#ffd500', '#0057b8'];
  const bw = 256 / bands.length;
  for (let i = 0; i < bands.length; i++) {
    c.fillStyle = bands[i];
    c.fillRect(i * bw, 0, bw + 1, 128);
  }
  // costuras
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = 2;
  for (let i = 1; i < bands.length; i++) {
    c.beginPath();
    c.moveTo(i * bw, 0);
    c.lineTo(i * bw, 128);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
