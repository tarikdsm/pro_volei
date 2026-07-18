# Fase 4B — Locomotion e IK — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar vida ao rig da 4A: blend de locomoção direcional (parado/ajuste/corrida
frontal-lateral/freada), IK analítico de dois ossos para mãos/plataforma e pernas, foot planting
sem deslize e mãos que buscam o ponto de contato da bola — tudo apresentação pura, avançando
somente pelo `dt` recebido.

**Architecture:** Dois módulos puros novos em `src/entities/rig/` — `TwoBoneIK` (solver
analítico por lei dos cossenos) e `locomotion` (classificador de estado a partir da velocidade no
referencial da atleta) — consumidos pelo `RiggedCharacter`. O contrato `CharVisual` ganha dois
métodos **opcionais** (`setPlanarMotion?`, `setContactAim?`); `Athlete` os alimenta com dados que
já possui (velocity/facing) e as mecânicas passam o ponto analítico do contato junto dos `act()`
existentes. A simulação continua mandando: IK aproxima o corpo do contato, nunca move a bola.

**Tech Stack:** Three.js r185, TypeScript strict, Vitest — sem dependências novas.

## Global Constraints

- Apresentação pura e determinística: mesma sequência de chamadas ⇒ mesma pose; nada de
  `performance.now()`/`Math.random()`; `update(0)` não altera pose.
- Contrato `CharVisual` só cresce com métodos **opcionais** (headless/dublês de teste intactos).
- `game/` pode chamar os métodos novos apenas nos mesmos pontos onde já chama `act()`/escreve
  `moveSpeed` (fronteira existente); nenhuma regra/física muda.
- Aceite §5.3 usado como meta mensurável: pés plantados deslizam ≤ 0,15 m; mãos/plataforma a
  ≤ 0,12 m do ponto de contato nos toques padrão (bump/set/dig) quando o alvo está ao alcance.
- Orçamento: zero alocação por frame nos caminhos novos (vetores reutilizados como campos).
- Gates de sempre: `npm run check`, playtest real (viewports 1920×1080 e 844×390), push verde.

---

### Task 1: `TwoBoneIK` — solver analítico puro

**Files:**
- Create: `src/entities/rig/TwoBoneIK.ts`
- Test: `src/entities/rig/TwoBoneIK.test.ts`

**Interfaces:**

```ts
export interface TwoBoneSolution {
  /** Rotação do osso raiz (ombro/quadril) em torno do eixo de flexão local X. */
  rootPitch: number;
  /** Yaw do osso raiz apontando o plano da cadeia para o alvo. */
  rootYaw: number;
  /** Flexão da junta do meio (cotovelo/joelho), sempre ≤ 0 (dobra natural). */
  midFlex: number;
  /** true quando o alvo está além do alcance (cadeia estendida, alvo clampado). */
  clamped: boolean;
}

/**
 * Resolve a cadeia de dois ossos no referencial LOCAL do osso raiz (raiz na origem; descanso
 * apontando -y como no rig da 4A). `target` é o alvo no mesmo referencial; `l1`/`l2` são os
 * comprimentos dos ossos. Lei dos cossenos; sem iteração.
 */
export function solveTwoBoneIK(
  target: { x: number; y: number; z: number },
  l1: number,
  l2: number,
): TwoBoneSolution;
```

- [ ] **Step 1: Testes que falham** — casos: alvo no alcance exato reconstrói a posição da ponta
  com erro < 1e-6 (verificação forward-kinematics no próprio teste); alvo além do alcance ⇒
  `clamped=true` e ponta na direção do alvo à distância `l1+l2`; alvo colado na raiz ⇒ flexão
  máxima sem NaN; simetria: alvo espelhado em x ⇒ `rootYaw` espelhado.
