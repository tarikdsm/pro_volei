// Malha skinned procedural da atleta (Fase 4A): segmentos low-poly por osso, mesclados em uma
// geometria por região de material. Skinning rígido (cada vértice 100% num osso) — o suficiente
// para poses/locomotion; pesos suaves podem evoluir na 4B sem mudar este contrato.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATHLETE_REST_POSE, type AthleteJointName } from './AthleteSkeleton';

export type BodyRegion = 'skin' | 'jersey' | 'shorts' | 'shoes' | 'hair';

export interface AthleteBodyPart {
  readonly region: BodyRegion;
  readonly geometry: THREE.BufferGeometry; // com skinIndex/skinWeight rígidos
}

export interface AthleteBodyOptions {
  readonly hairstyle: 'short' | 'long' | 'ponytail';
}

interface SegmentSpec {
  readonly region: BodyRegion;
  readonly bone: AthleteJointName;
  readonly geometry: THREE.BufferGeometry;
  /** Offset do centro do segmento em relação à origem do osso (espaço de mundo do rest pose). */
  readonly offset: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
  /** Rotação (rad) aplicada à geometria antes do offset (ex.: rabo de cavalo inclinado). */
  readonly rotationX?: number;
}

function capsule(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length, 3, 8);
}

function sphere(radius: number, w = 10, h = 8): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, w, h);
}

function box(x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x, y, z);
}

function mirrored(
  region: BodyRegion,
  boneL: AthleteJointName,
  boneR: AthleteJointName,
  make: () => THREE.BufferGeometry,
  offset: readonly [number, number, number],
  scale?: readonly [number, number, number],
): SegmentSpec[] {
  return [
    { region, bone: boneL, geometry: make(), offset, scale },
    { region, bone: boneR, geometry: make(), offset, scale },
  ];
}

function bodySegments(hairstyle: AthleteBodyOptions['hairstyle']): SegmentSpec[] {
  const specs: SegmentSpec[] = [
    // camisa: tronco + cintura + mangas curtas
    {
      region: 'jersey',
      bone: 'chest',
      geometry: capsule(0.135, 0.2),
      offset: [0, 0.03, 0],
      scale: [1, 1, 0.75],
    },
    {
      region: 'jersey',
      bone: 'spine',
      geometry: capsule(0.115, 0.1),
      offset: [0, 0.02, 0],
      scale: [1, 1, 0.8],
    },
    ...mirrored('jersey', 'upperArmL', 'upperArmR', () => capsule(0.048, 0.1), [0, -0.06, 0]),
    // pele: cabeça, pescoço, braços/antebraços/mãos, canelas
    { region: 'skin', bone: 'head', geometry: sphere(0.105, 12, 9), offset: [0, 0.02, 0] },
    { region: 'skin', bone: 'neck', geometry: capsule(0.04, 0.06), offset: [0, 0.05, 0] },
    ...mirrored('skin', 'upperArmL', 'upperArmR', () => capsule(0.04, 0.14), [0, -0.19, 0]),
    ...mirrored('skin', 'forearmL', 'forearmR', () => capsule(0.036, 0.2), [0, -0.12, 0]),
    ...mirrored('skin', 'handL', 'handR', () => sphere(0.042, 8, 6), [0, -0.02, 0]),
    ...mirrored('skin', 'shinL', 'shinR', () => capsule(0.05, 0.36), [0, -0.22, 0]),
    // shorts: quadril + coxas
    {
      region: 'shorts',
      bone: 'hips',
      geometry: capsule(0.125, 0.1),
      offset: [0, -0.01, 0],
      scale: [1, 1, 0.85],
    },
    ...mirrored('shorts', 'thighL', 'thighR', () => capsule(0.062, 0.3), [0, -0.17, 0]),
    // tênis
    ...mirrored('shoes', 'footL', 'footR', () => box(0.09, 0.07, 0.22), [0, -0.035, 0.05]),
    // cabelo: cap sempre; variações por estilo
    { region: 'hair', bone: 'head', geometry: sphere(0.11, 10, 8), offset: [0, 0.045, -0.01] },
  ];
  if (hairstyle === 'long') {
    specs.push({
      region: 'hair',
      bone: 'head',
      geometry: box(0.16, 0.22, 0.05),
      offset: [0, -0.06, -0.1],
    });
  } else if (hairstyle === 'ponytail') {
    specs.push({
      region: 'hair',
      bone: 'head',
      geometry: capsule(0.035, 0.22),
      offset: [0, -0.02, -0.16],
      rotationX: -0.55,
    });
  }
  return specs;
}

/** Aplica transformações + atributos de skinning rígido a um segmento, no espaço de bind. */
function prepareSegment(spec: SegmentSpec, boneIndex: number): THREE.BufferGeometry {
  const geometry = spec.geometry;
  if (spec.scale) geometry.scale(spec.scale[0], spec.scale[1], spec.scale[2]);
  if (spec.rotationX) geometry.rotateX(spec.rotationX);
  const rest = ATHLETE_REST_POSE[spec.bone];
  geometry.translate(rest[0] + spec.offset[0], rest[1] + spec.offset[1], rest[2] + spec.offset[2]);
  const count = geometry.getAttribute('position').count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    indices[i * 4] = boneIndex;
    weights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

/** Monta as geometrias skinned da atleta, uma por região de material (5 draw calls no corpo). */
export function buildAthleteBodyParts(
  boneIndex: Readonly<Record<AthleteJointName, number>>,
  options: AthleteBodyOptions,
): readonly AthleteBodyPart[] {
  const byRegion = new Map<BodyRegion, THREE.BufferGeometry[]>();
  for (const spec of bodySegments(options.hairstyle)) {
    const prepared = prepareSegment(spec, boneIndex[spec.bone]);
    const list = byRegion.get(spec.region) ?? [];
    list.push(prepared);
    byRegion.set(spec.region, list);
  }
  const parts: AthleteBodyPart[] = [];
  for (const [region, geometries] of byRegion) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error(`falha ao mesclar a região ${region}`);
    for (const geometry of geometries) geometry.dispose();
    parts.push({ region, geometry: merged });
  }
  return parts;
}
