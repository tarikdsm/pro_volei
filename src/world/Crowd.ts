import * as THREE from 'three';
import { Arena } from './Arena';

// Torcida 2.0 (Fase 8): matrizes de instância ESTÁTICAS + animação inteira no vertex shader
// (pulo, esticada e ola) via atributos por instância e uniforms O(1). A CPU não recompõe
// matrizes nem reenvia buffers por frame — a torcida anima a todo frame em todos os tiers.
// Duas malhas instanciadas: corpo (cor de camisa) e cabeça (cor de pele).

/** Estado de "humor" da torcida — puro e testável. */
export interface CrowdMood {
  excitement: number;
  waveTimer: number;
  waveActive: boolean;
  wavePos: number;
}

export function initialCrowdMood(): CrowdMood {
  return { excitement: 0.25, waveTimer: 0, waveActive: false, wavePos: 0 };
}

/** Avança decaimento da empolgação e ciclo da ola espontânea (mesmas regras da v2.0.0). */
export function advanceCrowdMood(mood: CrowdMood, dt: number): CrowdMood {
  const excitement = Math.max(0.12, mood.excitement - dt * 0.12);
  let { waveTimer, waveActive, wavePos } = mood;
  waveTimer += dt;
  if (!waveActive && waveTimer > 25 && excitement > 0.5) {
    waveActive = true;
    wavePos = -Math.PI;
    waveTimer = 0;
  }
  if (waveActive) {
    wavePos += dt * 1.6;
    if (wavePos > Math.PI * 1.5) waveActive = false;
  }
  return { excitement, waveTimer, waveActive, wavePos };
}

export interface CrowdSpot {
  pos: { x: number; y: number; z: number };
  angle: number;
}

/** Sorteia assentos ocupados a partir das arquibancadas. Puro com `rand` injetado. */
export function computeCrowdSpots(
  stands: readonly {
    origin: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
    rows: number;
    cols: number;
  }[],
  emptySeatChance: number,
  rand: () => number,
): CrowdSpot[] {
  const spots: CrowdSpot[] = [];
  const pos = new THREE.Vector3();
  for (const s of stands) {
    for (let r = 0; r < s.rows; r += 1) {
      for (let c = 0; c < s.cols; c += 1) {
        if (rand() < emptySeatChance) continue;
        const t = c / (s.cols - 1) - 0.5;
        pos
          .copy(s.origin)
          .addScaledVector(s.right, t * s.cols * 0.75)
          .add(new THREE.Vector3(s.up.x * r, s.up.y * r + 0.55, s.up.z * r));
        const x = pos.x + (rand() - 0.5) * 0.18;
        const z = pos.z + (rand() - 0.5) * 0.18;
        spots.push({ pos: { x, y: pos.y, z }, angle: Math.atan2(z, x) });
      }
    }
  }
  return spots;
}

/** Uniforms compartilhados entre os materiais do corpo e da cabeça. */
interface CrowdUniforms {
  uTime: { value: number };
  uAmp: { value: number };
  uFreq: { value: number };
  uWavePos: { value: number };
  uWaveBoost: { value: number };
}

/** Injeta a deformação da torcida (pulo + esticada + ola) num material Lambert. */
function patchCrowdMaterial(material: THREE.MeshLambertMaterial, uniforms: CrowdUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float aPhase;',
          'attribute float aAngle;',
          'uniform float uTime;',
          'uniform float uAmp;',
          'uniform float uFreq;',
          'uniform float uWavePos;',
          'uniform float uWaveBoost;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '// pulo senoidal por pessoa + ola por setor (mesmas curvas do loop de CPU legado)',
          'float crowdBounce = max(0.0, sin(uTime * uFreq + aPhase)) * uAmp;',
          'float crowdDelta = abs(mod(aAngle - uWavePos + PI, PI2) - PI);',
          'crowdBounce += max(0.0, 0.5 - crowdDelta) * 1.3 * uWaveBoost;',
          'transformed.y *= 1.0 + crowdBounce * 0.5;',
          'transformed.y += crowdBounce;',
        ].join('\n'),
      );
  };
}

/** Geometria do corpo (camisa): tronco + ombros + braços. Base do assento em y = 0.
 *  Contagens de segmentos enxutas (Fase 8, §10.2): a torcida é instanciada ~1300× e vista de
 *  longe, então poucos segmentos mantêm o orçamento de triângulos móvel (≤250 mil) sem perda
 *  visível. */