- [ ] **Step 2: Ver falhar.** `npx vitest run src/entities/rig/TwoBoneIK.test.ts`
- [ ] **Step 3: Implementar** (lei dos cossenos: `d = |target|` clampado a `[|l1−l2|+ε, l1+l2]`;
  `midFlex = −(π − acos((l1²+l2²−d²)/(2·l1·l2)))`; `rootPitch/rootYaw` por `atan2` da direção
  do alvo mais o offset `acos((l1²+d²−l2²)/(2·l1·d))`).
- [ ] **Step 4: Ver passar. Step 5: Commit** — `feat(render): solver analitico de IK de dois ossos`

---

### Task 2: `locomotion` — classificador puro de estado de movimento

**Files:**
- Create: `src/entities/rig/locomotion.ts`
- Test: `src/entities/rig/locomotion.test.ts`

**Interfaces:**

```ts
export type LocomotionMode = 'idle' | 'adjust' | 'run' | 'brake';

export interface LocomotionState {
  mode: LocomotionMode;
  /** Direção da passada no referencial da atleta (rad; 0 = frente, +π/2 = esquerda). */
  strideYaw: number;
  /** Velocidade escalar planar (m/s) para o ritmo da passada. */
  speed: number;
  /** Inclinação do tronco na direção do movimento (rad, ≥0). */
  lean: number;
}

/**
 * Classifica o movimento no referencial da atleta. `forward`/`lateral` em m/s (frente = +),
 * `braking` = desaceleração ativa vinda do controle.
 */
export function classifyLocomotion(
  forward: number,
  lateral: number,
  braking: boolean,
): LocomotionState;
```

**Limiares:** speed < 0,35 ⇒ `idle`; 0,35–1,6 ⇒ `adjust` (passos curtos, lean 0);
> 1,6 ⇒ `run` (lean = min(0,3, speed·0,05)); `braking && speed > 1,6` ⇒ `brake`
(lean negativo −0,18 aplicado como recuo).

- [ ] **Step 1: Testes que falham** — cada faixa de limiar; `strideYaw` de puro lateral = ±π/2;
  determinismo trivial.
- [ ] **Step 2–4: TDD.** **Step 5: Commit** — `feat(render): classificador de locomocao direcional`

---

### Task 3: Contrato opcional novo + alimentação pelo `Athlete`

**Files:**
- Modify: `src/entities/PlayerCharacter.ts` (interface `CharVisual`: dois métodos opcionais)
- Modify: `src/game/Team.ts` (`Athlete.update` calcula e repassa; `aimContact()` novo)
- Modify: `src/game/mechanics/touch.ts` + `src/game/Match.ts` (chamar `athlete.aimContact` junto
  dos `act('bump'|'set'|'dive')` que têm `plan.point`)
- Test: `src/game/Team` via suíte existente + casos novos onde couber

**Interfaces:**

```ts
// CharVisual ganha (opcionais — dublês e HeadlessCharacter não precisam implementar):
setPlanarMotion?(forward: number, lateral: number, braking: boolean): void;
/** Alvo de contato no referencial do root da atleta; expira sozinho após `inSeconds`. */
setContactAim?(x: number, y: number, z: number, inSeconds: number): void;
```

- `Athlete.update`: converte `velocity` mundo → referencial local pelo `facing` e chama
  `char.setPlanarMotion?.(forward, lateral, braking)` (braking = alvo alcançado/parada).
- `Athlete.aimContact(point, inSeconds)`: converte ponto mundo → local (subtrai `pos`, rotaciona
  por `−facing`) e repassa a `char.setContactAim?.(…)`.
- Mecânicas: em `doPass`/`doSet`/`attemptContact` (peixinho), junto do `act(...)` existente,
  chamar `plan.athlete.aimContact(plan.point, 0)` — o ponto analítico já está ali.

- [ ] **Step 1:** Teste (Team.test ou novo): dublê de `CharVisual` com spies recebe
  `setPlanarMotion` com forward/lateral corretos para um facing conhecido.
- [ ] **Step 2–4: TDD.** **Step 5: Commit** — `feat(render): canal de locomocao e alvo de contato no CharVisual`

