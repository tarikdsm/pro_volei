# Fase 8 — Polimento Visual e Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar o nível visual do jogo (animações, atletas, cabelo, quadra, torcida) e garantir 60 fps mínimos com um contador de FPS elegante no canto superior esquerdo.

**Architecture:** Tudo é apresentação pura — nenhuma mudança de física ou regra (as baterias de balanceamento são gates de regressão e devem permanecer verdes). A torcida migra da animação por CPU (recompor matrizes + reupload de buffer) para deformação em vertex shader com atributos por instância (custo por frame ≈ zero, animação a todo frame). As poses paramétricas ganham anticipação/overshoot; o rig ganha rastreio de bola pela cabeça, osso de cabelo com pêndulo e novas ações (saque por baixo, aterrissagem). Quadra ganha textura taraflex procedural e environment map procedural (RoomEnvironment) por tier.

**Tech Stack:** Three.js r185 (WebGL), TypeScript strict, Vitest 4 (Node p/ lógica pura), Vite 8.

## Global Constraints

- **Zero mudança de física/gameplay.** `BalanceBattery.test.ts` (1.000 rallies/20 seeds e 30 partidas/10 seeds, formato 11·11·7) roda no `npm run test` e deve permanecer verde. Se uma bateria quebrar, a mudança está errada — reverta-a, não ajuste a bateria.
- **Determinismo por dt:** código de animação/apresentação NUNCA usa `performance.now()`, `Date.now()` ou `Math.random()` por frame. `Math.random()` só é aceitável em construção única (padrão já existente na torcida).
- **Zero alocação por frame** em caminhos quentes (update/present): reutilize vetores/quaternions temporários como membros da classe (padrão `tmpA/tmpB/tmpC/tmpQ` do `RiggedCharacter`).
- **Orçamentos (§10.2):** draw calls em rally ≤ 250; triângulos ≤ 250 mil (alvo mobile); bundle principal ≤ 250 kB gzip.
- **Fronteiras:** código em `src/game/` não toca DOM/teclado/câmera; `Match` fala com UI/áudio/efeitos via interface `Hooks`. `CharAction`/`CharVisual` são o único canal jogo→visual das atletas.
- **Assets 100% locais/proceduais.** Zero URLs remotas em runtime. `RoomEnvironment` (three/examples) é procedural e local — permitido.
- **Idioma:** comentários e termos de domínio em pt-BR (saque, cortada, manchete, bloqueio, rodízio).
- **Git:** fluxo main-only, commits pequenos e atômicos direto em `main`, NUNCA amend/force-push. Antes de cada commit: `npm run check` (workflow + typecheck + lint + format:check + cobertura). Mensagens no padrão do histórico (`feat(render): …`, `perf(torcida): …`).
- **Node ≥ 20.19** (`.nvmrc` fixa a 22). Prettier decide formatação; rode `npm run format` se o `format:check` reclamar.
- **NÃO** adicionar `failIfMajorPerformanceCaveat: true` ao renderer — o CI roda WebGL por software (SwiftShader) e isso derrubaria o smoke de produção.
- Dev server de teste manual: porta **5199** com `--strictPort` (a 5173 colide com outro projeto do usuário): `npx vite --port 5199 --strictPort`.

## File Structure (mapa da fase)

| Arquivo | Papel nesta fase |
|---|---|
| `src/main.ts` | Modify: powerPreference, FPS wiring, environment map, tipo de sombra, `crowd.group` |
| `src/core/quality/FpsMeter.ts` (+test) | Create: medidor de FPS puro (janela de 0,5 s) |
| `src/core/quality/QualityManager.ts` (+test) | Modify: limiar de descida de tier vira ~55 fps (alvo 60) |
| `src/ui/HUD.ts` + `src/style.css` | Modify: chip de FPS no canto superior esquerdo |
| `src/world/Crowd.ts` (+test) | Rewrite: torcida GPU (shader), duas tonalidades, geometria detalhada |
| `src/core/constants.ts` | Modify: remover `crowdTickHz` dos tiers, constante do saque por baixo |
| `src/entities/rig/athletePoses.ts` (+test novo) | Modify: easings novos, poses com anticipação/overshoot, poses novas |
| `src/entities/PlayerCharacter.ts` | Modify: `CharAction` +2 ações, `setLookTarget` opcional no contrato |
| `src/game/mechanics/serve.ts` | Modify: escolha visual do saque por baixo (humano, carga baixa) |
| `src/game/Team.ts` | Modify: ação `land` ao aterrissar, `lookAtPoint` |
| `src/game/Match.ts` | Modify: alimenta o olhar das atletas com a posição da bola no `present` |
| `src/entities/rig/AthleteSkeleton.ts` (+test) | Modify: osso 20 `hairTail` (filho de `head`) |
| `src/entities/rig/AthleteBodyGeometry.ts` (+test) | Modify: penteados 2.0 (rabo/trança/longo/coque) skinned no `hairTail` |
| `src/entities/rig/RiggedCharacter.ts` (+test) | Modify: head tracking com clamp + pêndulo do cabelo |
| `src/world/Court.ts` | Modify: textura taraflex procedural em canvas |
| `docs/ROADMAP.md`, `CHANGELOG.md`, `docs/superpowers/plans/README.md` | Modify: registrar a Fase 8 |

---

### Task 1: Renderer em alto desempenho (`powerPreference`)

Força o browser a escolher a GPU dedicada / melhor perfil 3D do dispositivo.

**Files:**
- Modify: `src/main.ts:110-127`

**Interfaces:**
- Consumes: nada.
- Produces: nada novo — só opções do `THREE.WebGLRenderer`.

- [x] **Step 1: Editar as opções do renderer**

Em `src/main.ts`, localize (linha ~113):

```ts
  renderer = new THREE.WebGLRenderer({ antialias: true });
```

Substitua por:

```ts
  // powerPreference força o browser a usar a GPU de alto desempenho (notebooks com GPU dupla).
  // NÃO usar failIfMajorPerformanceCaveat: o CI roda WebGL por software e o smoke quebraria.
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
```

- [x] **Step 2: Verificar gates**

Run: `npm run typecheck` — Expected: sem erros.
Run: `npm run test` — Expected: todos verdes (nada de lógica mudou).

- [x] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "perf(render): forca powerPreference high-performance no WebGLRenderer"
```

---

### Task 2: FpsMeter puro + chip de FPS no HUD

Contador pequeno e elegante no canto superior esquerdo, atualizado 2×/s, com cor por faixa.

**Files:**
- Create: `src/core/quality/FpsMeter.ts`
- Test: `src/core/quality/FpsMeter.test.ts`
- Modify: `src/ui/HUD.ts` (elemento + método `setFps`)
- Modify: `src/style.css` (estilo do chip)
- Modify: `src/main.ts` (instancia e alimenta no loop)

**Interfaces:**
- Produces: `class FpsMeter { constructor(windowSeconds?: number); sample(dtSeconds: number): number | null; get value(): number | null; reset(): void }` e `HUD.setFps(fps: number | null): void`.
- Consumes: `visualDt` já calculado no loop de `src/main.ts` (linha ~686).

- [x] **Step 1: Escrever o teste que falha**

Create `src/core/quality/FpsMeter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FpsMeter } from './FpsMeter';

describe('FpsMeter', () => {
  it('fecha a janela de 0,5 s e reporta o fps arredondado', () => {
    const meter = new FpsMeter(0.5);
    expect(meter.value).toBeNull();
    let reported: number | null = null;
    for (let i = 0; i < 30; i += 1) reported = meter.sample(1 / 60);
    expect(reported).toBe(60);
    expect(meter.value).toBe(60);
  });

  it('reporta fps baixo quando os frames demoram', () => {
    const meter = new FpsMeter(0.5);
    let reported: number | null = null;
    for (let i = 0; i < 15; i += 1) reported = meter.sample(1 / 30);
    expect(reported).toBe(30);
  });

  it('ignora dt não positivo sem quebrar a janela', () => {
    const meter = new FpsMeter(0.5);
    meter.sample(0);
    meter.sample(-1);
    expect(meter.value).toBeNull();
    for (let i = 0; i < 30; i += 1) meter.sample(1 / 60);
    expect(meter.value).toBe(60);
  });

  it('reset limpa a janela e o valor', () => {
    const meter = new FpsMeter(0.5);
    for (let i = 0; i < 30; i += 1) meter.sample(1 / 60);
    meter.reset();
    expect(meter.value).toBeNull();
  });
});
```

- [x] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/core/quality/FpsMeter.test.ts`
Expected: FAIL — "Cannot find module './FpsMeter'".

