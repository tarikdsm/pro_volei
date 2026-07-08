# Separar IA e Controle Humano (Fase 1, 1.5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desentrelaçar os ramos `isHuman`/`!isHuman` que restam no `Match.ts`, extraindo
`control/HumanController.ts` e `ai/AiController.ts`, deixando `Match` como orquestrador fino.

**Architecture:** Dois colaboradores assimétricos sobre o `MechanicsCtx` já existente. O
`HumanController` reage a `Input` por frame e é dono do estado de interação (ctl, aim, timingQ,
jumpQ, chosenZone, marker). O `AiController` é sem estado (lê `ctx.diff`) e agenda aproximação/
pulos + rolagens de qualidade. `Match.planNext` mantém a geometria e delega o setup do lado.

**Tech Stack:** TypeScript (strict, ES2022, ESM), Three.js r185, Vitest 4. Ver
[spec](../specs/2026-07-08-ai-human-control-design.md).

## Global Constraints

- 1 unidade Three.js = 1 metro. `TeamSide.HOME` = humano (x negativo), `AWAY` = CPU (x positivo).
- Comentários e termos de domínio em **pt-BR**. Siga o estilo do arquivo.
- Tuning em `core/constants.ts`; nada de números mágicos novos espalhados.
- Prettier decide formatação (aspas simples, ponto e vírgula, 100 colunas, 2 espaços). LF.
- **Nenhum incremento pode mudar o comportamento observável.** Rede de segurança: `npm run check`
  (typecheck + lint + format + 54 testes) + `/playtest` (porta 5199 `--strictPort`).
- Playtest: erros de console apontando `localhost:5173/src/ws/` são de outro projeto — ignore.

---

### Task 1 (1.5a): Helpers puros de timing/qualidade

Lógica determinística extraída antes de mover uso, coberta por teste (padrão `net.ts`/`scoring.ts`).
Deriva do `Match.ts` atual: `receiveTimingQuality` (l. 694), `jumpTimingQuality` (l. 740),
`humanContactQuality` (l. 539). **YAGNI:** o cálculo do saque não vira helper — é quase todo
`rand`/`chance`, sem núcleo puro que valha teste; fica no `HumanController` (Task 2).

**Files:**
- Create: `src/game/control/timing.ts`
- Test: `src/game/control/timing.test.ts`

**Interfaces:**
- Produces:
  - `receiveTimingQuality(contactIn: number): number` — 0..1
  - `jumpTimingQuality(contactIn: number): number` — 0..1
  - `humanContactQuality(timingQ: number, hard: boolean): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/game/control/timing.test.ts
import { describe, it, expect } from 'vitest';
import { receiveTimingQuality, jumpTimingQuality, humanContactQuality } from './timing';

describe('receiveTimingQuality', () => {
  it('dá 1.0 no instante ideal (0.08s antes do contato)', () => {
    expect(receiveTimingQuality(0.08)).toBeCloseTo(1);
  });
  it('cai com o erro de timing e satura em 0', () => {
    expect(receiveTimingQuality(0.08 + 0.5 / 3.2)).toBeCloseTo(0.5);
    expect(receiveTimingQuality(1)).toBe(0);
    expect(receiveTimingQuality(-1)).toBe(0);
  });
});

describe('jumpTimingQuality', () => {
  it('dá 1.0 no instante ideal (0.26s antes do contato)', () => {
    expect(jumpTimingQuality(0.26)).toBeCloseTo(1);
  });
  it('cai com o erro e satura em 0', () => {
    expect(jumpTimingQuality(0.26 + 0.5 / 2.8)).toBeCloseTo(0.5);
    expect(jumpTimingQuality(2)).toBe(0);
  });
});

describe('humanContactQuality', () => {
  it('mapeia timingQ para 0.45..1.0 sem bola forte', () => {
    expect(humanContactQuality(0, false)).toBeCloseTo(0.45);
    expect(humanContactQuality(1, false)).toBeCloseTo(1);
  });
  it('penaliza 20% contra bola forte', () => {
    expect(humanContactQuality(1, true)).toBeCloseTo(0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/control/timing.test.ts`
