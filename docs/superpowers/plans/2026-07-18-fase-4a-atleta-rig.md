# Fase 4A — Prova de Atleta com Rig — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o humanoide de caixas por uma atleta com esqueleto real
(`THREE.Bone`/`SkinnedMesh`) construída proceduralmente em código, provando silhueta, poses e
orçamento de render antes de produzir elenco (4C) e locomotion/IK (4B).

**Architecture:** Direção aprovada pelo proprietário em 18/07/2026: **rig procedural em código**
(sem GLB/Blender nesta etapa; o contrato `CharVisual` isola uma futura troca de malha).
`AthleteSkeleton` (ossos + mapa de juntas) e `buildAthleteBodyGeometry` (malha skinned por
segmentos rígidos) são módulos puros testáveis em Node; `RiggedCharacter implements CharVisual`
porta as 12 poses paramétricas atuais para espaço de osso com o mesmo damping, e entra no jogo
pela `CharFactory` existente sem tocar em `game/`. Decals de camisa (canvas) ficam injetáveis
para o construtor rodar headless.

**Tech Stack:** Three.js r185 (`Bone`, `Skeleton`, `SkinnedMesh`, `CapsuleGeometry`), TypeScript
strict, Vitest (Node) — sem dependências novas, sem assets, sem loader assíncrono.

## Global Constraints

- Zero URLs remotas e zero assets de runtime nesta subfase; tudo procedural em código.
- `game/` intocado: a troca acontece só em `entities/` + default da `CharFactory`
  (`Team.ts`/`Athlete`) e `meshCastsShadow`. Contrato `CharVisual` (`root`, `moveSpeed`,
  `jumpY`, `setAction`, `update`, `presentJump?`) preservado byte a byte.
- As 12 `CharAction` continuam funcionando: `idle | run | bump | set | spikeWindup | spikeHit |
  block | serveToss | serveHit | dive | celebrate | dejected`.
- Animação é apresentação pura: avança somente pelo `dt` recebido (pausa/câmera lenta seguem
  funcionando); nada de `Date.now`/`Math.random`.
- Orçamentos §10.2 como guarda: cena em rally ≤ 250 draw calls desktop / ≤ 500 mil triângulos
  desktop; a atleta rigada deve **reduzir** draw calls por atleta vs o humanoide atual
  (vários meshes → ≤ 7 por atleta) e ficar ≤ 4.500 triângulos por atleta.
- Baseline de comparação: `docs/perf/baseline-latest.json` (514,9 draw calls / 111 mil
  triângulos de cena). Regenerar via `tests/e2e/performance.spec.ts` ao final e comparar.
- Identidade §5.2: silhueta feminina legível, `CharLook` (jersey/shorts/skin/hair/hairstyle/
  number/name) continua respeitado, Elisa/Heloisa/Isabela reconhecíveis pelos looks atuais.
- Prettier/ESLint 100 colunas; comentários pt-BR; main-only com commits atômicos e
  `npm run check` antes do push.

---

### Task 1: `AthleteSkeleton` — esqueleto procedural puro

**Files:**
- Create: `src/entities/rig/AthleteSkeleton.ts`
- Test: `src/entities/rig/AthleteSkeleton.test.ts`

**Interfaces:**
- Consumes: `THREE.Bone`, `THREE.Skeleton`.
- Produces (usadas nas Tasks 2 e 3):

```ts
export type AthleteJointName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'upperArmL' | 'forearmL' | 'handL'
  | 'shoulderR' | 'upperArmR' | 'forearmR' | 'handR'
  | 'thighL' | 'shinL' | 'footL'
  | 'thighR' | 'shinR' | 'footR';

export interface AthleteSkeletonRig {
  readonly rootBone: THREE.Bone; // hips
  readonly skeleton: THREE.Skeleton;
  readonly joints: Readonly<Record<AthleteJointName, THREE.Bone>>;
  readonly boneIndex: Readonly<Record<AthleteJointName, number>>; // índice no skeleton.bones
}

export function buildAthleteSkeleton(): AthleteSkeletonRig;
```

**Pose de descanso (posições LOCAIS de cada osso, em metros; +z = frente, +y = cima):**