function buildBodyGeometry(): THREE.BufferGeometry {
  const torso = new THREE.CylinderGeometry(0.15, 0.19, 0.5, 6);
  torso.translate(0, 0.27, 0);
  const shoulders = new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
  shoulders.translate(0, 0.5, 0);
  const armL = new THREE.CapsuleGeometry(0.042, 0.24, 2, 4);
  armL.rotateZ(0.42);
  armL.translate(0.2, 0.34, 0);
  const armR = new THREE.CapsuleGeometry(0.042, 0.24, 2, 4);
  armR.rotateZ(-0.42);
  armR.translate(-0.2, 0.34, 0);
  return mergeGeos([torso, shoulders, armL, armR]);
}

/** Geometria da cabeça (pele). */
function buildHeadGeometry(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.105, 6, 5);
  head.translate(0, 0.68, 0);
  return mergeGeos([head]);
}

export class Crowd {
  readonly group = new THREE.Group();
  /** 0..1 empolgação atual (decai sozinha) */
  excitement = 0.25;

  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;
  private readonly count: number;
  private mood = initialCrowdMood();
  private time = 0;
  private readonly uniforms: CrowdUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.06 },
    uFreq: { value: 2.2 },
    uWavePos: { value: 0 },
    uWaveBoost: { value: 0 },
  };

  constructor(arena: Arena, density = 1) {
    // Lotação máxima sempre; a densidade efetiva vira um prefixo via InstancedMesh.count
    // (tiers da 4E). O shuffle torna o prefixo um subconjunto uniforme.
    const spots = computeCrowdSpots(arena.standsInfo, 0.18, Math.random);
    for (let i = spots.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    this.count = spots.length;

    const phase = new Float32Array(this.count);
    const angle = new Float32Array(this.count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const skinPalette = [0xd6a77a, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5d4037];
    // Torcida "silenciada" (§6.1): tintas dessaturadas navy/teal/coral — o fundo nunca
    // contrasta mais que a quadra nem compete com a bola em voo.
    const shirtPalette = [
      0x27435e, 0x1c4a52, 0x8a4a3a, 0x4a5a68, 0x35586b, 0x6e4438, 0x3c4f5c, 0x52616d,
    ];

    const bodyGeo = buildBodyGeometry();
    const headGeo = buildHeadGeometry();
    const bodyMat = new THREE.MeshLambertMaterial();
    const headMat = new THREE.MeshLambertMaterial();
    patchCrowdMaterial(bodyMat, this.uniforms);
    patchCrowdMaterial(headMat, this.uniforms);
    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, this.count);
    this.headMesh = new THREE.InstancedMesh(headGeo, headMat, this.count);

    for (let i = 0; i < this.count; i += 1) {
      const s = spots[i];
      phase[i] = Math.random() * Math.PI * 2;
      angle[i] = s.angle;
      dummy.position.set(s.pos.x, s.pos.y, s.pos.z);
      // encara o centro da quadra + jitter, constante por pessoa
      dummy.rotation.y = Math.atan2(-s.pos.z, -s.pos.x) + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      const sc = 0.9 + Math.random() * 0.25;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      this.bodyMesh.setMatrixAt(i, dummy.matrix);
      this.headMesh.setMatrixAt(i, dummy.matrix);
      color.setHex(shirtPalette[Math.floor(Math.random() * shirtPalette.length)]);
      this.bodyMesh.setColorAt(i, color);
      color.setHex(skinPalette[Math.floor(Math.random() * skinPalette.length)]);
      this.headMesh.setColorAt(i, color);
    }
    for (const mesh of [this.bodyMesh, this.headMesh]) {
      mesh.instanceColor!.needsUpdate = true;
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.geometry.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angle, 1));
      mesh.count = this.visibleFor(density);
      this.group.add(mesh);
    }
  }

  private visibleFor(density: number): number {
    const clamped = Math.min(1, Math.max(0, density));
    return Math.max(1, Math.round(this.count * clamped));
  }

  /** Ajusta a densidade visível em runtime (tiers de qualidade, 4E). */
  setQuality(density: number): void {
    const visible = this.visibleFor(density);
    this.bodyMesh.count = visible;
    this.headMesh.count = visible;
  }

  /** dispara empolgação: 0.3 = toque legal, 1 = ponto/bloqueio espetacular */
  excite(amount: number): void {
    this.excitement = Math.min(1, Math.max(this.excitement, amount));
  }

  startWave(): void {
    if (!this.mood.waveActive) {
      this.mood = { ...this.mood, waveActive: true, wavePos: -Math.PI };
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.mood = advanceCrowdMood({ ...this.mood, excitement: this.excitement }, dt);
    this.excitement = this.mood.excitement;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uAmp.value = 0.06 + this.excitement * 0.3;
    this.uniforms.uFreq.value = 2.2 + this.excitement * 6;
    this.uniforms.uWavePos.value = this.mood.wavePos;
    this.uniforms.uWaveBoost.value = this.mood.waveActive ? 1 : 0;
  }
}

// merge simples de geometrias não-indexadas (posição + normal)
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