Expected: FAIL — `Failed to resolve import './timing'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/control/timing.ts
// Mapeamentos puros de timing → qualidade do controle humano (recepção e cortada).
// Determinísticos e testados; o resto do fluxo (aleatoriedade, banners, física) fica no
// HumanController.
import { clamp } from '../../core/math3d';

/** Qualidade [0..1] do aperto de ESPAÇO na recepção — 1.0 a 0.08s do contato. */
export function receiveTimingQuality(contactIn: number): number {
  return clamp(1 - Math.abs(contactIn - 0.08) * 3.2, 0, 1);
}

/** Qualidade [0..1] do timing do pulo no ataque — 1.0 a 0.26s do contato. */
export function jumpTimingQuality(contactIn: number): number {
  return clamp(1 - Math.abs(contactIn - 0.26) * 2.8, 0, 1);
}

/** Qualidade do toque humano dada a qualidade do timing; bola forte penaliza 20%. */
export function humanContactQuality(timingQ: number, hard: boolean): number {
  return (0.45 + 0.55 * timingQ) * (hard ? 0.8 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/control/timing.test.ts`
Expected: PASS (8 asserts).

- [ ] **Step 5: `npm run check` + commit**

```bash
npm run check
git add src/game/control/timing.ts src/game/control/timing.test.ts
git commit -m "refactor: helpers puros de timing/qualidade humana (1.5a, TDD)"
```

---

### Task 2 (1.5b): `control/HumanController.ts`

Move todo o estado de interação humana e `updateHumanControl` para um colaborador. `Match`
delega. Move atômico (o estado não pode ser meio-movido) — verificado por `check` + playtest, não
por novo teste unitário (o fluxo é estocástico/IO). Usa os helpers da Task 1.

**Files:**
- Create: `src/game/control/HumanController.ts`
- Modify: `src/game/Match.ts` (remove campos/métodos de controle; delega)

**Interfaces:**
- Consumes: `receiveTimingQuality`, `jumpTimingQuality`, `humanContactQuality` (Task 1);
  `MechanicsCtx`, `performServe`, `RallyState`/`TouchPlan`, `Athlete`.
- Produces (usado por `Match` e pelo `ctx`):
  - `new HumanController()` — cria o `marker` (mesh)
  - `readonly marker: THREE.Mesh`
  - `readonly aim: THREE.Vector3`, `chosenZone: number`
  - `get mode(): CtlMode`, `get isControlling(): boolean`
  - `update(dt: number, input: Input, ctx: MechanicsCtx): void`
  - `resetForServe(): void`
  - `beginServe(server: Athlete, ctx: MechanicsCtx): void`
  - `awaitOpponentServe(): void`
  - `onAssigned(ctx: MechanicsCtx, plan: TouchPlan): void`
  - `assignBlock(blocker: Athlete, ctx: MechanicsCtx): void`
  - `idle(ctx: MechanicsCtx): void`
  - `reachQuality(plan: TouchPlan, hard: boolean, medium: boolean, ctx: MechanicsCtx): number`
  - `spikeQuality(): number`

- [ ] **Step 1: Criar `HumanController` com estado + marker**

Criar `src/game/control/HumanController.ts`. Mover para a classe os campos hoje em `Match`
(l. 94-104): `ctl`, `controlled`, `serveCharging`, `servePower`, `serveDir`, `aim`, `timingQ`,
`jumpQ`, `chosenZone`, `marker`. Construtor cria a mesh do marker (mover l. 113-124 do `Match`):

```ts
// src/game/control/HumanController.ts (cabeça)
import * as THREE from 'three';
import { Input } from '../../core/Input';
import { PLAYER, TeamSide } from '../../core/constants';
import { clamp, lerp, rand, chance } from '../../core/math3d';
import { Athlete } from '../Team';
import { TouchPlan } from '../RallyState';
import { performServe } from '../mechanics/serve';
import type { MechanicsCtx } from '../mechanics/context';
import { receiveTimingQuality, jumpTimingQuality, humanContactQuality } from './timing';

export type CtlMode = 'none' | 'serve' | 'receive' | 'attack' | 'block';

const PERFECT_LO = 0.72;
const PERFECT_HI = 0.92;

export class HumanController {
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private serveCharging = false;
  private servePower = 0;
  private serveDir = 1;
  readonly aim = new THREE.Vector3(5.5, 0, 0);
  private timingQ = -1;
  private jumpQ = -1;
  chosenZone = 0;
  readonly marker: THREE.Mesh;

  constructor() {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 24),
      new THREE.MeshBasicMaterial({
        color: 0x40ff9f,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
  }

  get mode(): CtlMode {
    return this.ctl;
  }
  get isControlling(): boolean {
    return (
      this.controlled !== null &&
      (this.ctl === 'receive' || this.ctl === 'attack' || this.ctl === 'block' || this.ctl === 'serve')
    );
  }
}
```