| Osso | Pai | Posição local (x, y, z) |
|---|---|---|
| hips | — (root) | (0, 0.95, 0) |
| spine | hips | (0, 0.14, 0) |
| chest | spine | (0, 0.18, 0) |
| neck | chest | (0, 0.17, 0) |
| head | neck | (0, 0.10, 0) |
| shoulderL | chest | (0.20, 0.12, 0) |
| upperArmL | shoulderL | (0.05, 0, 0) |
| forearmL | upperArmL | (0, −0.26, 0) |
| handL | forearmL | (0, −0.24, 0) |
| shoulderR/upperArmR/forearmR/handR | idem espelhado | x negado |
| thighL | hips | (0.10, −0.02, 0) |
| shinL | thighL | (0, −0.42, 0) |
| footL | shinL | (0, −0.44, 0.04) |
| thighR/shinR/footR | idem espelhado | x negado |

19 ossos. Braços descansam ao longo do corpo (rotação zero = braço para baixo, seguindo o eixo
−y do osso); pernas retas para baixo. Altura total ≈ 1,78 m (compatível com `PLAYER.height`
1,88 com cabeça/cabelo).

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { buildAthleteSkeleton } from './AthleteSkeleton';

describe('buildAthleteSkeleton', () => {
  it('monta 19 ossos com hierarquia e índices consistentes', () => {
    const rig = buildAthleteSkeleton();
    expect(rig.skeleton.bones).toHaveLength(19);
    expect(rig.joints.hips).toBe(rig.rootBone);
    expect(rig.joints.shinL.parent).toBe(rig.joints.thighL);
    expect(rig.joints.forearmR.parent).toBe(rig.joints.upperArmR);
    expect(rig.joints.head.parent).toBe(rig.joints.neck);
    for (const [name, bone] of Object.entries(rig.joints)) {
      expect(rig.skeleton.bones[rig.boneIndex[name as keyof typeof rig.boneIndex]]).toBe(bone);
    }
  });

  it('é simétrico em x e alcança altura de cabeça ~1,54 m no rest pose', () => {
    const rig = buildAthleteSkeleton();
    rig.rootBone.updateMatrixWorld(true);
    const world = (bone: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    expect(world(rig.joints.thighL).x).toBeCloseTo(-world(rig.joints.thighR).x, 6);
    expect(world(rig.joints.handL).x).toBeCloseTo(-world(rig.joints.handR).x, 6);
    expect(world(rig.joints.head).y).toBeCloseTo(1.54, 2);
    expect(world(rig.joints.footL).y).toBeCloseTo(0.07, 2);
  });

  it('duas construções são independentes (sem estado compartilhado)', () => {
    const a = buildAthleteSkeleton();
    const b = buildAthleteSkeleton();
    a.joints.head.rotation.x = 1;
    expect(b.joints.head.rotation.x).toBe(0);
  });
});
```

(Importar `* as THREE from 'three'` no teste.)

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/entities/rig/AthleteSkeleton.test.ts`
- [ ] **Step 3: Implementar** `buildAthleteSkeleton` com a tabela acima: criar cada `THREE.Bone`,
      `add` no pai, montar `joints`/`boneIndex` na ordem da tabela e `new THREE.Skeleton(bones)`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git add src/entities/rig && git commit -m "feat(render): esqueleto procedural da atleta"`

---

### Task 2: Malha skinned procedural por segmentos

**Files:**
- Create: `src/entities/rig/AthleteBodyGeometry.ts`
- Test: `src/entities/rig/AthleteBodyGeometry.test.ts`

**Interfaces:**
- Consumes: `AthleteJointName`, `buildAthleteSkeleton` (índices de osso).
- Produces:

```ts
export type BodyRegion = 'skin' | 'jersey' | 'shorts' | 'shoes' | 'hair';

export interface AthleteBodyPart {
  readonly region: BodyRegion;
  readonly geometry: THREE.BufferGeometry; // com skinIndex/skinWeight rígidos
}

export interface AthleteBodyOptions {
  readonly hairstyle: 'short' | 'long' | 'ponytail';
}

export function buildAthleteBodyParts(
  boneIndex: Readonly<Record<AthleteJointName, number>>,
  options: AthleteBodyOptions,
): readonly AthleteBodyPart[];
```

**Segmentos (skinning rígido — cada vértice 100% em um osso):** cada segmento é uma
`CapsuleGeometry`/`SphereGeometry`/`BoxGeometry` low-poly transladada para a posição do membro
no espaço do osso e mesclada por região com `mergeGeometries` (de
`three/examples/jsm/utils/BufferGeometryUtils.js`):

| Região | Segmentos (osso → primitiva aproximada) |
|---|---|
| jersey | chest → capsule r0.13 l0.24 achatada (scale z 0.72); spine → capsule r0.115 l0.10; upperArmL/R → capsule r0.045 l0.10 (manga) |
| skin | head → sphere r0.105 (12×9); neck → capsule r0.04 l0.06; forearmL/R → capsule r0.036 l0.20; handL/R → sphere r0.042; shinL/R → capsule r0.05 l0.36; upperArmL/R (braço abaixo da manga) → capsule r0.04 l0.14 |
| shorts | hips → capsule r0.125 l0.10 achatada; thighL/R → capsule r0.062 l0.30 |
| shoes | footL/R → box 0.09×0.07×0.22 (deslocado +z 0.05) |
| hair | head → cap sphere r0.11; long: box 0.16×0.22×0.05 atrás; ponytail: capsule r0.035 l0.22 inclinada |

Uma única geometria mesclada por região (5 geometrias no total). `setAttribute('skinIndex',
Uint16BufferAttribute)` e `skinWeight` `[1,0,0,0]` por vértice do segmento, apontando o índice
do osso dono. Orçamento: total ≤ 4.500 triângulos (asserção no teste).

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { buildAthleteSkeleton } from './AthleteSkeleton';
import { buildAthleteBodyParts } from './AthleteBodyGeometry';

describe('buildAthleteBodyParts', () => {
  const rig = buildAthleteSkeleton();

  it('produz as cinco regiões com skinning rígido válido', () => {
    const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: 'ponytail' });
    expect(parts.map((part) => part.region).sort()).toEqual([
      'hair',
      'jersey',
      'shoes',
      'shorts',
      'skin',
    ]);
    for (const part of parts) {
      const skinIndex = part.geometry.getAttribute('skinIndex');
      const skinWeight = part.geometry.getAttribute('skinWeight');
      const position = part.geometry.getAttribute('position');
      expect(skinIndex.count).toBe(position.count);
      expect(skinWeight.count).toBe(position.count);
      for (let i = 0; i < position.count; i += 1) {
        expect(skinWeight.getX(i)).toBe(1); // rígido: 100% num osso
        expect(skinIndex.getX(i)).toBeGreaterThanOrEqual(0);
        expect(skinIndex.getX(i)).toBeLessThan(19);
      }
    }
  });

  it('fica dentro do orçamento de triângulos por atleta', () => {
    const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: 'long' });
    const triangles = parts.reduce((sum, part) => {
      const index = part.geometry.getIndex();
      const count = index ? index.count : part.geometry.getAttribute('position').count;
      return sum + count / 3;
    }, 0);
    expect(triangles).toBeGreaterThan(500); // sanidade: não é um placeholder vazio
    expect(triangles).toBeLessThanOrEqual(4500);
  });

  it.each(['short', 'long', 'ponytail'] as const)('%s tem geometria de cabelo própria', (h) => {
    const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: h });
    const hair = parts.find((part) => part.region === 'hair')!;
    expect(hair.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** com a tabela de segmentos (helper interno
      `segment(boneName, geometry, offset)` que aplica `translate`, cria `skinIndex/skinWeight`
      rígidos e acumula por região; mesclar com `mergeGeometries`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(render): malha skinned procedural por regioes`

---

### Task 3: `RiggedCharacter implements CharVisual`

**Files:**
- Create: `src/entities/rig/RiggedCharacter.ts`
- Create: `src/entities/rig/athletePoses.ts` (porta das 12 poses paramétricas para juntas)
- Test: `src/entities/rig/RiggedCharacter.test.ts`

**Interfaces:**
- Consumes: `CharVisual`, `CharAction`, `CharLook`, `meshCastsShadow` (de
  `../PlayerCharacter`), Tasks 1–2.
- Produces:

```ts
export interface RiggedCharacterOptions {
  /** Injeta a fábrica de decal (número/nome). Default: canvas no browser; null = sem decal. */
  readonly decalTexture?: ((look: CharLook) => THREE.Texture) | null;
}

export class RiggedCharacter implements CharVisual {
  readonly root: THREE.Group;
  moveSpeed: number;
  jumpY: number;
  constructor(look: CharLook, options?: RiggedCharacterOptions);
  setAction(action: CharAction): void;
  update(dt: number): void;
  presentJump(jumpY: number): void;
}

export const createRiggedCharacter: CharFactory; // (look) => new RiggedCharacter(look)
```

**Comportamento:**
- Constrói o rig (Task 1) + 5 `SkinnedMesh` (Task 2) com materiais por região a partir do
  `CharLook` (`MeshStandardMaterial` com as mesmas roughness do humanoide atual; sapatos
  `0xf5f5f5`). `root` contém `body` (Group com `rootBone` + meshes); `presentJump` move
  `body.position.y` como hoje.
- `athletePoses.ts`: `poseFor(action, actionTime, runPhase): AthletePose` — porta fiel das 12
  poses de `PlayerCharacter.update` (mesmos ângulos por junta, mesmos `ease01`), agora com tipos
  `AthletePose = Partial<Record<AthleteJointName, { x?: number; y?: number; z?: number }>>`.
- `update(dt)`: mesmo damping `1 − exp(−16·dt)` aplicado às rotações das juntas; `runPhase`
  avança como hoje; determinístico e sem DOM.
- Decal do número: um `PlaneGeometry` com `MeshBasicMaterial` (não projeta sombra —
  `meshCastsShadow` continua válido) preso ao osso `chest`, só quando `decalTexture` existir.
- `castShadow` via `root.traverse` + `meshCastsShadow` (mesma regra atual).

- [ ] **Step 1: Testes que falham**

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RiggedCharacter } from './RiggedCharacter';
import type { CharAction } from '../PlayerCharacter';