- [x] **Step 3: Implementar o FpsMeter**

Create `src/core/quality/FpsMeter.ts`:

```ts
// Medidor de FPS de apresentação: acumula frames numa janela curta e reporta a média
// arredondada ao fechá-la. Puro e determinístico — avança somente pelo dt recebido.
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  private smoothed: number | null = null;

  constructor(private readonly windowSeconds = 0.5) {}

  get value(): number | null {
    return this.smoothed;
  }

  /** Registra um frame; devolve o fps vigente (null antes da primeira janela fechar). */
  sample(dtSeconds: number): number | null {
    if (!(dtSeconds > 0)) return this.smoothed;
    this.frames += 1;
    this.elapsed += dtSeconds;
    if (this.elapsed >= this.windowSeconds) {
      this.smoothed = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
    }
    return this.smoothed;
  }

  reset(): void {
    this.frames = 0;
    this.elapsed = 0;
    this.smoothed = null;
  }
}
```

- [x] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/core/quality/FpsMeter.test.ts`
Expected: PASS (4 testes).

- [x] **Step 5: Adicionar o chip ao HUD**

Em `src/ui/HUD.ts`, no template `this.root.innerHTML` (linha ~29), adicione como PRIMEIRA linha interna (antes de `<div id="scoreboard">`):

```html
      <div id="fps" aria-hidden="true"></div>
```

Adicione o campo e o método na classe `HUD` (perto de `setScale`):

```ts
  private fpsEl!: HTMLElement;
  private lastFpsText = '';
```

No fim do construtor (junto dos outros `querySelector`):

```ts
    this.fpsEl = this.root.querySelector('#fps')!;
```

Novo método (depois de `setScale`):

```ts
  /** Chip discreto de FPS (canto superior esquerdo). null = janela ainda aberta, mantém o texto. */
  setFps(fps: number | null): void {
    if (fps === null) return;
    const text = `${fps} FPS`;
    if (text === this.lastFpsText) return;
    this.lastFpsText = text;
    this.fpsEl.textContent = text;
    this.fpsEl.classList.toggle('warn', fps < 55 && fps >= 30);
    this.fpsEl.classList.toggle('bad', fps < 30);
  }
```

- [x] **Step 6: Estilo do chip**

Em `src/style.css`, adicione ao fim (ajuste os nomes das variáveis de safe-area se o arquivo usar outros — procure `--safe-area-top` no CSS existente e siga o padrão do projeto):

```css
/* Chip de FPS — discreto, canto superior esquerdo, fora do caminho do placar. */
#fps {
  position: fixed;
  top: calc(8px + var(--safe-area-top, 0px));
  left: calc(10px + var(--safe-area-left, 0px));
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(8, 14, 22, 0.55);
  color: #9fd8d2;
  font: 600 11px/1 system-ui, 'Segoe UI', sans-serif;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 5;
}
#fps:empty {
  display: none;
}
#fps.warn {
  color: #ffd54f;
}
#fps.bad {
  color: #ff8a65;
}
```

- [x] **Step 7: Alimentar no loop**

Em `src/main.ts`:

Import (junto do import do QualityManager):

```ts
import { FpsMeter } from './core/quality/FpsMeter';
```

Instância (perto de `const quality = new QualityManager(...)`):

```ts
const fpsMeter = new FpsMeter();
```

Dentro de `function frame(now)`, logo após o cálculo de `visualDt` (linha ~686):

```ts
  hud.setFps(fpsMeter.sample(visualDt));
```

NÃO adicionar `#fps` a `cameraOverlaySelectors` — o chip é minúsculo e no canto; incluí-lo encolheria o safe frame da câmera sem necessidade.

- [x] **Step 8: Gates + commit**

Run: `npm run check` — Expected: tudo verde.

```bash
git add src/core/quality/FpsMeter.ts src/core/quality/FpsMeter.test.ts src/ui/HUD.ts src/style.css src/main.ts
git commit -m "feat(hud): chip de FPS com FpsMeter puro no canto superior esquerdo"
```

---

### Task 3: QualityManager mira 60 fps

Hoje o tier só desce quando o p95 fica pior que 30 fps. Para "60 fps sempre", o gatilho de descida passa a ~55 fps sustentado.

**Files:**
- Modify: `src/core/quality/QualityManager.ts:7`
- Test: `src/core/quality/QualityManager.test.ts`

**Interfaces:**
- Consumes/Produces: nenhuma mudança de API — só a constante `P95_DOWN_SECONDS`.

- [ ] **Step 1: Escrever o teste que falha**

Abra `src/core/quality/QualityManager.test.ts`, leia como os testes existentes preenchem a janela (eles chamam `sampleFrame` ≥ 90 vezes e `evaluateAtBreak`). Adicione:

```ts
  it('desce de tier com p95 sustentado pior que ~55 fps (alvo 60 fps sempre)', () => {
    const q = new QualityManager(2);
    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < 180; i += 1) q.sampleFrame(0.02); // 50 fps constante
      q.evaluateAtBreak();
    }
    expect(q.tier).toBe(1);
  });
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/core/quality/QualityManager.test.ts`
Expected: FAIL — com o limiar antigo (0.0333), 20 ms não dispara descida e `tier` continua 2.

- [ ] **Step 3: Ajustar o limiar**

Em `src/core/quality/QualityManager.ts`, linha 7, troque:

```ts
const P95_DOWN_SECONDS = 0.0333; // pior que 30 fps sustentado ⇒ candidata a descer
```

por:

```ts
const P95_DOWN_SECONDS = 0.0182; // pior que ~55 fps sustentado ⇒ candidata a descer (alvo: 60 fps sempre)
```

- [ ] **Step 4: Rodar a suíte do arquivo**

Run: `npx vitest run src/core/quality/QualityManager.test.ts`
Expected: PASS. Se algum teste antigo usava frames entre 18,2 ms e 33,3 ms como "neutros", ajuste o dt desse teste para a faixa neutra nova (entre 0.012 e 0.0182), mantendo a intenção do teste.

- [ ] **Step 5: Gates + commit**

Run: `npm run check`

```bash
git add src/core/quality/QualityManager.ts src/core/quality/QualityManager.test.ts
git commit -m "perf(quality): tier desce quando p95 fica pior que ~55 fps (alvo 60)"
```

---

### Task 4: Torcida 2.0 — animação em GPU, duas tonalidades e mais detalhe

Reescreve `Crowd`: matrizes de instância ESTÁTICAS, animação (pulo + ola + esticada) 100% no vertex shader via atributos por instância e uniforms O(1) por frame. Ganhos: elimina o loop de CPU e o reupload do buffer (perf), e a torcida anima a TODO frame em todos os tiers (fluidez). Detalhe: torcedor com tronco + braços + cabeça, cabeça em malha separada com cor de pele própria (hoje a cabeça é tingida pela cor da camisa).

**Files:**
- Rewrite: `src/world/Crowd.ts`
- Test: `src/world/Crowd.test.ts` (substitui os testes de `advanceCrowdTick`)
- Modify: `src/main.ts` (usa `crowd.group`; `setQuality(density)`)
- Modify: `src/core/constants.ts` (remove `crowdTickHz` dos tiers e `tickHz/tickHzLow/idleFreezeBelow` de `CROWD`)

**Interfaces:**
- Produces:
  - `class Crowd { constructor(arena: Arena, density?: number); group: THREE.Group; excitement: number; excite(amount: number): void; startWave(): void; update(dt: number): void; setQuality(density: number): void }`
  - Puros/testáveis: `interface CrowdMood { excitement: number; waveTimer: number; waveActive: boolean; wavePos: number }`, `initialCrowdMood(): CrowdMood`, `advanceCrowdMood(mood: CrowdMood, dt: number): CrowdMood`, `computeCrowdSpots(stands, emptySeatChance, rand): { pos: {x,y,z}; angle: number }[]`.
- Consumes: `Arena.standsInfo` (origin/right/up/rows/cols — ver `src/world/Arena.ts:8-14`).
- **Quem chama `crowd.mesh` hoje:** apenas `src/main.ts:139` (`scene.add(..., crowd.mesh, ...)`) e `applyQualityTier` (`crowd.setQuality(q.crowdDensity, q.crowdTickHz)` na linha ~155). Confirme com `rg "crowd\." src` antes de mexer.

- [ ] **Step 1: Escrever os testes que falham**