- [ ] **Step 2: Mover `updateHumanControl` + marker para `update`**

Mover o corpo de `Match.updateHumanControl` (l. 633-756) para `HumanController.update(dt, input, ctx)`.
Trocar `this.hooks` → `ctx.hooks`, `this.rally` → `ctx.rally`. A escolha de zona por A/W/D e o
`ctl==='none'` do levantador humano ficam iguais. No fim de `update`, anexar o bloco do marker
(mover l. 500-511 do `Match`):

```ts
  update(dt: number, input: Input, ctx: MechanicsCtx): void {
    const axis = input.moveAxis();
    // ... (corpo migrado de updateHumanControl, com ctx.hooks / ctx.rally) ...
    // no ramo de soltar o saque, usar os helpers e performServe(ctx, ...):
    //   performServe(ctx, this.controlled!, Math.max(0.3, power), target, clearance);

    // marker do jogador controlado
    if (this.isControlling && this.controlled) {
      this.marker.visible = true;
      this.marker.position.set(this.controlled.pos.x, 0.02, this.controlled.pos.z);
    } else {
      this.marker.visible = false;
    }
  }
```

Onde o saque usa timing/qualidade, manter a lógica atual (o núcleo estocástico fica aqui). As
constantes `PERFECT_LO`/`PERFECT_HI` saem do `Match` e passam a viver no `HumanController`.

- [ ] **Step 3: Mover métodos de atribuição (ramos `isHuman` do `planNext`) + saque**

Adicionar os métodos que absorvem os ramos humanos. `onAssigned` despacha por `plan.kind`:

```ts
  resetForServe(): void {
    this.timingQ = -1;
    this.jumpQ = -1;
    this.chosenZone = Math.floor(Math.random() * 3); // randPick([0,1,2])
  }

  beginServe(server: Athlete, ctx: MechanicsCtx): void {
    this.ctl = 'serve';
    this.controlled = server;
    this.servePower = 0;
    this.serveCharging = false;
    this.aim.set(rand(4, 6.5), 0, rand(-2, 2));
    ctx.hooks.hint('SEGURE ESPAÇO para carregar o saque — solte na zona verde · WASD ajusta a mira');
    ctx.hooks.serveMeter(true, 0);
  }

  awaitOpponentServe(): void {
    this.ctl = 'none';
    this.controlled = null;
  }

  onAssigned(ctx: MechanicsCtx, plan: TouchPlan): void {
    // nudge inicial: o atleta humano começa a andar ao ponto; WASD assume depois
    if (plan.kind === 'spike') {
      // já posicionado pelo backoff no planNext; aqui só o setup de ataque
      this.ctl = 'attack';
      this.controlled = plan.athlete;
      this.jumpQ = -1;
      this.aim.set(rand(4.5, 6.5), 0, rand(-2.5, 2.5));
      ctx.hooks.hint('ESPAÇO pula (timing = força) · WASD mira a cortada');
    } else if (plan.kind === 'set') {
      this.ctl = 'none';
      this.controlled = null;
      ctx.hooks.hint('Escolha o ataque: A esquerda · W centro · D direita');
      ctx.hooks.zoneHint(this.chosenZone);
    } else {
      this.ctl = 'receive';
      this.controlled = plan.athlete;
      this.timingQ = -1;
      ctx.hooks.hint('WASD move · ESPAÇO no momento do toque = passe perfeito');
      ctx.hooks.effects.showLanding(plan.point);
    }
  }

  assignBlock(blocker: Athlete, ctx: MechanicsCtx): void {
    this.ctl = 'block';
    this.controlled = blocker;
    ctx.hooks.hint('BLOQUEIO: A/D desliza na rede · ESPAÇO pula!');
  }

  idle(ctx: MechanicsCtx): void {
    if (this.ctl !== 'block') {
      this.ctl = 'none';
      this.controlled = null;
    }
    ctx.hooks.effects.showLanding(null);
  }
```