---

### Task 4: `RiggedCharacter` — locomoção direcional, foot planting e IK

**Files:**
- Modify: `src/entities/rig/RiggedCharacter.ts`
- Modify: `src/entities/rig/athletePoses.ts` (pose `run` ganha `strideYaw` como parâmetro)
- Test: `src/entities/rig/RiggedCharacter.test.ts`

**Comportamento:**
1. **Locomoção:** substitui o par idle/run binário: `classifyLocomotion` escolhe o modo;
   `run` usa `strideYaw` para orientar a passada (pernas pedalam na direção do movimento
   enquanto o tronco segue o facing); `adjust` = passos curtos (amplitude 0,35×);
   `brake` = pose de freada (joelhos flexionados, lean para trás). O `setAction` de gameplay
   (bump/set/spike/…) continua tendo prioridade sobre a locomoção, como hoje.
2. **Foot planting:** em `idle`/`adjust`, os pés guardam a posição de mundo do último plante e o
   IK de perna (Task 1, l1=0,42/l2=0,44) os mantém lá enquanto o root se move ≤ 0,25 m;
   além disso, replanta com um passo curto. Meta: deslize ≤ 0,15 m em quadros plantados
   (asserção no teste com root transladado 0,1 m).
3. **Mãos ao contato:** com `setContactAim` ativo (janela `inSeconds + 0,25 s`), braços usam IK
   (l1=0,26/l2=0,24) para levar as mãos ao alvo clampado, blendado 70/30 com a pose da ação —
   plataforma (bump/dig) junta as duas mãos no ponto; set separa ±0,09 m.
4. Nada de alocação por frame: alvos/temporários como campos `Vector3` reutilizados.

- [ ] **Step 1: Testes que falham** — (a) `setPlanarMotion(0, 3, false)` produz passada lateral:
  rotações de `thighL/R` em torno de X **e** yaw de passada ≠ corrida frontal; (b) foot
  planting: após plantar em idle e mover o root 0,1 m, a posição de mundo do pé muda ≤ 0,15 m;
  (c) `setContactAim` num alvo alcançável leva a mão (FK reconstruída no teste) a ≤ 0,12 m do
  alvo; (d) determinismo preservado (teste existente segue verde).
- [ ] **Step 2–4: TDD** (iterar até verde; manter os 13 testes atuais passando).
- [ ] **Step 5: Commit** — `feat(render): locomocao direcional, foot planting e IK na atleta`

---

### Task 5: Prova visual, gates e docs

- [ ] **Step 1:** `npx vitest run` + `npm run check` verdes.
- [ ] **Step 2:** Playtest (porta 5199): corrida lateral em recepção sem "moonwalk", pés sem
  deslize no idle, manchete com plataforma indo à bola; screenshots 1920×1080 e 844×390
  (`browser_resize`); console limpo; `__renderer` sem regressão de draw calls (≤ 240).
- [ ] **Step 3:** Docs (ROADMAP bullet 4B, plans README, CHANGELOG, CLAUDE.md marco → 4C) +
  commits + push + CI/Pages + smoke público, como na 4A.

## Self-Review

1. **Spec §5.3:** blend tree (Task 4.1), IK dois ossos mãos/pés (Tasks 1, 4.2, 4.3), foot
   planting ≤0,15 m (4.2), contato ≤0,12 m (4.3), aditivas de respiração/olhar ficam adiadas
   para 4C junto do elenco (baixo risco, decisão registrada), tempo por dt (constraints).
2. **Placeholders:** solver com fórmula fechada especificada; limiares numéricos definidos;
   testes descritos com asserções mensuráveis — código completo emerge no TDD de cada task.
3. **Tipos:** `TwoBoneSolution`/`LocomotionState` definidos na produção das Tasks 1–2 e
   consumidos na Task 4; contrato opcional definido na Task 3 e usado na Task 4.