Substitua o conteúdo de `src/world/Crowd.test.ts` por:

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceCrowdMood, computeCrowdSpots, initialCrowdMood } from './Crowd';

describe('advanceCrowdMood', () => {
  it('a empolgação decai até o piso 0.12', () => {
    let mood = { ...initialCrowdMood(), excitement: 0.5 };
    for (let i = 0; i < 600; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.excitement).toBeCloseTo(0.12, 5);
  });

  it('dispara a ola espontânea após 25 s de jogo animado e a percorre até o fim', () => {
    let mood = { ...initialCrowdMood(), excitement: 1 };
    for (let i = 0; i < 26 * 60; i += 1) {
      mood = advanceCrowdMood(mood, 1 / 60);
      mood = { ...mood, excitement: 1 }; // jogo segue animado
    }
    expect(mood.waveActive).toBe(true);
    for (let i = 0; i < 10 * 60; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.waveActive).toBe(false);
  });

  it('não dispara ola com a torcida fria', () => {
    let mood = { ...initialCrowdMood(), excitement: 0.2 };
    for (let i = 0; i < 30 * 60; i += 1) mood = advanceCrowdMood(mood, 1 / 60);
    expect(mood.waveActive).toBe(false);
  });
});

describe('computeCrowdSpots', () => {
  const stands = [
    {
      origin: new THREE.Vector3(0, 0, 10),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 0.55, 0.9),
      rows: 3,
      cols: 8,
    },
  ];

  it('é determinístico com o rand injetado e respeita assentos vazios', () => {
    let n = 0;
    const rand = () => {
      n = (n * 16807 + 1) % 2147483647;
      return (n % 1000) / 1000;
    };
    const spots = computeCrowdSpots(stands, 0.18, rand);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThan(3 * 8);
    for (const s of spots) {
      expect(Number.isFinite(s.pos.x)).toBe(true);
      expect(Number.isFinite(s.angle)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/world/Crowd.test.ts`
Expected: FAIL — `advanceCrowdMood`/`computeCrowdSpots` não existem.

- [ ] **Step 3: Reescrever `src/world/Crowd.ts`**

Substitua o arquivo inteiro por:

```ts
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

/** Geometria do corpo (camisa): tronco + ombros + braços. Base do assento em y = 0. */
function buildBodyGeometry(): THREE.BufferGeometry {
  const torso = new THREE.CylinderGeometry(0.15, 0.19, 0.5, 8);
  torso.translate(0, 0.27, 0);
  const shoulders = new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  shoulders.translate(0, 0.5, 0);
  const armL = new THREE.CapsuleGeometry(0.042, 0.24, 2, 6);
  armL.rotateZ(0.42);
  armL.translate(0.2, 0.34, 0);
  const armR = new THREE.CapsuleGeometry(0.042, 0.24, 2, 6);
  armR.rotateZ(-0.42);
  armR.translate(-0.2, 0.34, 0);
  return mergeGeos([torso, shoulders, armL, armR]);
}

/** Geometria da cabeça (pele). */
function buildHeadGeometry(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.105, 8, 6);
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
```

- [ ] **Step 4: Rodar os testes novos**

Run: `npx vitest run src/world/Crowd.test.ts`
Expected: PASS.

- [ ] **Step 5: Atualizar `src/main.ts` e `src/core/constants.ts`**

Em `src/main.ts`:
- Linha ~139: troque `crowd.mesh` por `crowd.group` no `scene.add(...)`.
- Em `applyQualityTier` (linha ~155): troque `crowd.setQuality(q.crowdDensity, q.crowdTickHz);` por `crowd.setQuality(q.crowdDensity);`.

Em `src/core/constants.ts`:
- Remova o campo `crowdTickHz` das três entradas de `QUALITY_TIERS` (linhas ~392-410).
- Substitua o bloco `CROWD` (linhas ~412-422) e o comentário acima dele por:

```ts
// Torcida instanciada (~1300 pessoas). A animação (pulo/ola) roda no vertex shader com
// atributos por instância (Fase 8) — custo de CPU por frame O(1), sem reupload de buffer.
export const CROWD = {
  density: 1, // fração de assentos ocupados no desktop
  densityLow: 0.55, // fração de assentos ocupados no celular
};
```

Depois rode `rg "crowdTickHz|tickHzLow|idleFreezeBelow|advanceCrowdTick|crowd\.mesh" src` e corrija QUALQUER referência restante (testes de constants, etc.) removendo o campo/uso — o grep deve terminar sem resultados.

- [ ] **Step 6: Suíte completa + build**

Run: `npm run test` — Expected: verde (inclusive baterias de balanceamento — a torcida não toca a simulação).
Run: `npm run build` — Expected: sucesso, bundle ≤ 250 kB gzip (o log do Vite mostra o gzip).

- [ ] **Step 7: Verificação visual**

Use a skill `playtest` do projeto (porta 5199). Verifique: torcida pulando suavemente (sem "steps" de 12–20 Hz), cabeças com tons de pele distintos das camisas, ola percorrendo a arena após um ponto espetacular, zero erros de console. Com `?debug`, no console: `__renderer.info.render.calls` durante um rally deve ficar ≤ 250 (a torcida adiciona 1 draw call: eram 1, viraram 2).

- [ ] **Step 8: Commit**

```bash
git add src/world/Crowd.ts src/world/Crowd.test.ts src/main.ts src/core/constants.ts
git commit -m "perf(torcida): anima no vertex shader com cabecas em tom de pele proprio"
```

---

### Task 5: Poses 2.0 — anticipação, overshoot e follow-through

Reescreve as curvas das poses de jogada em `athletePoses.ts` para dar "snap" às animações: recuo curto (anticipação) → disparo com overshoot (easeOutBack) → acomodação. Os valores FINAIS de cada pose ficam próximos dos atuais (o IK de contato e a leitura das jogadas não mudam).

**Files:**
- Modify: `src/entities/rig/athletePoses.ts`
- Test: `src/entities/rig/athletePoses.test.ts` (novo)

**Interfaces:**
- Consumes: `CharAction` de `../PlayerCharacter`, `LocomotionState` de `./locomotion` (inalterados).
- Produces: mesma API — `poseFor(action, t, runPhase, idleClock, phaseSeed): AthletePose` e `locomotionPose(state, runPhase): AthletePose`. Novos helpers internos exportados para teste: `easeOutBack(t: number, s?: number): number` e `phase(t: number, start: number, end: number): number`.

- [ ] **Step 1: Escrever os testes que falham**

Create `src/entities/rig/athletePoses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { easeOutBack, phase, poseFor } from './athletePoses';
import type { CharAction } from '../PlayerCharacter';

const ACTIONS: CharAction[] = [
  'idle',
  'run',
  'bump',
  'set',
  'spikeWindup',
  'spikeHit',
  'block',
  'serveToss',
  'serveHit',
  'dive',
  'celebrate',
  'dejected',
];

describe('easings', () => {
  it('phase normaliza e clampa o intervalo', () => {
    expect(phase(0.1, 0.2, 0.4)).toBe(0);
    expect(phase(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(phase(0.9, 0.2, 0.4)).toBe(1);
  });

  it('easeOutBack passa do alvo no meio e termina em 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.02) peak = Math.max(peak, easeOutBack(t));
    expect(peak).toBeGreaterThan(1); // overshoot existe
    expect(peak).toBeLessThan(1.25); // e é contido
  });
});

describe('poseFor', () => {
  it('todas as ações produzem valores finitos em toda a duração', () => {
    for (const action of ACTIONS) {
      for (let t = 0; t <= 1.2; t += 0.05) {
        const p = poseFor(action, t, 1.3, 2.1, 0.7);
        for (const [k, v] of Object.entries(p)) {
          expect(Number.isFinite(v), `${action}.${k}@${t}`).toBe(true);
        }
      }
    }
  });

  it('manchete tem anticipação: o tronco recua antes de estender', () => {
    const early = poseFor('bump', 0.04, 0, 0, 0);
    const late = poseFor('bump', 0.4, 0, 0, 0);
    expect(early.lShX).toBeLessThan(late.lShX);
    expect(late.lShX).toBeGreaterThan(0.9); // extensão final próxima da pose 2.0.0 (1.05)
  });

  it('cortada chicoteia com overshoot e acomoda perto do valor final', () => {
    let peak = -Infinity;
    for (let t = 0; t <= 0.5; t += 0.01) peak = Math.max(peak, poseFor('spikeHit', t, 0, 0, 0).rShX);
    const settled = poseFor('spikeHit', 0.5, 0, 0, 0).rShX;
    expect(peak).toBeGreaterThan(settled); // passou do alvo e voltou
    expect(settled).toBeGreaterThan(0.7);
    expect(settled).toBeLessThan(1.3);
  });

  it('bloqueio sobe rápido: braços quase estendidos em 150 ms', () => {
    expect(poseFor('block', 0.15, 0, 0, 0).lShX).toBeGreaterThan(2.4);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/entities/rig/athletePoses.test.ts`
Expected: FAIL — `easeOutBack`/`phase` não são exportados.

- [ ] **Step 3: Implementar easings e reescrever as poses de jogada**

Em `src/entities/rig/athletePoses.ts`, logo após `ease01` (linha ~97), adicione:

```ts
/** Normaliza t no intervalo [start, end] com clamp em [0, 1]. */
export function phase(t: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** Ease com overshoot contido (snap de jogada): passa do alvo e acomoda. */
export function easeOutBack(t: number, s = 1.4): number {
  const x = Math.min(1, Math.max(0, t));
  const c = s + 1;
  return 1 + c * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
}
```

Substitua os cases `bump`, `set`, `spikeHit`, `block` e `serveToss` do `switch` em `poseFor` por:

```ts
    case 'bump': {
      // manchete: dip curto (anticipação) e extensão com leve overshoot
      const dip = ease01(phase(t, 0, 0.07) * 3);
      const ext = easeOutBack(phase(t, 0.05, 0.24), 1.2);
      p.torsoPitch = 0.12 * dip + 0.4 * ext;
      p.hips = 0.5 + 0.12 * dip - 0.06 * ext;
      p.knees = -0.8 - 0.2 * dip + 0.1 * ext;
      p.lShX = 0.3 * dip + 0.78 * ext;
      p.rShX = 0.3 * dip + 0.78 * ext;
      p.lShZ = -0.25 * ext;
      p.rShZ = 0.25 * ext;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'set': {
      // toque: mãos sobem acima da testa e os cotovelos "estalam" no release
      const rise = easeOutBack(phase(t, 0, 0.18), 1.1);
      const flick = ease01(phase(t, 0.2, 0.38) * 2);
      p.torsoPitch = -0.08 * rise;
      p.hips = 0.25 + 0.08 * (1 - rise);
      p.knees = -0.4 - 0.15 * (1 - rise);
      p.lShX = 2.6 * rise;
      p.rShX = 2.6 * rise;
      p.lShZ = -0.4 * rise;
      p.rShZ = 0.4 * rise;
      p.lElX = -0.85 * rise + 0.35 * flick;
      p.rElX = -0.85 * rise + 0.35 * flick;
      break;
    }
    case 'spikeHit': {
      // chicotada: whip com overshoot + crunch do tronco e recolhida das pernas
      const whip = easeOutBack(phase(t, 0, 0.14), 1.7);
      p.torsoPitch = 0.42 * whip;
      p.torsoYaw = 0.28 * whip;
      p.rShX = -2.4 + 3.4 * whip;
      p.rElX = -0.15;
      p.lShX = 0.6;
      p.lElX = -0.5;
      p.lKneeX = -0.5 - 0.25 * whip;
      p.rKneeX = -0.5 - 0.25 * whip;
      break;
    }
    case 'block': {
      // braços disparam retos para cima com leve overshoot e pressão à frente
      const rise = easeOutBack(phase(t, 0, 0.13), 1.3);
      p.torsoPitch = 0.02 + 0.05 * rise;
      p.lShX = 2.95 * rise;
      p.rShX = 2.95 * rise;
      p.lShZ = -0.18;
      p.rShZ = 0.18;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'serveToss': {
      // lançamento com carga nas pernas (anticipação do saque por cima)
      const k = ease01(t * 4);
      const load = ease01(phase(t, 0, 0.2) * 2);
      p.torsoPitch = -0.1;
      p.hips = 0.12 + 0.18 * load;
      p.knees = -0.2 - 0.3 * load;
      p.lShX = 2.6 * k; // braço esquerdo lança a bola
      p.lElX = -0.2;
      p.rShX = -1.9 * k; // direito armado atrás
      p.rElX = -1.1 * k;
      break;
    }
```

Os demais cases (`idle`, `run`, `spikeWindup`, `serveHit`, `dive`, `celebrate`, `dejected`) permanecem como estão.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/entities/rig/athletePoses.test.ts src/entities/rig/RiggedCharacter.test.ts`
Expected: PASS. Se `RiggedCharacter.test.ts` asserta valores numéricos derivados das poses antigas, atualize APENAS os números esperados para os novos alvos (a intenção do teste não muda). Não afrouxe tolerâncias além do necessário.

- [ ] **Step 5: Gates + commit**

Run: `npm run check`

```bash
git add src/entities/rig/athletePoses.ts src/entities/rig/athletePoses.test.ts src/entities/rig/RiggedCharacter.test.ts
git commit -m "feat(anim): poses de jogada com anticipacao, overshoot e follow-through"
```

---

### Task 6: Novas ações — saque por baixo e aterrissagem

Duas ações visuais novas: `serveUnderhand` (saque por baixo quando o humano saca com carga baixa) e `land` (agachamento de absorção ao aterrissar de cortada/bloqueio). Só apresentação: a trajetória da bola e o resultado do saque continuam decididos por `finishServe` exatamente como hoje.

**Files:**
- Modify: `src/entities/PlayerCharacter.ts:13-25` (`CharAction`) e o `switch` do legado
- Modify: `src/entities/rig/athletePoses.ts` (2 poses novas)
- Modify: `src/game/mechanics/serve.ts:114-132` (`performServe` — caminho do saque humano)
- Modify: `src/game/Team.ts` (classe `Athlete` — detecção de aterrissagem)
- Modify: `src/core/constants.ts` (limiar visual do saque por baixo)
- Test: `src/entities/rig/athletePoses.test.ts` (estende) e `src/game/Team.test.ts` (estende)

**Interfaces:**
- Produces: `CharAction` ganha `'serveUnderhand' | 'land'`. Constante `SERVE_UNDERHAND_VISUAL_POWER = 0.4` em `core/constants.ts`.
- Consumes: `Athlete.act(action, duration)` (Team.ts:70-73), `performServe(ctx, server, power, target, clearance)` (serve.ts:114) — o `power` do medidor humano já chega aqui.
- **Não tocar** em `performStrategicServe` (caminho da CPU/headless — é o que as baterias exercitam).

- [ ] **Step 1: Testes que falham (poses novas)**

Em `src/entities/rig/athletePoses.test.ts`, adicione:

```ts
describe('ações novas (Fase 8)', () => {
  it('saque por baixo balança o braço direito de trás para frente', () => {
    const armed = poseFor('serveUnderhand', 0.2, 0, 0, 0).rShX;
    const swung = poseFor('serveUnderhand', 0.6, 0, 0, 0).rShX;
    expect(armed).toBeLessThan(0); // braço atrás
    expect(swung).toBeGreaterThan(1); // pêndulo à frente
  });

  it('aterrissagem agacha e recupera valores finitos', () => {
    const p = poseFor('land', 0.15, 0, 0, 0);
    expect(p.knees).toBeLessThan(-0.8);
    expect(p.hips).toBeGreaterThan(0.4);
  });
});
```

E adicione `'serveUnderhand', 'land'` ao array `ACTIONS` do teste de valores finitos.

Run: `npx vitest run src/entities/rig/athletePoses.test.ts`
Expected: FAIL — TypeScript nem compila (`serveUnderhand` não é `CharAction`).

- [ ] **Step 2: Estender `CharAction` e as poses**

Em `src/entities/PlayerCharacter.ts:13-25`, adicione à união:

```ts
  | 'serveUnderhand'
  | 'land'
```

Em `src/entities/rig/athletePoses.ts`, adicione ao `switch` de `poseFor`:

```ts
    case 'serveUnderhand': {
      // saque por baixo: corpo curvado, braço direito pêndulo de trás para frente,
      // mão esquerda apresenta a bola à frente
      const wind = ease01(phase(t, 0, 0.3) * 1.5);
      const swing = easeOutBack(phase(t, 0.3, 0.55), 1.2);
      p.torsoPitch = 0.35 - 0.18 * swing;
      p.hips = 0.35;
      p.knees = -0.5 + 0.15 * swing;
      p.rShX = -0.9 * wind + 2.5 * swing; // termina ~1.6 (pêndulo completo)
      p.rElX = -0.1;
      p.lShX = 0.9 - 0.5 * swing; // apresenta a bola e recolhe
      p.lElX = -0.6;
      break;
    }
    case 'land': {
      // aterrissagem: agachamento curto de absorção com braços à frente para equilíbrio
      const k = ease01(t * 8);
      const recover = ease01(phase(t, 0.14, 0.3));
      p.torsoPitch = 0.4 * k * (1 - 0.5 * recover);
      p.hips = 0.12 + 0.5 * k * (1 - recover * 0.6);
      p.knees = -0.2 - 0.95 * k * (1 - recover * 0.6);
      p.lShX = 0.55 * k;
      p.rShX = 0.55 * k;
      p.lElX = -0.3;
      p.rElX = -0.3;
      break;
    }
```

No legado `src/entities/PlayerCharacter.ts`, adicione ao `switch` de `update` (antes de `case 'dive'`), versões simples equivalentes (o legado não tem `phase`/`easeOutBack` — use `ease01` local):

```ts
      case 'serveUnderhand': {
        const k = ease01(t * 2.5);
        p.torsoPitch = 0.35 - 0.18 * k;
        p.rShX = -0.9 + 2.5 * k;
        p.rElX = -0.1;
        p.lShX = 0.9 - 0.5 * k;
        p.lElX = -0.6;
        p.hips = 0.35;
        p.knees = -0.5;
        break;
      }
      case 'land': {
        const k = ease01(t * 8);
        p.torsoPitch = 0.35 * k;
        p.hips = 0.12 + 0.45 * k;
        p.knees = -0.2 - 0.85 * k;
        p.lShX = 0.5 * k;
        p.rShX = 0.5 * k;
        break;
      }
```

Run: `npx vitest run src/entities/rig/athletePoses.test.ts` — Expected: PASS.

- [ ] **Step 3: Constante e wiring do saque por baixo (humano)**

Em `src/core/constants.ts`, perto das constantes de jogador/saque, adicione:

```ts
// Limiar VISUAL do saque por baixo (Fase 8): carga do medidor abaixo disso usa a animação
// de saque por baixo. Só apresentação — trajetória e resultado não mudam.
export const SERVE_UNDERHAND_VISUAL_POWER = 0.4;
```

Em `src/game/mechanics/serve.ts`, função `performServe` (linhas 114-132), substitua o corpo do trecho de animação:

```ts
  const side = ctx.servingTeam;
  const serverIndex = server.index;
  ctx.hooks.serveMeter(false);
  ctx.hooks.effects.showAim(null);
  // Carga baixa = saque por baixo (visual); a física do saque é idêntica (finishServe decide).
  const underhand = power < SERVE_UNDERHAND_VISUAL_POWER;
  server.act(underhand ? 'serveUnderhand' : 'serveToss', underhand ? 0.9 : 0.5);
  const hand = server.reachPoint();
  ctx.ball.launch(new THREE.Vector3(hand.x, 1.15, hand.z), new THREE.Vector3(0, 5.6, 0));
  if (!underhand) ctx.after(0.34, () => server.act('serveHit', 0.5));
  ctx.after(0.42, () => {
    finishServe(ctx, side, serverIndex, power, target, clearance, null);
  });
```

Adicione o import de `SERVE_UNDERHAND_VISUAL_POWER` no topo do arquivo (junto dos imports de `core/constants`). **Não altere** o `ctx.ball.launch` nem os tempos de `ctx.after` — são estado compartilhado com a simulação.

- [ ] **Step 4: Teste que falha (aterrissagem)**

Em `src/game/Team.test.ts`, veja como os testes existentes constroem `Athlete` (eles injetam um `CharFactory` dublê — siga o padrão do arquivo). Adicione:

```ts
  it('aterrissar de uma cortada dispara a ação land', () => {
    const actions: string[] = [];
    const athlete = new Athlete(TeamSide.HOME, 0, LOOK_DUBLE, () => ({
      root: new THREE.Group(),
      moveSpeed: 0,
      jumpY: 0,
      setAction: (a: CharAction) => actions.push(a),
      update: () => {},
    }));
    athlete.jump(6);
    athlete.act('spikeHit', 0.5);
    for (let i = 0; i < 120; i += 1) athlete.update(1 / 60, 5);
    expect(actions).toContain('land');
  });
```

(Use o `CharLook` dublê que o arquivo já define; se ele tiver outro nome, adapte `LOOK_DUBLE`.)

Run: `npx vitest run src/game/Team.test.ts` — Expected: FAIL (`land` nunca é emitido).

- [ ] **Step 5: Implementar a detecção de aterrissagem**

Em `src/game/Team.ts`, classe `Athlete`:

Adicione o campo (junto de `actionUntil`, linha ~32):

```ts
  private lastAction: CharAction = 'idle';
```

Em `act(...)` (linha ~70), registre a ação:

```ts
  act(action: CharAction, duration: number): void {
    this.lastAction = action;
    this.char.setAction(action);
    this.actionUntil = this.clock + duration;
  }
```

No bloco do pulo em `update(...)` (linhas ~113-121), ao aterrissar:

```ts
    if (this.airborne) {
      this.jumpVel += GRAV * dt;
      this.jumpY += this.jumpVel * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.airborne = false;
        this.jumpVel = 0;
        // Aterrissagem de jogada aérea: agachamento curto de absorção (visual, Fase 8).
        if (
          this.lastAction === 'spikeHit' ||
          this.lastAction === 'spikeWindup' ||
          this.lastAction === 'block'
        ) {
          this.act('land', 0.28);
        }
      }
    }
```

Run: `npx vitest run src/game/Team.test.ts` — Expected: PASS.

- [ ] **Step 6: Suíte completa (baterias incluídas) + commit**

Run: `npm run test`
Expected: TUDO verde — em especial `BalanceBattery.test.ts` e `Match.headless.test.ts` (o caminho da CPU não foi tocado; `land` também dispara no headless via `HeadlessCharacter`, que aceita qualquer `CharAction` sem efeito).

Run: `npm run check`

```bash
git add src/entities/PlayerCharacter.ts src/entities/rig/athletePoses.ts src/entities/rig/athletePoses.test.ts src/game/mechanics/serve.ts src/game/Team.ts src/game/Team.test.ts src/core/constants.ts
git commit -m "feat(anim): saque por baixo em carga baixa e aterrissagem de absorcao"
```

---

### Task 7: Rastreio da bola pela cabeça (head tracking)

As atletas passam a acompanhar a bola com a cabeça — vida imediata em TODAS as jogadas por custo ~zero. Canal: novo método opcional `setLookTarget` no contrato `CharVisual`, alimentado por `Match.present` (posição interpolada da bola).

**Files:**
- Modify: `src/entities/PlayerCharacter.ts:45-58` (contrato `CharVisual`)
- Modify: `src/entities/rig/RiggedCharacter.ts` (implementação com clamp + damping)
- Modify: `src/game/Team.ts` (conversão mundo → local, como `aimContact`)
- Modify: `src/game/Match.ts:582-587` (`present`)
- Test: `src/entities/rig/RiggedCharacter.test.ts` (estende)

**Interfaces:**
- Produces: `CharVisual.setLookTarget?(x: number, y: number, z: number): void` (coords no referencial do root, como `setContactAim`); `Athlete.lookAtPoint(point: { x: number; y: number; z: number }): void`.
- Consumes: `this.ball.present(alpha)` em `Match.present` (retorna `THREE.Vector3` interpolado — ver Match.ts:586); `Team.athletes` (array público usado em `Team.present`).

- [ ] **Step 1: Teste que falha**

Em `src/entities/rig/RiggedCharacter.test.ts`, siga o padrão do arquivo (construção com `decalTexture: null`) e adicione:

```ts
  it('a cabeça gira em direção ao alvo do olhar, com clamp', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    char.setLookTarget!(2, 1.6, 1); // alvo à esquerda do modelo
    for (let i = 0; i < 60; i += 1) char.update(1 / 60);
    const head = char.root.getObjectByName('head')!;
    expect(head.rotation.y).toBeGreaterThan(0.2);
    expect(Math.abs(head.rotation.y)).toBeLessThanOrEqual(1.0);
  });

  it('sem alvo de olhar a cabeça volta ao yaw neutro', () => {
    const char = new RiggedCharacter(LOOK, { decalTexture: null });
    char.setLookTarget!(2, 1.6, 1);
    for (let i = 0; i < 60; i += 1) char.update(1 / 60);
    char.clearLookTarget();
    for (let i = 0; i < 90; i += 1) char.update(1 / 60);
    const head = char.root.getObjectByName('head')!;
    expect(Math.abs(head.rotation.y)).toBeLessThan(0.08);
  });
```

(`LOOK` = o `CharLook` dublê que o arquivo já usa.)

Run: `npx vitest run src/entities/rig/RiggedCharacter.test.ts` — Expected: FAIL.

- [ ] **Step 2: Contrato + implementação**

Em `src/entities/PlayerCharacter.ts`, interface `CharVisual`, adicione após `setContactAim`:

```ts
  /** Alvo do olhar no referencial do root (rastreio da bola pela cabeça). */
  setLookTarget?(x: number, y: number, z: number): void;
```

Em `src/entities/rig/RiggedCharacter.ts`:

Campos novos (junto de `aim`, linha ~70):

```ts
  // Alvo do olhar (referencial do root); null = cabeça neutra.
  private readonly look = new THREE.Vector3();
  private lookActive = false;
```

Constantes no topo (junto de `AIM_HOLD_SECONDS`):

```ts
const HEAD_YAW_MAX = 1.0; // rad — além disso a atleta não "quebra o pescoço"
const HEAD_PITCH_MIN = -0.55; // olhar para cima
const HEAD_PITCH_MAX = 0.6; // olhar para baixo
```

Métodos:

```ts
  setLookTarget(x: number, y: number, z: number): void {
    this.look.set(x, y, z);
    this.lookActive = true;
  }

  clearLookTarget(): void {
    this.lookActive = false;
  }
```

Em `update(dt)`, o bloco da cabeça hoje é (linha ~211):

```ts
    j.head.rotation.x += (p.headPitch - j.head.rotation.x) * l;
```

Substitua por:

```ts
    // Rastreio da bola: yaw/pitch do alvo no referencial do root, com clamp anatômico.
    // Celebração/decepção mantêm a cabeça coreografada.
    let headYawTarget = 0;
    let headPitchTarget = p.headPitch;
    if (this.lookActive && this.action !== 'celebrate' && this.action !== 'dejected') {
      const dx = this.look.x;
      const dy = this.look.y - 1.54 * this.heightScale; // altura aprox. dos olhos
      const dz = this.look.z;
      const flat = Math.hypot(dx, dz);
      headYawTarget = Math.max(-HEAD_YAW_MAX, Math.min(HEAD_YAW_MAX, Math.atan2(dx, dz)));
      headPitchTarget = Math.max(
        HEAD_PITCH_MIN,
        Math.min(HEAD_PITCH_MAX, p.headPitch - Math.atan2(dy, Math.max(0.4, flat))),
      );
    }
    j.head.rotation.x += (headPitchTarget - j.head.rotation.x) * l;
    j.head.rotation.y += (headYawTarget - j.head.rotation.y) * l;
```

Run: `npx vitest run src/entities/rig/RiggedCharacter.test.ts` — Expected: PASS.

- [ ] **Step 3: Wiring Team/Match**

Em `src/game/Team.ts`, classe `Athlete`, após `aimContact` (linha ~168), adicione (mesma matemática de conversão, sem alocar):

```ts
  /** Alvo do olhar (rastreio da bola): converte mundo → referencial do root. */
  lookAtPoint(point: { x: number; y: number; z: number }): void {
    if (!this.char.setLookTarget) return;
    const dx = point.x - this.char.root.position.x;
    const dz = point.z - this.char.root.position.z;
    const sinF = Math.sin(this.char.root.rotation.y);
    const cosF = Math.cos(this.char.root.rotation.y);
    this.char.setLookTarget(cosF * dx - sinF * dz, point.y - this.jumpY, sinF * dx + cosF * dz);
  }
```

(Usa `char.root` — posição/rotação de APRESENTAÇÃO, já interpoladas — em vez de `this.pos/facing`, porque o olhar é calculado depois de `present`.)

Em `src/game/Match.ts`, `present(alpha)` (linhas 582-587), substitua por:

```ts
  present(alpha: number): void {
    this.home.present(alpha);
    this.away.present(alpha);
    this.human.presentMarker();
    const ballPos = this.ball.present(alpha);
    this.hooks.camera.ballPos.copy(ballPos);
    // Rastreio da bola pela cabeça (Fase 8) — apresentação pura, depois da interpolação.
    for (const athlete of this.home.athletes) athlete.lookAtPoint(ballPos);
    for (const athlete of this.away.athletes) athlete.lookAtPoint(ballPos);
  }
```

Se `Team.athletes` for `private`, exponha um getter readonly (`get athletes(): readonly Athlete[]`) — verifique em `src/game/Team.ts` (o `present` da Team itera `this.athletes`, linha ~349).

- [ ] **Step 4: Suíte completa + commit**

Run: `npm run test` — Expected: verde (headless usa `HeadlessCharacter` sem `setLookTarget` → no-op via optional chaining em `lookAtPoint`).
Run: `npm run check`

```bash
git add src/entities/PlayerCharacter.ts src/entities/rig/RiggedCharacter.ts src/entities/rig/RiggedCharacter.test.ts src/game/Team.ts src/game/Match.ts
git commit -m "feat(anim): atletas acompanham a bola com a cabeca (clamp anatomico)"
```

---

### Task 8: Cabelo 2.0 — osso `hairTail`, penteados novos e pêndulo

Resolve o "terceiro braço na cabeça": os penteados ganham formas compostas e afinadas, e os que pendem (rabo de cavalo, trança, longo) são skinnados num osso novo `hairTail` com movimento secundário de pêndulo amortecido (determinístico por dt).

**Files:**
- Modify: `src/entities/rig/AthleteSkeleton.ts` (osso 20)
- Modify: `src/entities/rig/AthleteBodyGeometry.ts` (penteados; `SegmentSpec` ganha `rotationZ?`)
- Modify: `src/entities/rig/RiggedCharacter.ts` (pêndulo)
- Test: `src/entities/rig/AthleteSkeleton.test.ts`, `src/entities/rig/AthleteBodyGeometry.test.ts`, `src/entities/rig/RiggedCharacter.test.ts` (estendem)

**Interfaces:**
- Produces: `AthleteJointName` ganha `'hairTail'`; `BONE_TABLE` ganha `{ name: 'hairTail', parent: 'head', position: [0, 0.02, -0.09] }` (índice 19, o ÚLTIMO — não mude os índices existentes, o skinning rígido depende deles).
- Consumes: `SegmentSpec` (region/bone/geometry/offset/scale/rotationX) de AthleteBodyGeometry.ts:24-33.

- [ ] **Step 1: Testes que falham (esqueleto)**

Em `src/entities/rig/AthleteSkeleton.test.ts`, atualize a contagem de ossos de 19 para 20 onde for assertada, e adicione:

```ts
  it('hairTail é o último osso e filho de head', () => {
    const rig = buildAthleteSkeleton();
    expect(rig.boneIndex.hairTail).toBe(19);
    expect(rig.joints.hairTail.parent).toBe(rig.joints.head);
  });
```

Run: `npx vitest run src/entities/rig/AthleteSkeleton.test.ts` — Expected: FAIL.

- [ ] **Step 2: Osso novo**

Em `src/entities/rig/AthleteSkeleton.ts`:
- Adicione `| 'hairTail'` ao fim da união `AthleteJointName`.
- Adicione ao FIM de `BONE_TABLE` (depois de `footR`):

```ts
  { name: 'hairTail', parent: 'head', position: [0, 0.02, -0.09] },
```

Atualize o comentário do topo do arquivo ("19 ossos" → "20 ossos (Fase 8: hairTail para o movimento do cabelo)").

Run: `npx vitest run src/entities/rig/AthleteSkeleton.test.ts` — Expected: PASS.
Run: `npx vitest run src/entities/rig` — Expected: PASS (se algum teste de geometria/rig assertar 19, atualize para 20).

- [ ] **Step 3: Testes que falham (geometria)**

Em `src/entities/rig/AthleteBodyGeometry.test.ts`, siga o padrão do arquivo e adicione:

```ts
  it('penteados pendentes têm vértices skinnados no hairTail', () => {
    for (const hairstyle of ['ponytail', 'braid', 'long'] as const) {
      const rig = buildAthleteSkeleton();
      const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle });
      const hair = parts.find((p) => p.region === 'hair')!;
      const skinIndex = hair.geometry.getAttribute('skinIndex');
      let tailVerts = 0;
      for (let i = 0; i < skinIndex.count; i += 1) {
        if (skinIndex.getX(i) === rig.boneIndex.hairTail) tailVerts += 1;
      }
      expect(tailVerts, hairstyle).toBeGreaterThan(0);
    }
  });

  it('coque e curto permanecem 100% na cabeça', () => {
    for (const hairstyle of ['bun', 'short'] as const) {
      const rig = buildAthleteSkeleton();
      const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle });
      const hair = parts.find((p) => p.region === 'hair')!;
      const skinIndex = hair.geometry.getAttribute('skinIndex');
      for (let i = 0; i < skinIndex.count; i += 1) {
        expect(skinIndex.getX(i)).toBe(rig.boneIndex.head);
      }
    }
  });
```

Run: `npx vitest run src/entities/rig/AthleteBodyGeometry.test.ts` — Expected: FAIL.

- [ ] **Step 4: Penteados 2.0**

Em `src/entities/rig/AthleteBodyGeometry.ts`:

Adicione `rotationZ?: readonly number | number` não — mantenha simples: adicione ao `SegmentSpec` (linha ~24):

```ts
  /** Rotação em z (rad) aplicada antes do offset (mechas laterais). */
  readonly rotationZ?: number;
```

E em `prepareSegment` (linha ~141), após o `rotateX`:

```ts
  if (spec.rotationZ) geometry.rotateZ(spec.rotationZ);
```

Substitua o bloco de cabelo em `bodySegments` (do comentário `// cabelo:` até o fim dos `else if`, linhas ~97-131) por:

```ts
    // cabelo: cap sempre; variações por estilo. Segmentos pendentes vão no osso hairTail
    // (pêndulo, Fase 8); scalp/coque ficam na cabeça.
    { region: 'hair', bone: 'head', geometry: sphere(0.11, 10, 8), offset: [0, 0.045, -0.01] },
  ];
  if (hairstyle === 'long') {
    // cortina traseira em três painéis levemente curvados + mechas laterais
    specs.push(
      { region: 'hair', bone: 'head', geometry: box(0.15, 0.1, 0.045), offset: [0, -0.01, -0.105] },
      {
        region: 'hair',
        bone: 'hairTail',
        geometry: box(0.16, 0.16, 0.04),
        offset: [0, -0.1, -0.025],
        rotationX: -0.12,
      },
      {
        region: 'hair',
        bone: 'hairTail',
        geometry: box(0.14, 0.12, 0.035),
        offset: [0, -0.22, -0.045],
        rotationX: -0.2,
      },
      {
        region: 'hair',
        bone: 'head',
        geometry: box(0.035, 0.16, 0.07),
        offset: [0.105, -0.03, -0.03],
        rotationZ: 0.12,
      },
      {
        region: 'hair',
        bone: 'head',
        geometry: box(0.035, 0.16, 0.07),
        offset: [-0.105, -0.03, -0.03],
        rotationZ: -0.12,
      },
    );
  } else if (hairstyle === 'ponytail') {
    // tufo na nuca + rabo em três segmentos afinando, com curva natural
    specs.push(
      { region: 'hair', bone: 'head', geometry: sphere(0.045, 8, 6), offset: [0, 0.015, -0.1] },
      {
        region: 'hair',
        bone: 'hairTail',
        geometry: capsule(0.034, 0.09),
        offset: [0, -0.045, -0.035],
        rotationX: -0.45,
      },
      {
        region: 'hair',
        bone: 'hairTail',
        geometry: capsule(0.028, 0.09),
        offset: [0, -0.13, -0.065],
        rotationX: -0.25,
      },
      {
        region: 'hair',
        bone: 'hairTail',
        geometry: capsule(0.02, 0.07),
        offset: [0, -0.2, -0.075],
        rotationX: -0.1,
      },
    );
  } else if (hairstyle === 'bun') {
    // coque alto: rosca + núcleo (fica na cabeça, sem pêndulo)
    const ring = new THREE.TorusGeometry(0.048, 0.018, 6, 12);
    specs.push(
      { region: 'hair', bone: 'head', geometry: ring, offset: [0, 0.085, -0.09], rotationX: 1.2 },
      { region: 'hair', bone: 'head', geometry: sphere(0.042, 8, 6), offset: [0, 0.09, -0.095] },
    );
  } else if (hairstyle === 'braid') {
    // trança: contas afinando em cadeia no hairTail
    specs.push({
      region: 'hair',
      bone: 'head',
      geometry: sphere(0.04, 8, 6),
      offset: [0, -0.01, -0.1],
    });
    const beads = [0.033, 0.03, 0.027, 0.024, 0.02] as const;
    beads.forEach((radius, i) => {
      specs.push({
        region: 'hair',
        bone: 'hairTail',
        geometry: sphere(radius, 7, 5),
        offset: [0, -0.05 - i * 0.055, -0.03 - i * 0.012],
      });
    });
  }
  return specs;
}
```

Atenção: o array `specs` hoje termina com o cap de cabelo DENTRO do literal — a reescrita acima move o fechamento `];` para antes dos `if`. Ajuste o fechamento do array conforme o diff acima (o cap é o último item do literal).

Run: `npx vitest run src/entities/rig/AthleteBodyGeometry.test.ts` — Expected: PASS.

- [ ] **Step 5: Teste que falha (pêndulo)**

Em `src/entities/rig/RiggedCharacter.test.ts`:

```ts
  it('o cabelo balança ao correr e volta ao repouso, sempre dentro do clamp', () => {
    const char = new RiggedCharacter({ ...LOOK, hairstyle: 'ponytail' }, { decalTexture: null });
    const tail = char.root.getObjectByName('hairTail')!;
    char.setPlanarMotion(4, 0, false); // corrida à frente
    for (let i = 0; i < 60; i += 1) char.update(1 / 60);
    const moving = tail.rotation.x;
    expect(Math.abs(moving)).toBeGreaterThan(0.05);
    expect(Math.abs(moving)).toBeLessThanOrEqual(0.7);
    char.setPlanarMotion(0, 0, false);
    for (let i = 0; i < 240; i += 1) char.update(1 / 60);
    expect(Math.abs(tail.rotation.x)).toBeLessThan(0.05);
  });
```

Run: `npx vitest run src/entities/rig/RiggedCharacter.test.ts` — Expected: FAIL.

- [ ] **Step 6: Pêndulo determinístico**

Em `src/entities/rig/RiggedCharacter.ts`:

Constantes no topo:

```ts
const HAIR_STIFFNESS = 60; // mola do pêndulo do cabelo (rad/s² por rad)
const HAIR_DAMPING = 10; // amortecimento (1/s)
const HAIR_SWING_MAX = 0.7; // rad
```

Campos:

```ts
  // Pêndulo do cabelo (hairTail): estado de mola amortecida, determinístico por dt.
  private hairAngleX = 0;
  private hairAngleZ = 0;
  private hairVelX = 0;
  private hairVelZ = 0;
  private prevJumpY = 0;
```

No FIM de `update(dt)` (depois do bloco das pernas), adicione:

```ts
    // Movimento secundário do cabelo: pêndulo amortecido reagindo à locomoção e ao pulo.
    if (dt > 0) {
      const verticalVel = (this.jumpY - this.prevJumpY) / dt;
      this.prevJumpY = this.jumpY;
      const fwd = Math.max(-6, Math.min(6, this.planarForward));
      const lat = Math.max(-6, Math.min(6, this.planarLateral));
      // correr à frente joga o rabo para trás (pitch +); cair joga para cima
      const targetX = 0.09 * fwd - 0.05 * Math.max(-8, Math.min(8, verticalVel));
      const targetZ = -0.08 * lat;
      this.hairVelX += ((targetX - this.hairAngleX) * HAIR_STIFFNESS - this.hairVelX * HAIR_DAMPING) * dt;
      this.hairVelZ += ((targetZ - this.hairAngleZ) * HAIR_STIFFNESS - this.hairVelZ * HAIR_DAMPING) * dt;
      this.hairAngleX = Math.max(-HAIR_SWING_MAX, Math.min(HAIR_SWING_MAX, this.hairAngleX + this.hairVelX * dt));
      this.hairAngleZ = Math.max(-HAIR_SWING_MAX, Math.min(HAIR_SWING_MAX, this.hairAngleZ + this.hairVelZ * dt));
      const tail = this.rig.joints.hairTail;
      tail.rotation.x = this.hairAngleX;
      tail.rotation.z = this.hairAngleZ;
    }
```

Run: `npx vitest run src/entities/rig/RiggedCharacter.test.ts` — Expected: PASS.

- [ ] **Step 7: Aceite visual na galeria**

Run: `npx vite --port 5199 --strictPort` (background) e abra `http://localhost:5199/?gallery` (galeria DEV determinística da 4C). Cheque os cinco penteados nos dois times: nada deve parecer "um braço colado na cabeça"; rabo/trança balançam ao trocar poses. Depois `npm run test` completo.

- [ ] **Step 8: Gates + commit**

Run: `npm run check`

```bash
git add src/entities/rig/AthleteSkeleton.ts src/entities/rig/AthleteSkeleton.test.ts src/entities/rig/AthleteBodyGeometry.ts src/entities/rig/AthleteBodyGeometry.test.ts src/entities/rig/RiggedCharacter.ts src/entities/rig/RiggedCharacter.test.ts
git commit -m "feat(rig): cabelo 2.0 com osso hairTail, penteados compostos e pendulo"
```

---

### Task 9: Quadra e ambiente premium

Textura taraflex procedural no piso (emendas + granulado sutis), environment map procedural (RoomEnvironment) para reflexos nos materiais standard, e sombras PCFSoft no desktop.

**Files:**
- Modify: `src/world/Court.ts` (textura em `buildFloor`)
- Modify: `src/main.ts` (environment + tipo de sombra + gating por tier)

**Interfaces:**
- Consumes: `COLORS.floorCourt/floorZone/floorFree` de constants; `QUALITY_TIERS`/`applyQualityTier` de main.ts:151-158.
- Produces: nada novo de API. `Court.setTheme` continua funcionando (o map multiplica a cor).

- [ ] **Step 1: Textura taraflex procedural**

Em `src/world/Court.ts`, adicione antes da classe:

```ts
/** Textura taraflex procedural: base neutra com emendas e granulado sutis (o tom vem da cor
 *  do material, então setTheme continua funcionando). Canvas local — zero assets remotos. */
function makeTaraflexTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 512, 512);
  // emendas das mantas (faixas verticais a cada 128 px)
  c.fillStyle = 'rgba(0,0,0,0.05)';
  for (let x = 0; x < 512; x += 128) c.fillRect(x, 0, 2, 512);
  c.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 3; x < 512; x += 128) c.fillRect(x, 0, 1, 512);
  // granulado leve do vinil
  for (let i = 0; i < 6000; i += 1) {
    const shade = Math.random();
    c.fillStyle = shade < 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)';
    c.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
```

Em `buildFloor`, aplique a MESMA textura (instância única) aos três materiais:

```ts
    const taraflex = makeTaraflexTexture();
```

- `freeMaterial`: adicione `map: taraflex` e antes do uso configure `taraflex.repeat.set(6, 4)` — como o map é compartilhado, o repeat é único; use 6×4 e NÃO chame repeat de novo nos outros.
- `floorMaterial`: adicione `map: taraflex`.
- `zoneMaterial`: adicione `map: taraflex`.

(As três chamadas de `new THREE.MeshStandardMaterial({...})` ganham a propriedade `map: taraflex`; a linha do `repeat` fica logo após criar a textura.)

- [ ] **Step 2: Environment map + sombras suaves**

Em `src/main.ts`:

Import:

```ts
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
```

Logo após a criação de `scene` (linha ~129-131):

```ts
// Environment procedural (Fase 8): reflexos sutis nos materiais standard (taraflex, bola,
// uniformes) sem nenhum asset externo. Intensidade baixa — realce, não espelho.
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.environmentIntensity = 0.35;
```

Na linha 123, o tipo de sombra vira condicionado (PCFSoft é mais caro; touch mantém PCF):

```ts
renderer.shadowMap.type = isTouch ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
```

Em `applyQualityTier` (linha ~151), adicione ao corpo:

```ts
  // Environment só nos tiers médio/alto — no baixo, economiza amostragem por fragmento.
  scene.environment = tier >= 1 ? envTexture : null;
```

- [ ] **Step 3: Gates + verificação visual**

Run: `npm run check` — Expected: verde.
Run: `npm run build` — Expected: bundle ≤ 250 kB gzip (RoomEnvironment adiciona ~4 kB).

Playtest (skill `playtest`, porta 5199): piso com brilho de vinil e emendas sutis; sem moiré forte na câmera broadcast (se houver, aumente `anisotropy` para 8); sombras das atletas com borda suave no desktop; `?tier=0` remove reflexos sem erro. `__renderer.info.render.calls` em rally ≤ 250.

- [ ] **Step 4: Commit**

```bash
git add src/world/Court.ts src/main.ts
git commit -m "feat(arena): taraflex procedural, environment RoomEnvironment e sombras PCFSoft"
```

---

### Task 10: Gate final da fase — medição, playtest e documentação

**Files:**
- Modify: `docs/ROADMAP.md` (subfase Fase 8 na seção de estado)
- Modify: `CHANGELOG.md` (entrada não-lançada)
- Modify: `docs/superpowers/plans/README.md` (linha de índice deste plano)

- [ ] **Step 1: Gates completos**

Run: `npm run check` — Expected: tudo verde (workflow + typecheck + lint + format + cobertura, incluindo as baterias §4.3/§3.2).
Run: `npm run build && npm run test:e2e:smoke:prod` — Expected: smoke verde.
Run: `npm run test:e2e:offline` — Expected: verde (o SW cacheia o mesmo bundle; nada remoto entrou).

- [ ] **Step 2: Medição de performance real**

Playtest com a skill `playtest` (porta 5199), desktop e viewport 844×390:
1. Partida rápida real de ≥ 2 pontos.
2. Chip de FPS visível no canto superior esquerdo, legível e discreto; no desktop deve reportar ≥ 60 sustentado (cor teal).
3. Com `?debug`: `__renderer.info.render.calls` ≤ 250 e `__renderer.info.render.triangles` ≤ 250000 durante rally.
4. Zero erros de console.
5. Confira visualmente: torcida fluida e com pele/camisa distintas; saque humano com carga baixa sai por baixo; cortada tem chicote com snap; aterrissagem agacha; cabeças seguem a bola; cabelos ok nos 5 penteados.

Se algum orçamento estourar, PARE e corrija antes de documentar (o suspeito nº 1 é a geometria da torcida — reduza segmentos dos braços para 4).

- [ ] **Step 3: Documentar**

- `docs/ROADMAP.md`: na seção "Fundação 2.0 — estado das subfases", adicione ao final:

```markdown
- **Fase 8 — concluída:** polimento visual e performance: renderer em `high-performance`,
  chip de FPS no HUD, tier desce abaixo de ~55 fps (alvo 60), torcida animada em vertex
  shader com duas tonalidades, poses com anticipação/overshoot, saque por baixo visual,
  aterrissagem, rastreio da bola pela cabeça, cabelo 2.0 com osso `hairTail` e pêndulo,
  taraflex procedural e environment RoomEnvironment por tier. Física intocada — baterias
  §4.3/§3.2 verdes.
```

- `CHANGELOG.md`: siga o formato do arquivo e adicione as mudanças acima numa seção não-lançada (ex.: `## [Não lançado]`), sem criar tag.
- `docs/superpowers/plans/README.md`: adicione a linha deste plano seguindo o padrão das existentes.

- [ ] **Step 4: Commit final e push**

```bash
git add docs/ROADMAP.md CHANGELOG.md docs/superpowers/plans/README.md docs/superpowers/plans/2026-07-19-fase-8-polimento-visual.md
git commit -m "docs(fase8): registra polimento visual e performance no roadmap e changelog"
git push
```

Após o push, confirme que o run do GitHub Actions ficou verde (deploy Pages automático). Se ficar vermelho, pare trabalho novo e corrija com um commit novo (nunca amend/force-push).

---

## Notas para o executor

- **Ordem importa:** Tasks 1–3 (perf/HUD) → 4 (torcida) → 5–7 (animação) → 8 (cabelo) → 9 (quadra) → 10 (gate). A Task 6 depende da 5 (`phase`/`easeOutBack`); a 8 depende de nada além do rig atual.
- **Se um teste existente quebrar** e você não entender o porquê, use a skill `superpowers:systematic-debugging` antes de mexer no teste. Só atualize expectativas de teste quando a mudança de valor for intencional e explicada neste plano.
- **Nunca** "conserte" uma bateria de balanceamento ajustando faixas — se ela quebrou, a Task introduziu efeito na simulação e precisa ser corrigida.
- Memória do projeto: se o `git` reclamar de lock em `.claude/.github` no Windows, procure um processo `vite` órfão e mate-o.