> **Nota de comportamento:** hoje o `planNext` faz o `moveTo` inicial do atleta humano (l. 252/254)
> **antes** do setup. Manter esse `moveTo` no `planNext` (é geometria) — `onAssigned` só faz o
> setup de controle. Ver Task 4.

- [ ] **Step 4: Métodos de qualidade (ramos humanos de attemptContact/Spike)**

```ts
  /** Qualidade do toque humano; consome e reseta timingQ. -1 = não defende. */
  reachQuality(plan: TouchPlan, hard: boolean, medium: boolean, ctx: MechanicsCtx): number {
    let q: number;
    if (this.timingQ >= 0) {
      q = humanContactQuality(this.timingQ, hard);
      if (this.timingQ > 0.8 && !hard) ctx.hooks.banner('PERFEITO!', '');
      if (this.timingQ > 0.7 && hard) ctx.hooks.banner('DEFESAÇA!', '');
    } else {
      const missP = hard ? 0.6 : medium ? 0.28 : 0;
      if (chance(missP)) q = chance(0.5) ? rand(0.02, 0.12) : -1;
      else q = hard ? 0.3 : 0.45;
    }
    this.timingQ = -1;
    return q;
  }

  /** Qualidade da cortada humana; consome e reseta jumpQ. */
  spikeQuality(): number {
    const q = this.jumpQ >= 0 ? this.jumpQ : 0.4;
    this.jumpQ = -1;
    return q;
  }
```

> `receiveTimingQuality`/`jumpTimingQuality` são usados **dentro** de `update` (onde `timingQ`/
> `jumpQ` são gravados ao apertar ESPAÇO), não aqui.

- [ ] **Step 5: Ligar no `Match`**

Em `Match.ts`: substituir os campos de controle (l. 94-104) e a criação do marker por
`private human = new HumanController();`. No construtor, `this.group.add(this.human.marker)`.

- `update()`: trocar `this.updateHumanControl(dt, input)` por `this.human.update(dt, input, this.ctx)`;
  remover o bloco do marker (l. 500-511).
- `beginServePrep()`: `this.human.resetForServe()` no lugar dos resets (l. 148-150); no ramo
  `humanServes` → `this.human.beginServe(server, this.ctx)`; no `else` → `this.human.awaitOpponentServe()`.
- `attemptContact`: ramo `d <= reach` isHuman → `this.human.reachQuality(plan, hard, medium, this.ctx)`;
  remover `this.timingQ = -1` do fim (agora dentro do método).
- `attemptSpikeContact`: ramo airborne isHuman → `this.human.spikeQuality()`; remover
  `this.jumpQ = -1`.
- `planNext`: o bloco `isHuman` (l. 258-276) → `this.human.onAssigned(this.ctx, this.rally.plan)`;
  o ramo bloqueio humano (l. 277-282) → `this.human.assignBlock(this.home.nearestFrontRowTo(cPoint.z), this.ctx)`;
  o ramo AWAY não-spike (l. 283-289) → `this.human.idle(this.ctx)`.
- `makeCtx()`: `aim`/`chosenZone` viram getters delegando: `get aim() { return this.human.aim }`,
  `get chosenZone() { return this.human.chosenZone }` (capturando `human` numa const local do closure).
- Remover `PERFECT_LO`/`PERFECT_HI` do topo do `Match`.

- [ ] **Step 6: `npm run check`**

Run: `npm run check`
Expected: verde (typecheck + lint + format + 54 testes + os 8 novos da Task 1 = 62).

- [ ] **Step 7: Playtest (foco lado humano)**

Subir `npm run dev -- --port 5199 --strictPort`, `/playtest`: humano saca (carrega/solta ESPAÇO,
mira WASD), recebe (ESPAÇO no tempo → PERFEITO), escolhe zona (A/W/D), ataca (ESPAÇO pula),
bloqueia cortada da IA (A/D + ESPAÇO). Marker aparece sob o controlado. **Zero erros de console.**

- [ ] **Step 8: Commit**

```bash
git add src/game/control/HumanController.ts src/game/Match.ts
git commit -m "refactor: extrai control/HumanController (estado + input humano) (1.5b)"
```

---

### Task 3 (1.5c): `ai/AiController.ts`

Move os ramos `!isHuman`: agendamento de aproximação/pulo, os pulos agendados do `update()`, as
rolagens de qualidade da IA e o gatilho do saque. Sem estado (lê `ctx.diff`). Verificado por
`check` + playtest.