const LOOK = { jersey: 0x1565e8, shorts: 0x0c2f6b, skin: 0xe8b98a, hair: 0xa87848, number: 7, hairstyle: 'ponytail' as const };

describe('RiggedCharacter', () => {
  it('constrói headless (sem DOM) com decal desligado', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    expect(char.root).toBeInstanceOf(THREE.Group);
    let skinned = 0;
    char.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1;
    });
    expect(skinned).toBe(5);
  });

  it('cumpre o contrato CharVisual: ações, update determinístico e presentJump', () => {
    const a = new RiggedCharacter(LOOK, { decalTexture: null });
    const b = new RiggedCharacter(LOOK, { decalTexture: null });
    const actions: CharAction[] = ['idle', 'run', 'bump', 'set', 'spikeWindup', 'spikeHit', 'block', 'serveToss', 'serveHit', 'dive', 'celebrate', 'dejected'];
    for (const action of actions) {
      a.setAction(action);
      b.setAction(action);
      a.update(1 / 60);
      b.update(1 / 60);
    }
    const rotations = (c: RiggedCharacter) => {
      const out: number[] = [];
      c.root.traverse((o) => {
        if ((o as THREE.Bone).isBone) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
      });
      return out;
    };
    expect(rotations(b)).toEqual(rotations(a)); // mesmo input ⇒ mesma pose (determinístico)
    a.presentJump(0.8);
    const body = a.root.children[0] as THREE.Group;
    expect(body.position.y).toBeCloseTo(0.8, 6);
  });

  it('poses distintas movem juntas distintas (spikeWindup arma o braço de ataque)', () => {
    const idle = new RiggedCharacter(LOOK, { decalTexture: null });
    const spike = new RiggedCharacter(LOOK, { decalTexture: null });
    idle.setAction('idle');
    spike.setAction('spikeWindup');
    for (let i = 0; i < 30; i += 1) {
      idle.update(1 / 60);
      spike.update(1 / 60);
    }
    const armOf = (c: RiggedCharacter) => {
      let rotation = 0;
      c.root.traverse((o) => {
        if ((o as THREE.Bone).isBone && o.name === 'upperArmR') rotation = o.rotation.x;
      });
      return rotation;
    };
    expect(Math.abs(armOf(spike) - armOf(idle))).toBeGreaterThan(0.5);
  });
});
```

(Os ossos recebem `name = jointName` na Task 1 — adicionar essa linha lá se faltar.)

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `athletePoses.ts` (porta 1:1 dos ângulos do `switch` de
      `PlayerCharacter.update`, traduzindo `lSh/rSh/lEl/rEl/lHip/rHip/lKnee/rKnee/torso/head`
      para as juntas novas) e `RiggedCharacter`.
- [ ] **Step 4: Rodar e ver passar** + `npx vitest run src/entities` inteiro.
- [ ] **Step 5: Commit** — `feat(render): RiggedCharacter com poses em espaço de osso`

---

### Task 4: Integração — a atleta rigada vira o default do jogo

**Files:**
- Modify: `src/game/Team.ts` (default da `CharFactory` no construtor de `Athlete`)
- Modify: `src/entities/PlayerCharacter.ts` apenas se necessário para exports compartilhados
- Test: suíte existente (contratos `CharVisual` já cobertos) + `src/entities/PlayerCharacter.test.ts` intacto

**Interfaces:**
- Consumes: `createRiggedCharacter` (Task 3).
- Produces: default `makeChar = (l) => createRiggedCharacter(l)`; headless (`HeadlessCharacter`)
  continua injetado pelos testes/runner como hoje.

- [ ] **Step 1:** Trocar o default em `Athlete` (`Team.ts:34`):
      `makeChar: CharFactory = (l) => createRiggedCharacter(l)` (import de `../entities/rig/RiggedCharacter`).
- [ ] **Step 2:** `npx vitest run` inteiro — nenhum teste pode depender do humanoide legado como
      default (se depender, o teste injeta a fábrica explicitamente; corrigir a fixture, não a regra).
- [ ] **Step 3:** `npm run build` — o build de produção compila com o rig.
- [ ] **Step 4: Commit** — `feat(render): atleta rigada como personagem padrao`

---

### Task 5: Orçamento e prova visual

**Files:**
- Modify: `docs/perf/baseline-latest.json` (regenerado pelo harness)
- Evidência: screenshots via skill playtest

- [ ] **Step 1: Perf harness** — rodar `npm run test:e2e:smoke:prod` e o
      `tests/e2e/performance.spec.ts`; registrar draw calls/triângulos da cena nova vs baseline
      (514,9 dc / 111 mil tri). Gate: draw calls da cena **não aumentam** (espera-se queda — 5-6
      meshes/atleta vs ~20 do humanoide antigo) e triângulos ≤ 250 mil.
- [ ] **Step 2: Playtest real** (skill playtest, porta 5199): partida Normal/formato 2.0,
      rally completo; screenshots de idle/corrida/ataque; silhueta, uniforme, número e cabelo
      legíveis na câmera broadcast; console limpo.
- [ ] **Step 3:** Se o visual regredir em legibilidade (bola/atleta selecionada), ajustar
      proporções/materiais antes de seguir — critério §6.1 (leitura acima de tudo).

---

### Task 6: Gates finais, docs e push

- [ ] **Step 1:** `npm run check` completo verde.
- [ ] **Step 2:** Docs: `docs/ROADMAP.md` (bullet 4A concluída + evidências), plans README
      (linha 4A), `docs/ARCHITECTURE.md` (entities/ agora descreve o rig), `CHANGELOG.md`,
      `CLAUDE.md` (marco atual → 4B).
- [ ] **Step 3:** Commits atômicos + push; acompanhar CI/Pages e smoke público como na 3D.

---

## Self-Review

1. **Cobertura da spec (4A):** prova de um atleta/rig (Tasks 1–3), dentro do orçamento (Task 5 +
   asserção de triângulos na Task 2), publicável (Tasks 4–6). IK/blend tree ficam para a 4B por
   definição da fase; elenco/variantes para a 4C; a porta fiel das poses garante zero regressão
   de gameplay feel.
2. **Placeholders:** dimensões, hierarquia e segmentos estão em tabelas executáveis; testes com
   código completo. O único código extenso não listado integralmente é a porta dos ângulos das
   12 poses — a fonte exata é o `switch` de `PlayerCharacter.update` (arquivo no repo), o que é
   uma referência precisa, não um TBD.
3. **Consistência de tipos:** `AthleteJointName`/`boneIndex` (Task 1) usados nas Tasks 2–3;
   `CharVisual`/`CharFactory`/`CharAction` reusados de `PlayerCharacter.ts` sem redefinição;
   `createRiggedCharacter` consumido na Task 4.
