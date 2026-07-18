import * as THREE from 'three';
import { TIMING_FEEDBACK } from '../core/constants';
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';

// Partículas de impacto, confete, anel de previsão de queda e marcador de mira.
export class Effects {
  group = new THREE.Group();
  private particles: Particle[] = [];
  private pool: THREE.Points;
  private poolPos: THREE.BufferAttribute;
  private poolCol: THREE.BufferAttribute;
  private readonly MAX = 400;

  // anel de previsão de queda (ajuda de gameplay)
  landingRing: THREE.Mesh;
  // marcador de mira (saque/ataque)
  aimMarker: THREE.Mesh;
  private ringPulse = 0;
  timingGlyph: THREE.LineSegments;
  private timingGlyphPos: THREE.BufferAttribute;
  private timingCueAge = 0;
  private timingCueDuration = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.poolPos = new THREE.BufferAttribute(new Float32Array(this.MAX * 3), 3);
    this.poolCol = new THREE.BufferAttribute(new Float32Array(this.MAX * 3), 3);
    geo.setAttribute('position', this.poolPos);
    geo.setAttribute('color', this.poolCol);
    this.pool = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.09,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.pool.frustumCulled = false;
    this.group.add(this.pool);

    this.landingRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffe14f,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.landingRing.rotation.x = -Math.PI / 2;
    this.landingRing.visible = false;
    this.group.add(this.landingRing);

    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.34, 4),
      new THREE.MeshBasicMaterial({
        color: 0x66e0ff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.aimMarker.rotation.x = -Math.PI / 2;
    this.aimMarker.rotation.z = Math.PI / 4;
    this.aimMarker.visible = false;
    this.group.add(this.aimMarker);

    const timingGeometry = new THREE.BufferGeometry();
    this.timingGlyphPos = new THREE.BufferAttribute(new Float32Array(128 * 3), 3);
    timingGeometry.setAttribute('position', this.timingGlyphPos);
    timingGeometry.setDrawRange(0, 0);
    this.timingGlyph = new THREE.LineSegments(
      timingGeometry,
      new THREE.LineBasicMaterial({
        color: TIMING_FEEDBACK.colors.perfect,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.timingGlyph.visible = false;
    this.timingGlyph.renderOrder = 20;
    this.group.add(this.timingGlyph);
  }

  /** Escala de partículas por tier de qualidade (Fase 4E): 0,5 no baixo, 1 nos demais. */
  particleScale = 1;

  burst(at: THREE.Vector3, color: number, count = 18, speed = 4): void {
    const col = new THREE.Color(color);
    const scaled = Math.max(1, Math.round(count * this.particleScale));
    for (let i = 0; i < scaled; i++) {
      if (this.particles.length >= this.MAX) break;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.15;
      this.particles.push({
        pos: at.clone(),
        vel: new THREE.Vector3(
          Math.cos(a) * speed * Math.random(),
          up * speed,
          Math.sin(a) * speed * Math.random(),
        ),
        life: 0.55 + Math.random() * 0.3,
        age: 0,
        color: col,
        gravity: -9,
      });
    }
  }

  confetti(centerX: number): void {
    const colors = [0xffd54f, 0x4fc3f7, 0xef5350, 0x66bb6a, 0xba68c8];
    const scaled = Math.max(1, Math.round(160 * this.particleScale));
    for (let i = 0; i < scaled; i++) {
      if (this.particles.length >= this.MAX) break;
      this.particles.push({
        pos: new THREE.Vector3(
          centerX + (Math.random() - 0.5) * 12,
          9 + Math.random() * 5,
          (Math.random() - 0.5) * 10,
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          -0.5 - Math.random(),
          (Math.random() - 0.5) * 1.5,
        ),
        life: 4 + Math.random() * 2,
        age: 0,
        color: new THREE.Color(colors[i % colors.length]),
        gravity: -1.2,
      });
    }
  }

  showLanding(point: THREE.Vector3 | null): void {
    if (!point) {
      this.landingRing.visible = false;
      return;
    }
    this.landingRing.visible = true;
    this.landingRing.position.set(point.x, 0.015, point.z);
  }

  showAim(point: THREE.Vector3 | null): void {
    if (!point) {
      this.aimMarker.visible = false;
      return;
    }
    this.aimMarker.visible = true;
    this.aimMarker.position.set(point.x, 0.02, point.z);
  }

  timingCue(event: Readonly<TimingFeedbackEvent>): void {
    this.writeTimingShape(event.tier);
    this.timingGlyph.position.set(event.position.x, event.position.y, event.position.z);
    this.timingGlyph.scale.setScalar(1);
    const material = this.timingGlyph.material as THREE.LineBasicMaterial;
    material.color.setHex(TIMING_FEEDBACK.colors[event.tier]);
    material.opacity = 1;
    this.timingCueAge = 0;
    this.timingCueDuration = TIMING_FEEDBACK.visualDuration[event.tier];
    this.timingGlyph.visible = true;
  }

  update(dt: number): void {
    this.ringPulse += dt * 5;
    if (this.landingRing.visible) {
      const s = 1 + Math.sin(this.ringPulse) * 0.18;
      this.landingRing.scale.set(s, s, 1);
    }
    if (this.aimMarker.visible) {
      this.aimMarker.rotation.z += dt * 1.5;
    }
    if (this.timingGlyph.visible) {
      this.timingCueAge += dt;
      const progress = Math.min(1, this.timingCueAge / this.timingCueDuration);
      (this.timingGlyph.material as THREE.LineBasicMaterial).opacity = 1 - progress;
      this.timingGlyph.scale.setScalar(1 + progress * 0.42);
      if (progress >= 1) this.timingGlyph.visible = false;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        // swap-remove O(1): a partícula da cauda já foi processada neste frame reverso
        const last = this.particles.length - 1;
        this.particles[i] = this.particles[last];
        this.particles.pop();
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        p.vel.y *= -0.3;
        p.vel.x *= 0.9;
        p.vel.z *= 0.9;
      }
    }
    const n = this.particles.length;
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const fade = 1 - p.age / p.life;
      this.poolPos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      this.poolCol.setXYZ(i, p.color.r * fade, p.color.g * fade, p.color.b * fade);
    }
    // só re-envia os buffers à GPU quando há partículas vivas (evita upload ocioso todo frame)
    if (n > 0) {
      this.poolPos.needsUpdate = true;
      this.poolCol.needsUpdate = true;
    }
    // setDrawRange fica fora do guard: zera o range no frame em que as partículas somem
    this.pool.geometry.setDrawRange(0, n);
  }

  private writeTimingShape(tier: TimingFeedbackEvent['tier']): void {
    let vertex = 0;
    const segment = (x1: number, z1: number, x2: number, z2: number): void => {
      this.timingGlyphPos.setXYZ(vertex++, x1, 0, z1);
      this.timingGlyphPos.setXYZ(vertex++, x2, 0, z2);
    };
    const arc = (radius: number, start: number, length: number, segments: number): void => {
      for (let index = 0; index < segments; index++) {
        const a = start + (length * index) / segments;
        const b = start + (length * (index + 1)) / segments;
        segment(
          Math.cos(a) * radius,
          Math.sin(a) * radius,
          Math.cos(b) * radius,
          Math.sin(b) * radius,
        );
      }
    };

    if (tier === 'perfect') {
      arc(0.32, 0, Math.PI * 2, 24);
      arc(0.5, 0, Math.PI * 2, 24);
    } else if (tier === 'good') {
      const radius = 0.48;
      segment(0, -radius, radius, 0);
      segment(radius, 0, 0, radius);
      segment(0, radius, -radius, 0);
      segment(-radius, 0, 0, -radius);
    } else {
      arc(0.46, Math.PI * 0.12, Math.PI * 0.7, 8);
      arc(0.46, Math.PI * 1.12, Math.PI * 0.7, 8);
    }

    this.timingGlyphPos.needsUpdate = true;
    this.timingGlyph.geometry.setDrawRange(0, vertex);
  }
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  age: number;
  color: THREE.Color;
  gravity: number;
}