**Files:**
- Create: `src/game/ai/AiController.ts`
- Modify: `src/game/Match.ts` (delega ramos IA)

**Interfaces:**
- Consumes: `MechanicsCtx`, `aiServe` (mechanics/serve), `TouchPlan`, `PLAYER`, `sideSign`.
- Produces:
  - `serve(ctx: MechanicsCtx): void`
  - `scheduleApproach(ctx: MechanicsCtx, plan: TouchPlan): void`
  - `updateScheduledJumps(dt: number, ctx: MechanicsCtx): void`
  - `reachQuality(ctx: MechanicsCtx, plan: TouchPlan, hard: boolean): number`
  - `spikeQuality(): number`

- [ ] **Step 1: Criar `AiController`**

```ts
// src/game/ai/AiController.ts
// Decisões da IA: agendamento de aproximação/pulo e rolagens de qualidade, parametrizadas por
// ctx.diff. Sem estado próprio. A seleção de alvo da IA fica em mechanics/ (touch/serve).
import { PLAYER, TeamSide, sideSign } from '../../core/constants';
import { rand, chance } from '../../core/math3d';
import { TouchPlan } from '../RallyState';
import { aiServe } from '../mechanics/serve';
import type { MechanicsCtx } from '../mechanics/context';

export class AiController {
  serve(ctx: MechanicsCtx): void {
    aiServe(ctx);
  }

  /** Manda o atleta da IA ao ponto de contato (com reactionDelay) e agenda o pulo no ataque. */
  scheduleApproach(ctx: MechanicsCtx, plan: TouchPlan): void {
    const { athlete, side, kind, point, contactIn } = plan;
    const delay = ctx.diff.reactionDelay;
    if (kind === 'spike') {
      const backoff = sideSign(side) * 0.85;
      ctx.after(delay, () => athlete.moveTo(point.x + backoff * 0.9, point.z));
      plan.jumpScheduledIn = contactIn - 0.26; // pula para contato no ápice
    } else {
      ctx.after(delay, () => athlete.moveTo(point.x, point.z));
    }
  }

  /** Avança os pulos agendados (atacante + bloqueadores) — chamado no update do rally. */
  updateScheduledJumps(dt: number, ctx: MechanicsCtx): void {
    const plan = ctx.rally.plan;
    if (plan && plan.jumpScheduledIn !== undefined) {
      plan.jumpScheduledIn -= dt;
      if (plan.jumpScheduledIn <= 0) {
        plan.athlete.act('spikeWindup', 0.4);
        plan.athlete.jump(PLAYER.jumpVel);
        plan.jumpScheduledIn = undefined;
      }
    }
    for (let i = ctx.rally.blockers.length - 1; i >= 0; i--) {
      ctx.rally.blockers[i].jumpIn -= dt;
      if (ctx.rally.blockers[i].jumpIn <= 0) {
        ctx.rally.blockers[i].athlete.act('block', 0.7);
        ctx.rally.blockers[i].athlete.jump(PLAYER.blockJumpVel);
        ctx.rally.blockers.splice(i, 1);
      }
    }
  }

  /** Qualidade do toque da IA; -1 = não defende. */
  reachQuality(ctx: MechanicsCtx, _plan: TouchPlan, hard: boolean): number {
    const diff = ctx.diff;
    if (hard && !chance(diff.digChance)) {
      return chance(0.55) ? rand(0.03, 0.12) : -1;
    }
    return rand(diff.passQuality[0], diff.passQuality[1]) * (hard ? 0.75 : 1);
  }

  spikeQuality(): number {
    return rand(0.6, 1);
  }
}
```

> `TeamSide` importado só se usado; se o lint reclamar de import não usado, remover.

- [ ] **Step 2: Ligar no `Match`**

- Campo: `private ai = new AiController();`
- `beginServePrep`: `this.after(rand(1.4, 2.4), () => this.ai.serve(this.ctx))`.
- `planNext`: o agendamento `!isHuman` (l. 239-255, exceto `camera('spike')`/`prepareBlock` que
  ficam) → `this.ai.scheduleApproach(this.ctx, this.rally.plan)`. Remover o cálculo local de
  `jumpScheduledIn` e o `moveTo` da IA.
- `update()`: substituir o bloco de pulos agendados (l. 447-464) por
  `this.ai.updateScheduledJumps(dt, this.ctx)`.
