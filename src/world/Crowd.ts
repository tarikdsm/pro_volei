import * as THREE from 'three';
import { Arena } from './Arena';

// Torcida instanciada (~1500 pessoas) com animação de pulo, ola e intensidade reativa ao jogo.
export class Crowd {
  mesh: THREE.InstancedMesh;
  private count: number;
  private basePos: Float32Array;
  private phase: Float32Array;
  private sectionAngle: Float32Array; // p/ ola (posição angular ao redor da arena)
  private dummy = new THREE.Object3D();
  private time = 0;
  /** 0..1 empolgação atual (decai sozinha) */
  excitement = 0.25;
  private waveTimer = 0;
  private waveActive = false;
  private wavePos = 0;

  constructor(arena: Arena, density = 1) {
    // geometria de um torcedor: corpo + cabeça fundidos manualmente
    const body = new THREE.CylinderGeometry(0.16, 0.2, 0.55, 6);
    body.translate(0, 0.28, 0);
    const head = new THREE.SphereGeometry(0.11, 6, 5);
    head.translate(0, 0.68, 0);
    const geo = mergeGeos([body, head]);

    const emptySeatChance = 1 - 0.82 * density;
    const spots: { pos: THREE.Vector3; angle: number }[] = [];
    for (const s of arena.standsInfo) {
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          if (Math.random() < emptySeatChance) continue; // assentos vazios
          const t = c / (s.cols - 1) - 0.5;
          const pos = s.origin
            .clone()
            .addScaledVector(s.right, t * s.cols * 0.75)
            .add(new THREE.Vector3(s.up.x * r, s.up.y * r + 0.55, s.up.z * r));
          pos.x += (Math.random() - 0.5) * 0.18;
          pos.z += (Math.random() - 0.5) * 0.18;
          spots.push({ pos, angle: Math.atan2(pos.z, pos.x) });
        }
      }
    }

    this.count = spots.length;
    const mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.basePos = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    this.sectionAngle = new Float32Array(this.count);

    const palette = [0xd6a77a, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5d4037];
    const shirt = [0x1565e8, 0xe53935, 0xffe14f, 0xffffff, 0x37474f, 0x7cb342, 0xff8a65, 0x9575cd];
    const color = new THREE.Color();

    for (let i = 0; i < this.count; i++) {
      const s = spots[i];
      this.basePos[i * 3] = s.pos.x;
      this.basePos[i * 3 + 1] = s.pos.y;
      this.basePos[i * 3 + 2] = s.pos.z;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.sectionAngle[i] = s.angle;
      this.dummy.position.copy(s.pos);
      this.dummy.rotation.y =
        Math.atan2(-s.pos.z, -s.pos.x) + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      const sc = 0.9 + Math.random() * 0.25;
      this.dummy.scale.set(sc, sc, sc);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      // mistura cor de camisa (corpo domina visualmente)
      color.setHex(
        Math.random() < 0.75
          ? shirt[Math.floor(Math.random() * shirt.length)]
          : palette[Math.floor(Math.random() * palette.length)],
      );
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** dispara empolgação: 0.3 = toque legal, 1 = ponto/bloqueio espetacular */
  excite(amount: number): void {
    this.excitement = Math.min(1, Math.max(this.excitement, amount));
  }

  startWave(): void {
    if (!this.waveActive) {
      this.waveActive = true;
      this.wavePos = -Math.PI;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.excitement = Math.max(0.12, this.excitement - dt * 0.12);

    // ola espontânea de vez em quando se o jogo está animado
    this.waveTimer += dt;
    if (!this.waveActive && this.waveTimer > 25 && this.excitement > 0.5) {
      this.startWave();
      this.waveTimer = 0;
    }
    if (this.waveActive) {
      this.wavePos += dt * 1.6;
      if (this.wavePos > Math.PI * 1.5) this.waveActive = false;
    }

    const amp = 0.06 + this.excitement * 0.3;
    const freq = 2.2 + this.excitement * 6;
    const t = this.time;

    for (let i = 0; i < this.count; i++) {
      const bx = this.basePos[i * 3],
        by = this.basePos[i * 3 + 1],
        bz = this.basePos[i * 3 + 2];
      let bounce = Math.max(0, Math.sin(t * freq + this.phase[i])) * amp;
      if (this.waveActive) {
        const d = Math.abs(angDiff(this.sectionAngle[i], this.wavePos));
        if (d < 0.5) bounce += (0.5 - d) * 1.3; // braços pra cima = pessoa "estica"
      }
      this.dummy.position.set(bx, by + bounce, bz);
      this.dummy.rotation.y = Math.atan2(-bz, -bx) + Math.PI / 2;
      const stretch = 1 + bounce * 0.5;
      this.dummy.scale.set(1, stretch, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// merge simples de geometrias não-indexadas
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geos.map((g) => g.toNonIndexed());
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    norm.set(g.attributes.normal.array as Float32Array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}