- `attemptContact`: ramo IA → `this.ai.reachQuality(this.ctx, plan, hard)`.
- `attemptSpikeContact`: ramo IA airborne → `this.ai.spikeQuality()`.

- [ ] **Step 3: `npm run check`**

Run: `npm run check` — Expected: verde (62 testes).

- [ ] **Step 4: Playtest (foco lado IA)**

`/playtest`: IA saca (às vezes erra por dificuldade), recebe/levanta/ataca, pula bloqueio contra
cortada humana (stuff/pingo). Rally longo exercita defesa da IA contra bola forte. **Zero erros.**

- [ ] **Step 5: Commit**

```bash
git add src/game/ai/AiController.ts src/game/Match.ts
git commit -m "refactor: extrai ai/AiController (agendamento + qualidade da IA) (1.5c)"
```

---

### Task 4 (1.5d): Enxugar `planNext` para o glue final

Depois das Tasks 2-3, `planNext` deve ficar: geometria + montagem do `TouchPlan` +
`camera('spike')`/`prepareBlock` + delegação. Limpar restos e conferir a forma final.

**Files:**
- Modify: `src/game/Match.ts`

- [ ] **Step 1: Reduzir `planNext` ao glue**

Forma alvo do trecho pós-plano (o `moveTo` do atacante — backoff — é geometria compartilhada;
mantê-lo, mas para a IA ele já vem de `scheduleApproach`; para o humano é o nudge inicial):

```ts
if (plan.kind === 'spike') {
  this.hooks.camera.setMode('spike');
  prepareBlock(this.ctx, otherSide(plan.side), cPoint.z, cT);
}

if (plan.isHuman) {
  // nudge inicial ao ponto (WASD assume depois); atacante já foi posicionado com backoff
  if (plan.kind === 'spike') {
    const backoff = sideSign(plan.side) * 0.85;
    plan.athlete.moveTo(cPoint.x + backoff * 0.9, cPoint.z);
  } else {
    plan.athlete.moveTo(cPoint.x, cPoint.z);
  }
  this.human.onAssigned(this.ctx, plan);
} else {
  this.ai.scheduleApproach(this.ctx, plan);
}

if (plan.kind === 'spike' && plan.side === TeamSide.AWAY) {
  this.human.assignBlock(this.home.nearestFrontRowTo(cPoint.z), this.ctx);
} else if (plan.side === TeamSide.AWAY) {
  this.human.idle(this.ctx);
}
```

> Confirmar que a ordem preserva o atual: setup humano/IA acontece após `prepareBlock`, e o
> `assignBlock` do caso cruzado sobrescreve o `ctl` corretamente (a IA ataca, humano bloqueia).

- [ ] **Step 2: `npm run check` + playtest completo**

Run: `npm run check` — verde. Playtest: ciclo completo nos dois lados, rally longo, set inteiro
até ponto/fim de set. **Zero erros de console.** Conferir `wc -l src/game/Match.ts` (~450-500).

- [ ] **Step 3: Commit**

```bash
git add src/game/Match.ts
git commit -m "refactor: planNext vira glue fino de delegacao (1.5d)"
```

---

## Self-Review

- **Spec coverage:** 1.5a→Task1; HumanController (estado+input+qualidade+assignment)→Task2;
  AiController (agendamento+qualidade+serve)→Task3; glue do planNext→Task4. `aim`/`chosenZone`
  via getter do ctx→Task2 Step5. Caso cruzado do bloqueio→Task2/Task4. Marker→Task2.
- **Desvio consciente do spec:** `serveShot` puro foi cortado (YAGNI: núcleo estocástico); a
  lógica do saque vive no `HumanController.update`. Registrado na Task 1.
- **Placeholders:** nenhum — código real em cada step; extrações mecânicas descrevem origem por
  linha.
- **Type consistency:** `reachQuality` humano recebe `(plan, hard, medium, ctx)`; IA recebe
  `(ctx, plan, hard)` (IA não usa `medium`). `onAssigned(ctx, plan)`, `assignBlock(blocker, ctx)`,
  `idle(ctx)`, `spikeQuality()` consistentes entre definição (Task2) e uso (Task4).

## Ordem & verificação

Cada Task = commit verde no `main`. `npm run check` + `/playtest` (porta 5199) após cada uma.
Nenhuma muda comportamento observável; se mudar, é bug → `superpowers:systematic-debugging`.
