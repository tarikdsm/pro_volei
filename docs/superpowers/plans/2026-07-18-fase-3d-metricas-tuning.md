# Fase 3D — Métricas e Tuning das Dificuldades — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concluir o item 3 do design 2.0 — medir o balanceamento em baterias headless
determinísticas, implementar o formato de partida 2.0 (11/11/7 com caps), remover o multiplicador
físico legado `DIFFICULTIES.servePower` e ajustar os knobs de decisão até as faixas do §4.3/§3.2.

**Architecture:** Tudo se apoia na infraestrutura 3A–3C já entregue: `HeadlessRallyRunner`
(AI×AI determinístico), telemetria `SimulationTelemetryEvent`, `RandomHub` por streams e os knobs
estratégicos do `OpponentBrain`. A fase adiciona (1) regras puras de alvo/cap por set,
(2) um módulo puro `BalanceMetrics` (classificação de ponto, zonas, mediana/percentil),
(3) métricas novas no runner + `runMatches` para partidas completas e (4) dois testes-bateria que
viram gates de regressão do balanceamento. O tuning final mexe apenas em constantes de decisão —
nunca em física por dificuldade (critério 6 do design).

**Tech Stack:** TypeScript strict/ES2022, Vitest 4 (Node), sem dependências novas.

**Autorização:** o proprietário autorizou explicitamente a retomada (3D e depois 4A–4E) em
18/07/2026, encerrando a pausa registrada após a 3C.

## Global Constraints

- Fluxo **main-only**: commits pequenos e atômicos direto em `main`; sem branch, sem PR, sem
  amend/force-push. Push somente após `npm run check` verde local.
- **Determinismo:** mesma seed + mesmos inputs ⇒ mesmo resultado (30/60/120 Hz). Nenhum
  `Date.now`/`Math.random` em `game/`; todo sorteio via `RandomHub`.
- **Critério 6 do design 2.0:** dificuldade **não** altera física nem concede informação futura à
  CPU. Knobs permitidos: latência de percepção, memória, consistência técnica (probabilidades de
  erro), variedade tática. Proibido: velocidade, aceleração, potência, gravidade por dificuldade.
- **Formato 2.0 (§3.2, fixo):** melhor de 3; sets 1–2 a 11, set 3 a 7; diferença de 2; cap 15 nos
  sets iniciais e 11 no decisivo; no cap vence quem marcar o ponto. Tuning muda ritmo/erro, nunca o
  formato.
- **Faixas-alvo do Normal (§4.3, amostra ≥1.000 rallies / ≥20 seeds):** mediana de contatos por
  rally em [4, 8]; ≥65% dos pontos decididos por ataque/bloqueio/defesa forçada; nenhuma zona com
  >45% dos ataques. **Duração (§3.2, 30 partidas / ≥10 seeds):** mediana 8–12 min, p90 ≤ 15 min.
- Tuning centralizado em `src/core/constants.ts` e nos perfis de `OpponentBrain.ts`; zero números
  mágicos espalhados. Comentários em pt-BR; Prettier/ESLint 100 colunas.
- Zero URLs remotas em runtime (não há assets nesta fase).

---

### Task 1: Retomada — reconciliar docs e registrar autorização

**Files:**
- Modify: `docs/ROADMAP.md:7-11`, `docs/ROADMAP.md:64-69`
- Modify: `docs/superpowers/plans/README.md:7-8`, `docs/superpowers/plans/README.md:26-32`
- Modify: `docs/superpowers/specs/2026-07-12-pro-volei-2-0-design.md:5-11`
- Modify: `CLAUDE.md` (bloco "Marco atual" na seção "O que é")
- Create: (este arquivo já criado) `docs/superpowers/plans/2026-07-18-fase-3d-metricas-tuning.md`

**Interfaces:** nenhuma (documentação).

- [ ] **Step 1: ROADMAP — estado atual**

Em `docs/ROADMAP.md`, substituir (l. 10-11):

```markdown
Por decisão do proprietário, o desenvolvimento está **pausado após a Fase 3C**. A 3D e todas as
fases seguintes permanecem fora de execução até uma nova autorização explícita.
```

por:

```markdown
Em 18/07/2026 o proprietário autorizou explicitamente a retomada: a **Fase 3D está em execução**
e, na sequência, as subfases 4A–4E (personagens e render). Fases 5–7 continuam aguardando a
conclusão dessas etapas.
```

E substituir o bloco "Marco atual — pausa após a IA coletiva" (l. 64-69) por:

```markdown
### Marco atual — Fase 3D em execução

- **Entregue:** Fases 1A–1D, 2A–2E e 3A–3C.
- **Em execução:** 3D (métricas e tuning das dificuldades), autorizada em 18/07/2026 junto com
  4A–4E na sequência.
- **Não iniciado:** Fases 4–7 do design 2.0 (4A–4E autorizadas; 5–7 aguardam).
- O índice canônico dos planos e suas evidências está em
  [`superpowers/plans/README.md`](superpowers/plans/README.md).
```

- [ ] **Step 2: Índice de planos**

Em `docs/superpowers/plans/README.md`, substituir (l. 7-8):

```markdown
**Marco atual — 13/07/2026:** Fases 1–2 e subfases 3A–3C entregues; desenvolvimento pausado antes da 3D. Não há
plano ativo. A 3D e todas as fases seguintes aguardam nova autorização explícita do proprietário.
```

por:

```markdown
**Marco atual — 18/07/2026:** Fases 1–2 e 3A–3C entregues. O proprietário autorizou a retomada:
o plano ativo é a Fase 3D; as subfases 4A–4E estão autorizadas na sequência.
```

Adicionar à tabela, após a linha da 3C:

```markdown
| [`2026-07-18-fase-3d-metricas-tuning.md`](2026-07-18-fase-3d-metricas-tuning.md) | em execução | Formato 2.0, métricas de balanceamento, remoção do servePower legado e tuning §4.3/§3.2 |
```

E substituir a seção "## Pausa de desenvolvimento" inteira (l. 26-32) por:

```markdown
## Retomada de desenvolvimento

- Autorização explícita do proprietário em 18/07/2026 cobre a Fase 3D e as subfases 4A–4E, nesta
  ordem, cada uma com plano detalhado antes de alterar produção.
- Fases 5–7 do design 2.0 permanecem aguardando o término dessas etapas.
```

- [ ] **Step 3: Nota de status da spec**

Em `docs/superpowers/specs/2026-07-12-pro-volei-2-0-design.md`, substituir (l. 5):

```markdown
**Status:** aprovado; Fases 1–2 e subfases 3A–3C entregues; execução pausada antes da 3D
```

por:

```markdown
**Status:** aprovado; Fases 1–2 e 3A–3C entregues; 3D em execução desde 18/07/2026 (4A–4E
autorizadas na sequência)
```

E no callout seguinte (l. 7-11), trocar a frase «A 3D e as Fases 4–7 abaixo continuam parte do
design aprovado, mas **não estão em execução** e não devem ser iniciadas sem nova autorização
explícita.» por «A 3D está em execução e as subfases 4A–4E estão autorizadas na sequência
(18/07/2026); as Fases 5–7 continuam aguardando.»

- [ ] **Step 4: CLAUDE.md — marco atual**

Na seção "O que é" do `CLAUDE.md`, substituir o item:

```markdown
- **Marco atual:** Fases 1–2 e subfases 3A–3C da evolução 2.0 concluídas. O desenvolvimento está pausado depois da
  Fase 3C; não iniciar 3D, arte/render, áudio/mobile, Copa ou release sem uma nova solicitação
  explícita do proprietário. Estado canônico em [docs/ROADMAP.md](docs/ROADMAP.md).
```

por:

```markdown
- **Marco atual:** Fases 1–2 e 3A–3C concluídas; **Fase 3D em execução** (métricas e tuning),
  com 4A–4E autorizadas na sequência (18/07/2026). Áudio/mobile, Copa e release (Fases 5–7)
  seguem aguardando autorização. Estado canônico em [docs/ROADMAP.md](docs/ROADMAP.md).
```

- [ ] **Step 5: Gates e commit**

Run: `npm run lint && npm run format:check`
Expected: sem erros (docs não afetam typecheck/testes).

```bash
git add docs/ROADMAP.md docs/superpowers/plans/README.md docs/superpowers/plans/2026-07-18-fase-3d-metricas-tuning.md "docs/superpowers/specs/2026-07-12-pro-volei-2-0-design.md" CLAUDE.md
git commit -m "docs(projeto): registra retomada autorizada e plano da fase 3d"
```

---

### Task 2: Regras puras — alvo por set e cap (`scoring.ts`)

**Files:**
- Modify: `src/game/rules/scoring.ts:5-47`
- Modify: `src/core/constants.ts:315-318` (tipo `MatchFormat` + entradas)
- Test: `src/game/rules/scoring.test.ts`

**Interfaces:**
- Consumes: `isDecidingSet(setNumber, totalSets)` (já existe em `scoring.ts:29`).
- Produces (usadas nas Tasks 3, 7 e 8):
  - `interface MatchFormat { name: string; sets: number; pointsPerSet: number; decidingPoints: number; cap: number | null; decidingCap: number | null }` e `type SetScoringFormat = Omit<MatchFormat, 'name'>` em `core/constants.ts`;
  - `setTargets(format: SetScoringFormat, setNumber: number): { target: number; cap: number | null }`;
  - `isSetOver(h, a, target, cap?: number | null)` e `setPointLeader(h, a, target, cap?: number | null)` com cap opcional (default `null` preserva assinatura legada).

- [ ] **Step 1: Testes que falham**

Adicionar a `src/game/rules/scoring.test.ts`:

```ts
describe('formato 2.0 — alvo por set e cap', () => {
  const FORMAT_2_0 = { sets: 3, pointsPerSet: 11, decidingPoints: 7, cap: 15, decidingCap: 11 };

  it('setTargets devolve alvo/cap dos sets iniciais e do decisivo', () => {
    expect(setTargets(FORMAT_2_0, 1)).toEqual({ target: 11, cap: 15 });
    expect(setTargets(FORMAT_2_0, 2)).toEqual({ target: 11, cap: 15 });
    expect(setTargets(FORMAT_2_0, 3)).toEqual({ target: 7, cap: 11 });
    expect(setTargets({ ...FORMAT_2_0, sets: 1 }, 1)).toEqual({ target: 7, cap: 11 });
  });

  it('isSetOver fecha por alvo com 2 de vantagem e por cap com vantagem mínima', () => {
    expect(isSetOver(11, 9, 11, 15)).toBe(true);
    expect(isSetOver(11, 10, 11, 15)).toBe(false);
    expect(isSetOver(14, 14, 11, 15)).toBe(false);
    expect(isSetOver(15, 14, 11, 15)).toBe(true); // no cap vence quem marca o ponto
    expect(isSetOver(11, 7, 7, 11)).toBe(true); // cap do set decisivo
  });

  it('isSetOver sem cap preserva o comportamento legado', () => {
    expect(isSetOver(25, 23, 25)).toBe(true);
    expect(isSetOver(25, 24, 25)).toBe(false);
    expect(isSetOver(26, 24, 25)).toBe(true);
  });

  it('setPointLeader considera o cap', () => {
    expect(setPointLeader(14, 13, 11, 15)).toBe(TeamSide.HOME); // 15-13 fecharia pelo cap
    expect(setPointLeader(13, 14, 11, 15)).toBe(TeamSide.AWAY);
    expect(setPointLeader(14, 14, 11, 15)).toBe(null);
    expect(setPointLeader(10, 9, 11, 15)).toBe(TeamSide.HOME);
    expect(setPointLeader(9, 5, 11, 15)).toBe(null);
    expect(setPointLeader(24, 10, 25)).toBe(TeamSide.HOME); // legado sem cap
  });
});
```

(Importar `setTargets` no topo do arquivo de teste.)

- [ ] **Step 2: Verificar que falham**

Run: `npx vitest run src/game/rules/scoring.test.ts`
Expected: FAIL — `setTargets` não existe; `isSetOver(15, 14, 11, 15)` retorna `false`.

- [ ] **Step 3: Implementação**

Em `src/core/constants.ts`, substituir (l. 315-318):

```ts
export const MATCH_FORMATS = [
  { name: 'Rápida — 1 set de 15', sets: 1, pointsPerSet: 15 },
  { name: 'Clássica — melhor de 3 a 25', sets: 3, pointsPerSet: 25 },
];
```

por:

```ts
/**
 * Formato de partida: alvo dos sets iniciais, alvo do set decisivo e caps (§3.2 do design 2.0).
 * `cap === null` significa sem teto (vantagem de 2 obrigatória, formato legado).
 */
export interface MatchFormat {
  name: string;
  sets: number;
  pointsPerSet: number; // alvo dos sets não decisivos
  decidingPoints: number; // alvo do set decisivo
  cap: number | null; // teto dos sets não decisivos
  decidingCap: number | null; // teto do set decisivo
}

/** Fatia do formato usada pelas regras puras (sem o nome de exibição). */
export type SetScoringFormat = Omit<MatchFormat, 'name'>;

export const MATCH_FORMATS: MatchFormat[] = [
  {
    name: 'Oficial 2.0 — melhor de 3 (11·11·7)',
    sets: 3,
    pointsPerSet: 11,
    decidingPoints: 7,
    cap: 15,
    decidingCap: 11,
  },
  { name: 'Rápida — 1 set de 15', sets: 1, pointsPerSet: 15, decidingPoints: 15, cap: null, decidingCap: null },
  { name: 'Clássica — melhor de 3 a 25', sets: 3, pointsPerSet: 25, decidingPoints: 25, cap: null, decidingCap: null },
];
```

Em `src/game/rules/scoring.ts`:

```ts
import {
  COURT,
  BALL_RADIUS,
  TeamSide,
  otherSide,
  TouchKind,
  type SetScoringFormat,
} from '../../core/constants';

/** Alvo e cap do set corrente: sets decisivos usam decidingPoints/decidingCap. */
export function setTargets(
  format: SetScoringFormat,
  setNumber: number,
): { target: number; cap: number | null } {
  return isDecidingSet(setNumber, format.sets)
    ? { target: format.decidingPoints, cap: format.decidingCap }
    : { target: format.pointsPerSet, cap: format.cap };
}

/**
 * Set encerra ao atingir o alvo com 2 de vantagem, ou ao atingir o cap com qualquer vantagem
 * ("no cap, vence quem marcar o ponto" — §3.2 do design 2.0). `cap === null` = sem teto.
 */
export function isSetOver(h: number, a: number, target: number, cap: number | null = null): boolean {
  if (cap !== null && (h >= cap || a >= cap) && h !== a) return true;
  return (h >= target || a >= target) && Math.abs(h - a) >= 2;
}

/**
 * Líder em situação de set point: quem fecha o set se marcar o próximo ponto.
 * Empate não gera set point; se o set já acabou, retorna null.
 */
export function setPointLeader(
  h: number,
  a: number,
  target: number,
  cap: number | null = null,
): TeamSide | null {
  if (isSetOver(h, a, target, cap)) return null;
  if (h === a) return null;
  const leader = h > a ? TeamSide.HOME : TeamSide.AWAY;
  const nh = leader === TeamSide.HOME ? h + 1 : h;
  const na = leader === TeamSide.AWAY ? a + 1 : a;
  return isSetOver(nh, na, target, cap) ? leader : null;
}
```

(As demais funções do arquivo permanecem como estão; `isDecidingSet` deve ficar declarada antes de
`setTargets` ou o hoisting de function declarations resolve — manter como function declarations.)

- [ ] **Step 4: Verificar que passam**

Run: `npx vitest run src/game/rules/scoring.test.ts`
Expected: PASS, incluindo os testes legados intactos.

- [ ] **Step 5: Commit**

```bash
git add src/core/constants.ts src/game/rules/scoring.ts src/game/rules/scoring.test.ts
git commit -m "feat(regras): alvo por set e cap do formato 2.0"
```

---

### Task 3: Formato 2.0 no fluxo de set/partida (`SetMatch`) e fixtures

**Files:**
- Modify: `src/game/rules/SetMatch.ts:40,131-146`
- Test: `src/game/rules/SetMatch.test.ts:45,133,203` (harness + casos novos)
- Modify (se a suíte apontar): fixtures que assumem o formato default antigo, p.ex.
  `src/game/simulation/HeadlessRallyRunner.test.ts`, `src/game/Match.headless.test.ts`

**Interfaces:**
- Consumes: `setTargets`, `isSetOver(h, a, target, cap)`, `setPointLeader(h, a, target, cap)`,
  `SetScoringFormat` (Task 2).
- Produces: `ScoringCtx.format: SetScoringFormat` — todo criador de `ScoringCtx` passa os cinco
  campos. `MATCH_FORMATS[0]` agora é o formato 2.0 (default do `Match` e do runner headless).

- [ ] **Step 1: Testes que falham**

Em `src/game/rules/SetMatch.test.ts`, estender o harness: onde o options object monta
`format: { sets: o.formatSets ?? 3, pointsPerSet: 25 }` (l. 45) usar:

```ts
format: {
  sets: o.formatSets ?? 3,
  pointsPerSet: o.pointsPerSet ?? 25,
  decidingPoints: o.decidingPoints ?? o.pointsPerSet ?? 25,
  cap: o.cap ?? null,
  decidingCap: o.decidingCap ?? null,
},
```

(idem no segundo harness, l. 203, mantendo os defaults atuais `sets 1` / `pointsPerSet 15`), e
declarar os novos campos opcionais (`decidingPoints?: number; cap?: number | null;
decidingCap?: number | null`) no tipo de options (l. 133). Adicionar os casos:

```ts
it('cap 15 fecha o set em 15-14 sem exigir 2 de vantagem', () => {
  const t = makeCtx({ formatSets: 3, pointsPerSet: 11, decidingPoints: 7, cap: 15, decidingCap: 11 });
  t.ctx.score[0] = 14;
  t.ctx.score[1] = 14;
  awardPoint(t.ctx, TeamSide.HOME, 'teste');
  t.runScheduled(); // executa o after(2.6) agendado
  expect(t.ctx.sets[0]).toBe(1); // endSet ocorreu
});

it('set decisivo usa alvo 7 com cap 11', () => {
  const t = makeCtx({ formatSets: 3, pointsPerSet: 11, decidingPoints: 7, cap: 15, decidingCap: 11 });
  t.ctx.setNumber = 3;
  t.ctx.score[0] = 6;
  t.ctx.score[1] = 4;
  awardPoint(t.ctx, TeamSide.HOME, 'teste'); // 7-4 fecha por alvo+2
  t.runScheduled();
  expect(t.ctx.sets[0]).toBe(1);
});
```

(Usar os helpers existentes do arquivo — `makeCtx`/execução dos callbacks agendados — com os nomes
reais que o harness local já expõe; os dois testes acima devem seguir exatamente o padrão dos
testes vizinhos de fim de set.)

- [ ] **Step 2: Verificar que falham**

Run: `npx vitest run src/game/rules/SetMatch.test.ts`
Expected: FAIL — typecheck do harness (campos novos) e/ou `sets[0]` continua 0 no caso do cap.

- [ ] **Step 3: Implementação**

Em `src/game/rules/SetMatch.ts`:

1. Trocar o tipo do formato (l. 40):

```ts
import type { SetScoringFormat } from '../../core/constants';
// ...
readonly format: SetScoringFormat;
```

2. Em `awardPoint`, substituir (l. 131-133):

```ts
const target = ctx.format.pointsPerSet;
const [h, a] = ctx.score;
const setOver = isSetOver(h, a, target);
```

por:

```ts
const { target, cap } = setTargets(ctx.format, ctx.setNumber);
const [h, a] = ctx.score;
const setOver = isSetOver(h, a, target, cap);
```

3. E na checagem de set point (l. 140): `const spLeader = setPointLeader(h, a, target, cap);`
4. Importar `setTargets` junto dos demais imports de `./scoring`.

- [ ] **Step 4: Suíte completa + fixtures do novo default**

Run: `npx vitest run`
Expected: `SetMatch.test.ts` PASS. Como `MATCH_FORMATS[0]` passou a ser o formato 2.0 (default do
`Match.startMatch` e do runner headless), testes que assumiam "1 set de 15" no formato default
podem falhar em asserts de placar/estrutura. Corrigir **apenas fixtures/expectativas** (nunca
regras): ou passando `format: 1` explícito onde o teste quer o formato Rápida legado, ou
atualizando o valor esperado. Arquivos prováveis: `src/game/simulation/HeadlessRallyRunner.test.ts`,
`src/game/Match.headless.test.ts`, `src/game/MatchTeamTactics.test.ts`. Testes de determinismo
(hash comparado entre duas execuções da mesma seed) não precisam de mudança.

- [ ] **Step 5: Commit**

```bash
git add src/game/rules/SetMatch.ts src/game/rules/SetMatch.test.ts src/core/constants.ts
git add -u src/game
git commit -m "feat(regras): partida oficial 2.0 melhor de 3 (11·11·7 com cap)"
```

---

### Task 4: Remover o multiplicador físico legado `DIFFICULTIES.servePower`

**Files:**
- Modify: `src/core/constants.ts:61-103` (interface `Difficulty` + entradas) e
  `src/core/constants.ts:151-158` (`STRATEGIC_SERVE_TUNING`)
- Modify: `src/game/mechanics/serve.ts:73`
- Test: `src/game/mechanics/serve.test.ts:52,322-354`

**Interfaces:**
- Consumes: `STRATEGIC_SERVE_TUNING` (constants), `lerp` (math3d).
- Produces: `STRATEGIC_SERVE_TUNING.basePower: readonly [number, number]` — faixa única de
  potência de saque, independente de dificuldade. `Difficulty` perde o campo `servePower`.

- [ ] **Step 1: Teste que falha (invariância física)**

Em `src/game/mechanics/serve.test.ts`, substituir o teste `'compõe dificuldade no power e altera
tempo/velocidade com os mesmos draws'` (l. 322-354) por:

```ts
it('potência do saque é idêntica em todas as dificuldades com os mesmos draws', () => {
  const results: StrategicServeRealization[] = [];
  for (const difficulty of DIFFICULTIES) {
    const sample = makeCtx([0.4], [0.5, 0.99, 0.5, 0.5, 0.5, 0.5]);
    sample.ctx.diff = difficulty;
    performStrategicServe(sample.ctx, sample.server, directive('float-deep'), {
      guard: () => true,
      onLaunched: (_ref, value) => {
        results.push(value);
        return true;
      },
    });
    runCallbacks(sample.scheduled);
    expect(sample.contact.draws).toBe(6);
    expect(sample.ai.draws).toBe(0);
  }
  // Critério 6 do design 2.0: dificuldade não altera a física do saque.
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
});
```

- [ ] **Step 2: Verificar que falha**

Run: `npx vitest run src/game/mechanics/serve.test.ts`
Expected: FAIL — powers diferem entre dificuldades (0.3–0.55 vs 0.5–0.8 vs 0.7–0.98).

- [ ] **Step 3: Implementação**

1. `src/core/constants.ts` — na interface `Difficulty` (l. 61-70), remover a linha
   `servePower: [number, number];` e atualizar o comentário do bloco para registrar o critério:

```ts
/**
 * Knobs de dificuldade da CPU. Critério 6 do design 2.0: dificuldade NÃO altera física —
 * apenas latência de reação, consistência técnica (probabilidades de erro/qualidade) e
 * decisão. Potência de saque vive em STRATEGIC_SERVE_TUNING.basePower, única para todos.
 */
export interface Difficulty {
  name: string;
  reactionDelay: number; // s até a IA reagir à trajetória
  passQuality: [number, number]; // faixa de qualidade de passe [min,max]
  attackError: number; // prob. de erro no ataque (rede/fora)
  serveError: number; // prob. de erro no saque
  blockChance: number; // prob. de tentar/acertar bloqueio
  digChance: number; // prob. de defender um ataque forte
}
```

2. Remover `servePower: [...]` das três entradas de `DIFFICULTIES` (l. 79, 89, 99).
3. Em `STRATEGIC_SERVE_TUNING` (l. 151), adicionar após `drawBudget: 6,`:

```ts
basePower: [0.5, 0.8] as const, // faixa única (ex-Normal); dificuldade não altera física
```

4. `src/game/mechanics/serve.ts:73` — substituir:

```ts
const basePower = lerp(ctx.diff.servePower[0], ctx.diff.servePower[1], powerDraw);
```

por:

```ts
const basePower = lerp(
  STRATEGIC_SERVE_TUNING.basePower[0],
  STRATEGIC_SERVE_TUNING.basePower[1],
  powerDraw,
);
```

5. `src/game/mechanics/serve.test.ts:52` — fixture vira `diff: { serveError: 0.25 },`.

- [ ] **Step 4: Verificar que passa + typecheck amplo**

Run: `npx vitest run src/game/mechanics/serve.test.ts && npm run typecheck`
Expected: PASS; typecheck acusa qualquer outra leitura residual de `servePower` (não deve haver —
grep confirmou que só `serve.ts:73` lia o campo).

- [ ] **Step 5: Commit**

```bash
git add src/core/constants.ts src/game/mechanics/serve.ts src/game/mechanics/serve.test.ts
git commit -m "feat(ia): remove multiplicador fisico legado servePower"
```

---

### Task 5: Módulo puro `BalanceMetrics`

**Files:**
- Create: `src/game/simulation/BalanceMetrics.ts`
- Test: `src/game/simulation/BalanceMetrics.test.ts`

**Interfaces:**
- Consumes: `ATTACK_ZONES`, `TeamSide`, `otherSide`, `TouchKind` (constants); `PointCause`
  (SimulationTelemetry). **Não** importa nada do runner (evita ciclo).
- Produces (usadas nas Tasks 6 e 8):
  - `type PointClass = 'decisive' | 'unforced'`
  - `interface RallyTouch { readonly side: TeamSide; readonly kind: TouchKind | 'block-touch' }`
  - `classifyPoint(input: PointClassificationInput): PointClass`
  - `attackZoneIndex(side: TeamSide, contactZ: number): 0 | 1 | 2`
  - `median(values: readonly number[]): number` e `percentile(values: readonly number[], p: number): number`
  - `buildBalanceReport(samples: readonly BalanceRallySample[]): BalanceReport`

- [ ] **Step 1: Testes que falham**

Criar `src/game/simulation/BalanceMetrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  attackZoneIndex,
  buildBalanceReport,
  classifyPoint,
  median,
  percentile,
  type BalanceRallySample,
} from './BalanceMetrics';

const H = TeamSide.HOME;
const A = TeamSide.AWAY;

describe('classifyPoint', () => {
  const base = { cause: 'floor-in', ace: false, winner: H, lastTouchSide: H, lastKind: 'spike', touches: [] } as const;

  it('ace e cortada vencedora são decisivos', () => {
    expect(classifyPoint({ ...base, ace: true })).toBe('decisive');
    expect(classifyPoint({ ...base })).toBe('decisive');
    expect(classifyPoint({ ...base, lastKind: 'block' })).toBe('decisive');
  });

  it('saque na rede e bola de graça no chão rival são erro gratuito', () => {
    expect(classifyPoint({ ...base, cause: 'serve-net', lastTouchSide: A, lastKind: 'serve' })).toBe('unforced');
    expect(classifyPoint({ ...base, lastKind: 'freeball' })).toBe('unforced');
  });

  it('defesa sob ataque que erra é ponto forçado (decisivo)', () => {
    expect(
      classifyPoint({ ...base, cause: 'floor-out', winner: H, lastTouchSide: A, lastKind: 'dig' }),
    ).toBe('decisive');
    expect(
      classifyPoint({
        ...base,
        cause: 'floor-out',
        winner: H,
        lastTouchSide: A,
        lastKind: 'pass',
        touches: [{ side: H, kind: 'serve' }, { side: A, kind: 'pass' }],
      }),
    ).toBe('decisive');
  });

  it('ataque para fora sem toque de bloqueio é erro gratuito; com toque é decisivo', () => {
    const rallyOut = {
      ...base,
      cause: 'floor-out',
      winner: H,
      lastTouchSide: A,
      lastKind: 'spike',
    } as const;
    expect(classifyPoint({ ...rallyOut, touches: [{ side: A, kind: 'spike' }] })).toBe('unforced');
    expect(
      classifyPoint({
        ...rallyOut,
        touches: [{ side: A, kind: 'spike' }, { side: H, kind: 'block-touch' }],
      }),
    ).toBe('decisive');
  });

  it('saque direto para fora é erro gratuito', () => {
    expect(
      classifyPoint({ ...base, cause: 'floor-out', winner: A, lastTouchSide: H, lastKind: 'serve' }),
    ).toBe('unforced');
  });
});

describe('attackZoneIndex', () => {
  it('classifica pela zona no referencial da atacante', () => {
    expect(attackZoneIndex(H, -3.0)).toBe(0);
    expect(attackZoneIndex(H, 0.4)).toBe(1);
    expect(attackZoneIndex(H, 2.9)).toBe(2);
    // AWAY olha para a rede do lado oposto: z mundial positivo é a esquerda dela.
    expect(attackZoneIndex(A, 3.0)).toBe(0);
    expect(attackZoneIndex(A, -3.0)).toBe(2);
  });
});

describe('median/percentile', () => {
  it('interpola linearmente', () => {
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2, 3])).toBe(2);
    expect(percentile([10, 20, 30, 40], 0.9)).toBeCloseTo(37, 10);
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });
});

describe('buildBalanceReport', () => {
  it('agrega mediana de contatos, share decisivo e shares de zona', () => {
    const zones = (h: [number, number, number], a: [number, number, number]) => [h, a] as const;
    const samples: BalanceRallySample[] = [
      { winner: H, contacts: 4, pointClass: 'decisive', attackZones: zones([1, 0, 0], [0, 1, 0]) },
      { winner: A, contacts: 6, pointClass: 'decisive', attackZones: zones([0, 1, 0], [1, 0, 0]) },
      { winner: H, contacts: 8, pointClass: 'unforced', attackZones: zones([0, 0, 1], [0, 0, 1]) },
      { winner: A, contacts: 2, pointClass: 'decisive', attackZones: zones([1, 0, 0], [0, 1, 0]) },
    ];
    const report = buildBalanceReport(samples);
    expect(report.rallies).toBe(4);
    expect(report.contactsMedian).toBe(5);
    expect(report.decisiveShare).toBe(0.75);
    expect(report.unforcedBySide).toEqual([0, 1]); // AWAY entregou o ponto unforced do HOME? não: vencedor H ⇒ quem errou foi A
    expect(report.zoneShares[0]).toEqual([0.5, 0.25, 0.25]);
    expect(report.maxZoneShare).toBe(0.5);
    expect(() => buildBalanceReport([])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Verificar que falham**

Run: `npx vitest run src/game/simulation/BalanceMetrics.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementação**

Criar `src/game/simulation/BalanceMetrics.ts`:

```ts
// Métricas puras de balanceamento (Fase 3D): classificação de ponto, zonas de ataque e
// agregados estatísticos das metas do §4.3 do design 2.0. Sem estado; não importa o runner.
import { ATTACK_ZONES, TeamSide, otherSide, type TouchKind } from '../../core/constants';
import type { PointCause } from './SimulationTelemetry';

export type PointClass = 'decisive' | 'unforced';

export interface RallyTouch {
  readonly side: TeamSide;
  readonly kind: TouchKind | 'block-touch';
}

export interface PointClassificationInput {
  readonly cause: PointCause;
  readonly ace: boolean;
  readonly winner: TeamSide;
  readonly lastTouchSide: TeamSide | null;
  readonly lastKind: TouchKind | null;
  /** Contatos + toques de bloqueio do rally, em ordem de tick. */
  readonly touches: readonly RallyTouch[];
}

/**
 * Ponto "decisive" = decidido por ataque, bloqueio ou defesa forçada; "unforced" = erro
 * gratuito (meta: ≥65% decisivos). Determinístico a partir da telemetria do rally.
 */
export function classifyPoint(input: PointClassificationInput): PointClass {
  const { cause, ace, winner, lastTouchSide, lastKind, touches } = input;
  if (ace) return 'decisive';
  if (cause === 'serve-net' || cause === 'other') return 'unforced';
  if (lastTouchSide === winner) {
    // Bola do vencedor decidiu o rally: cortada/bloqueio fecham por decisão ofensiva.
    return lastKind === 'spike' || lastKind === 'block' ? 'decisive' : 'unforced';
  }
  // Erro do lado perdedor: forçado quando o toque errado foi defesa sob ataque,
  // recepção estourada por saque/cortada, ou cortada desviada pelo bloqueio rival.
  if (lastKind === 'dig' || lastKind === 'block') return 'decisive';
  if (lastKind === 'pass' && lastTouchSide !== null) {
    const prior = [...touches].reverse().find((touch) => touch.side !== lastTouchSide);
    if (prior && (prior.kind === 'serve' || prior.kind === 'spike')) return 'decisive';
  }
  if (lastKind === 'spike' && lastTouchSide !== null) {
    const last = touches.at(-1);
    if (last && last.kind === 'block-touch' && last.side !== lastTouchSide) return 'decisive';
  }
  return 'unforced';
}

/** Zona de origem do ataque no referencial da atacante: 0 = esquerda, 1 = centro, 2 = direita. */
export function attackZoneIndex(side: TeamSide, contactZ: number): 0 | 1 | 2 {
  const attackerZ = side === TeamSide.HOME ? contactZ : -contactZ;
  const half = (ATTACK_ZONES[2] - ATTACK_ZONES[1]) / 2;
  return attackerZ < -half ? 0 : attackerZ > half ? 2 : 1;
}

/** Percentil p ∈ [0,1] com interpolação linear entre vizinhos; lança em lista vazia. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile exige pelo menos um valor');
  if (!(p >= 0 && p <= 1)) throw new RangeError('p deve estar em [0,1]');
  const sorted = [...values].sort((left, right) => left - right);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Mediana (percentil 0,5). */
export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

export interface BalanceRallySample {
  readonly winner: TeamSide;
  readonly contacts: number;
  readonly pointClass: PointClass;
  /** Contagem de ataques por zona [esq, centro, dir], indexada por lado [HOME, AWAY]. */
  readonly attackZones: readonly (readonly [number, number, number])[];
}

export interface BalanceReport {
  readonly rallies: number;
  readonly contactsMedian: number;
  readonly decisiveShare: number;
  /** Pontos entregues de graça por cada lado (erro unforced do lado perdedor). */
  readonly unforcedBySide: readonly [number, number];
  readonly zoneShares: readonly (readonly [number, number, number])[];
  readonly maxZoneShare: number;
}

/** Consolida amostras (uma por ponto) nas metas mensuráveis do §4.3. */
export function buildBalanceReport(samples: readonly BalanceRallySample[]): BalanceReport {
  if (samples.length === 0) throw new RangeError('buildBalanceReport exige pelo menos um rally');
  const zoneTotals: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  const unforced: [number, number] = [0, 0];
  let decisive = 0;
  for (const sample of samples) {
    if (sample.pointClass === 'decisive') decisive += 1;
    else unforced[otherSide(sample.winner)] += 1;
    for (const side of [TeamSide.HOME, TeamSide.AWAY]) {
      for (let zone = 0; zone < 3; zone += 1) {
        zoneTotals[side][zone] += sample.attackZones[side][zone];
      }
    }
  }
  const zoneShares = zoneTotals.map((zones) => {
    const total = zones[0] + zones[1] + zones[2];
    return total === 0
      ? ([0, 0, 0] as const)
      : ([zones[0] / total, zones[1] / total, zones[2] / total] as const);
  });
  return Object.freeze({
    rallies: samples.length,
    contactsMedian: median(samples.map((sample) => sample.contacts)),
    decisiveShare: decisive / samples.length,
    unforcedBySide: Object.freeze(unforced) as unknown as readonly [number, number],
    zoneShares: Object.freeze(zoneShares),
    maxZoneShare: Math.max(...zoneShares.flat()),
  });
}
```

- [ ] **Step 4: Verificar que passam**

Run: `npx vitest run src/game/simulation/BalanceMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/simulation/BalanceMetrics.ts src/game/simulation/BalanceMetrics.test.ts
git commit -m "feat(simulacao): metricas puras de balanceamento"
```

---

### Task 6: Métricas novas no `HeadlessRallyRunner`

**Files:**
- Modify: `src/game/simulation/HeadlessRallyRunner.ts:62-113` (interfaces) e `514-583`
  (`summarizeRallies`) e `242-292` (agregados do batch)
- Test: `src/game/simulation/HeadlessRallyRunner.test.ts`

**Interfaces:**
- Consumes: `classifyPoint`, `attackZoneIndex`, `RallyTouch`, `PointClass` (Task 5).
- Produces: `HeadlessRallySummary` ganha `sideOut: boolean`, `pointClass: PointClass`,
  `attackZones: readonly (readonly [number, number, number])[]`; `HeadlessBatchResult` ganha
  `sideOuts: readonly [number, number]`, `unforcedErrors: readonly [number, number]`,
  `attackZoneTotals: readonly (readonly [number, number, number])[]`.

- [ ] **Step 1: Teste que falha**

Adicionar a `src/game/simulation/HeadlessRallyRunner.test.ts`:

```ts
it('resume side-outs, classe do ponto e zonas de ataque por rally', () => {
  const batch = runHeadlessBatch({ seed: 0x3d00_00aa, rallies: 12 });
  const sideOuts: [number, number] = [0, 0];
  const unforced: [number, number] = [0, 0];
  const zoneTotals = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const rally of batch.rallies) {
    expect(typeof rally.sideOut).toBe('boolean');
    expect(rally.sideOut).toBe(rally.winner !== rally.serving);
    expect(['decisive', 'unforced']).toContain(rally.pointClass);
    if (rally.sideOut) sideOuts[rally.winner] += 1;
    if (rally.pointClass === 'unforced') unforced[otherSide(rally.winner)] += 1;
    for (const side of [0, 1]) {
      const zones = rally.attackZones[side];
      expect(zones[0] + zones[1] + zones[2]).toBe(rally.attacks[side]);
      for (let zone = 0; zone < 3; zone += 1) zoneTotals[side][zone] += zones[zone];
    }
  }
  expect(batch.sideOuts).toEqual(sideOuts);
  expect(batch.unforcedErrors).toEqual(unforced);
  expect(batch.attackZoneTotals).toEqual(zoneTotals);
});
```

(Importar `otherSide` de `../../core/constants` se ainda não estiver importado.)

- [ ] **Step 2: Verificar que falha**

Run: `npx vitest run src/game/simulation/HeadlessRallyRunner.test.ts -t 'side-outs'`
Expected: FAIL — campos inexistentes.

- [ ] **Step 3: Implementação**

1. Nas interfaces (l. 62-99), adicionar a `HeadlessRallySummary`:

```ts
readonly sideOut: boolean; // vencedor foi quem recebia o saque
readonly pointClass: PointClass;
/** Ataques por zona [esq, centro, dir] no referencial da atacante, por lado [HOME, AWAY]. */
readonly attackZones: readonly (readonly [number, number, number])[];
```

e a `HeadlessBatchResult`:

```ts
readonly sideOuts: readonly [number, number];
readonly unforcedErrors: readonly [number, number];
readonly attackZoneTotals: readonly (readonly [number, number, number])[];
```

com `import { attackZoneIndex, classifyPoint, type PointClass, type RallyTouch } from './BalanceMetrics';`.

2. Em `summarizeRallies` (l. 514-583): declarar junto aos acumuladores
   `let touches: RallyTouch[] = [];` e
   `let attackZones: [[number, number, number], [number, number, number]] = [[0, 0, 0], [0, 0, 0]];`,
   zerando ambos no `rally-start`. No branch `contact`, além do código atual:

```ts
touches.push({ side: event.side, kind: event.kind });
if (event.kind === 'spike') {
  attackZones[event.side][attackZoneIndex(event.side, event.point.z)] += 1;
}
```

No branch `block`: `touches.push({ side: event.side, kind: 'block-touch' });`.
No `rally-end`, antes do `summaries.push`:

```ts
const pointClass = classifyPoint({
  cause: point.cause,
  ace: point.ace,
  winner: point.winner,
  lastTouchSide: point.lastTouchSide,
  lastKind: point.lastKind,
  touches,
});
```

e no objeto do push:

```ts
sideOut: event.winner !== rallyStart.serving,
pointClass,
attackZones: Object.freeze([
  Object.freeze([...attackZones[0]]) as unknown as readonly [number, number, number],
  Object.freeze([...attackZones[1]]) as unknown as readonly [number, number, number],
]),
```

3. Nos agregados de `run()` (l. 242-262), acrescentar:

```ts
const sideOuts: [number, number] = [0, 0];
const unforcedErrors: [number, number] = [0, 0];
const attackZoneTotals: [number, number, number][] = [
  [0, 0, 0],
  [0, 0, 0],
];
```

dentro do loop:

```ts
if (summary.sideOut) sideOuts[summary.winner] += 1;
if (summary.pointClass === 'unforced') unforcedErrors[otherSide(summary.winner)] += 1;
for (const side of [0, 1] as const) {
  for (let zone = 0; zone < 3; zone += 1) {
    attackZoneTotals[side][zone] += summary.attackZones[side][zone];
  }
}
```

e no `Object.freeze` do retorno: `sideOuts: Object.freeze(sideOuts)`,
`unforcedErrors: Object.freeze(unforcedErrors)`,
`attackZoneTotals: Object.freeze(attackZoneTotals.map((zones) => Object.freeze([...zones])))`
(com os casts `as unknown as readonly [...]` no padrão já usado no arquivo). Importar `otherSide`.

- [ ] **Step 4: Verificar que passa (arquivo inteiro)**

Run: `npx vitest run src/game/simulation/HeadlessRallyRunner.test.ts`
Expected: PASS, incluindo batch de 100 e matriz de 1.000 (invariantes preservados).

- [ ] **Step 5: Commit**

```bash
git add src/game/simulation/HeadlessRallyRunner.ts src/game/simulation/HeadlessRallyRunner.test.ts
git commit -m "feat(simulacao): side-outs, classe de ponto e zonas no runner headless"
```

---

### Task 7: Partidas completas headless (`runMatches`)

**Files:**
- Modify: `src/game/simulation/HeadlessRallyRunner.ts` (classe + interfaces + free function)
- Test: `src/game/simulation/HeadlessRallyRunner.test.ts`

**Interfaces:**
- Consumes: `setWinner` (`rules/scoring`), `isSetOver`/`setTargets` (nos testes),
  fronteira de partida já existente em `onTick` (l. 375-377: restart em `matchEnd`).
- Produces:
  - `interface HeadlessMatchSummary { winner: TeamSide; sets: readonly [number, number]; setScores: readonly (readonly [number, number])[]; points: readonly [number, number]; rallies: number; durationTicks: number; durationSeconds: number }`
  - `interface HeadlessMatchBatchResult { seed: number; matches: readonly Readonly<HeadlessMatchSummary>[]; totalTicks: number }`
  - `HeadlessRallyRunner.runMatches(matches: number): HeadlessMatchBatchResult`
  - `runHeadlessMatches(options: HeadlessRunnerOptions & { matches: number }): HeadlessMatchBatchResult`

- [ ] **Step 1: Testes que falham**

Adicionar a `src/game/simulation/HeadlessRallyRunner.test.ts` (importar `isSetOver` de
`../rules/scoring` e `runHeadlessMatches`/`HeadlessRallyRunner` conforme necessário):

```ts
describe('runMatches', () => {
  it('roda uma partida completa 2.0 e resume sets, placar e duração', { timeout: 60_000 }, () => {
    const result = runHeadlessMatches({ seed: 0x3d20_0001, matches: 1 });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(match.sets[match.winner]).toBe(2);
    expect(match.setScores.length).toBeGreaterThanOrEqual(2);
    expect(match.setScores.length).toBeLessThanOrEqual(3);
    match.setScores.forEach(([h, a], index) => {
      const deciding = index === 2;
      expect(isSetOver(h, a, deciding ? 7 : 11, deciding ? 11 : 15)).toBe(true);
    });
    expect(match.points[0] + match.points[1]).toBe(match.rallies);
    expect(match.durationTicks).toBeGreaterThan(0);
    expect(match.durationSeconds).toBeCloseTo(match.durationTicks / 60, 10);
    expect(result.totalTicks).toBeGreaterThanOrEqual(match.durationTicks);
  });

  it('é determinístico por seed', { timeout: 120_000 }, () => {
    const first = runHeadlessMatches({ seed: 0x3d20_0002, matches: 2 });
    const second = runHeadlessMatches({ seed: 0x3d20_0002, matches: 2 });
    expect(second.matches).toEqual(first.matches);
  });

  it('recusa começar no meio de uma partida', { timeout: 60_000 }, () => {
    const runner = new HeadlessRallyRunner({ seed: 0x3d20_0003 });
    runner.run(1);
    expect(() => runner.runMatches(1)).toThrow(/fronteira de partida/);
  });
});
```

- [ ] **Step 2: Verificar que falham**

Run: `npx vitest run src/game/simulation/HeadlessRallyRunner.test.ts -t 'runMatches'`
Expected: FAIL — `runMatches`/`runHeadlessMatches` inexistentes.

- [ ] **Step 3: Implementação**

1. Campos novos na classe (junto de `pointCount` etc.):

```ts
private matchStartTick = 0;
private matchStartPoint = 0;
private readonly matchBoundaries: {
  tick: number;
  point: number;
  startTick: number;
  startPoint: number;
}[] = [];
```

2. Substituir o branch de `matchEnd` em `onTick` (l. 375-377) por (a assinatura ganha o segundo
   alvo: `private onTick(ticket: FixedStepTicket, targetPoints: number, targetMatches = Number.POSITIVE_INFINITY)`):

```ts
if (this.match.state === 'matchEnd') {
  if (this.matchBoundaries.at(-1)?.point !== this.pointCount) {
    this.matchBoundaries.push({
      tick: this.logicalTick,
      point: this.pointCount,
      startTick: this.matchStartTick,
      startPoint: this.matchStartPoint,
    });
  }
  const needMore =
    this.pointCount < targetPoints || this.matchBoundaries.length < targetMatches;
  if (needMore) {
    this.match.startMatch(this.difficulty, this.format);
    this.matchStartTick = this.logicalTick;
    this.matchStartPoint = this.pointCount;
  }
}
```

Obs.: em `run()`, a chamada vira `this.onTick(ticket, targetPoints)` (targetMatches infinito
mantém o comportamento atual de reinício).

3. Método novo na classe:

```ts
/** Roda partidas completas AI×AI no formato configurado; exige fronteira de partida. */
runMatches(matches: number): HeadlessMatchBatchResult {
  if (!Number.isInteger(matches) || matches <= 0) {
    throw new RangeError('matches deve ser um inteiro positivo');
  }
  if (this.pointCount !== (this.matchBoundaries.at(-1)?.point ?? 0)) {
    throw new Error('runMatches exige fronteira de partida (não misture com run() no meio)');
  }
  const firstBoundary = this.matchBoundaries.length;
  const targetMatches = firstBoundary + matches;
  const firstEvent = this.events.length;
  const firstPoint = this.pointCount;
  while (this.matchBoundaries.length < targetMatches) {
    this.frame += 1;
    const nowMs = (this.frame * 1_000) / this.externalHz;
    this.fixed.advance(nowMs, {
      onTick: (ticket) => this.onTick(ticket, Number.POSITIVE_INFINITY, targetMatches),
      onDiscard: (discard) => {
        throw new HeadlessSimulationLimitError('FixedStepRunner descartou tempo', {
          reason: discard.reason,
          tick: this.lastPointTick,
          seed: this.seed,
        });
      },
    });
    if (this.telemetryLimit) throw this.telemetryLimit;
  }
  const summaries = summarizeRallies(this.events.slice(firstEvent));
  const boundaries = this.matchBoundaries.slice(firstBoundary);
  const matchesOut = boundaries.map((boundary) => {
    const rallies = summaries.slice(
      boundary.startPoint - firstPoint,
      boundary.point - firstPoint,
    );
    return summarizeMatch(rallies, boundary.tick - boundary.startTick);
  });
  return Object.freeze({
    seed: this.seed,
    matches: Object.freeze(matchesOut),
    totalTicks: boundaries.at(-1)!.tick - boundaries[0].startTick,
  });
}
```

4. Função pura no fim do arquivo (antes das free functions):

```ts
/** Resume uma partida a partir dos rallies dela: sets detectados pelo reset do placar. */
function summarizeMatch(
  rallies: readonly Readonly<HeadlessRallySummary>[],
  durationTicks: number,
): Readonly<HeadlessMatchSummary> {
  const setScores: [number, number][] = [];
  let last: readonly [number, number] | null = null;
  for (const rally of rallies) {
    if (last && rally.score[0] + rally.score[1] <= last[0] + last[1]) {
      setScores.push([last[0], last[1]]);
    }
    last = rally.score;
  }
  if (last) setScores.push([last[0], last[1]]);
  const sets: [number, number] = [0, 0];
  for (const [h, a] of setScores) sets[setWinner(h, a)] += 1;
  const points: [number, number] = [0, 0];
  for (const rally of rallies) points[rally.winner] += 1;
  return Object.freeze({
    winner: sets[0] > sets[1] ? TeamSide.HOME : TeamSide.AWAY,
    sets: Object.freeze(sets) as unknown as readonly [number, number],
    setScores: Object.freeze(setScores.map((score) => Object.freeze([...score]))) as unknown as
      readonly (readonly [number, number])[],
    points: Object.freeze(points) as unknown as readonly [number, number],
    rallies: rallies.length,
    durationTicks,
    durationSeconds: durationTicks / 60,
  });
}

export function runHeadlessMatches(
  options: HeadlessRunnerOptions & { readonly matches: number },
): HeadlessMatchBatchResult {
  return new HeadlessRallyRunner(options).runMatches(options.matches);
}
```

com `import { setWinner } from '../rules/scoring';` e as duas interfaces exportadas junto das
demais.

- [ ] **Step 4: Verificar que passa (arquivo inteiro)**

Run: `npx vitest run src/game/simulation/HeadlessRallyRunner.test.ts`
Expected: PASS — inclusive `run()`/matriz legados (o branch de matchEnd continua reiniciando).

- [ ] **Step 5: Commit**

```bash
git add src/game/simulation/HeadlessRallyRunner.ts src/game/simulation/HeadlessRallyRunner.test.ts
git commit -m "feat(simulacao): partidas completas headless com resumo por set"
```

---

### Task 8: Baterias de balanceamento (gates §4.3 e §3.2)

**Files:**
- Create: `src/game/simulation/BalanceBattery.test.ts`

**Interfaces:**
- Consumes: `runHeadlessBatch`, `runHeadlessMatches` (runner), `buildBalanceReport`, `median`,
  `percentile` (BalanceMetrics).
- Produces: logs `BALANCE_MATRIX ...` e `DURATION_MATRIX ...` como evidência nos runs.

- [ ] **Step 1: Escrever as baterias (esperado falhar até o tuning da Task 9)**

Criar `src/game/simulation/BalanceBattery.test.ts`:

```ts
// Baterias de balanceamento da Fase 3D. São gates de regressão das metas §4.3/§3.2 do design
// 2.0 na dificuldade Normal. Sob coverage os tempos crescem; os timeouts são deliberadamente
// folgados — a bateria valida faixas estatísticas, não latência.
import { describe, expect, it } from 'vitest';
import { buildBalanceReport, median, percentile } from './BalanceMetrics';
import { runHeadlessBatch, runHeadlessMatches } from './HeadlessRallyRunner';

const NORMAL = 1;
const FORMAT_2_0 = 0;

describe('baterias de balanceamento — Normal', () => {
  it(
    'matriz §4.3: 1.000 rallies em 20 seeds dentro das faixas',
    { timeout: 240_000 },
    () => {
      const startedAt = performance.now();
      const samples = [];
      for (let seed = 0; seed < 20; seed += 1) {
        const batch = runHeadlessBatch({
          seed: 0x3d40_0000 + seed,
          rallies: 50,
          difficulty: NORMAL,
          format: FORMAT_2_0,
        });
        samples.push(...batch.rallies);
      }
      const report = buildBalanceReport(samples);
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(
        `BALANCE_MATRIX rallies=${report.rallies} contactsMedian=${report.contactsMedian} ` +
          `decisiveShare=${report.decisiveShare.toFixed(3)} ` +
          `maxZoneShare=${report.maxZoneShare.toFixed(3)} elapsedMs=${elapsedMs}`,
      );
      expect(report.rallies).toBe(1000);
      expect(report.contactsMedian).toBeGreaterThanOrEqual(4);
      expect(report.contactsMedian).toBeLessThanOrEqual(8);
      expect(report.decisiveShare).toBeGreaterThanOrEqual(0.65);
      expect(report.maxZoneShare).toBeLessThanOrEqual(0.45);
    },
  );

  it(
    'duração §3.2: 30 partidas em 10 seeds com mediana 8–12 min e p90 ≤ 15 min',
    { timeout: 480_000 },
    () => {
      const startedAt = performance.now();
      const minutes: number[] = [];
      for (let seed = 0; seed < 10; seed += 1) {
        const result = runHeadlessMatches({
          seed: 0x3d50_0000 + seed,
          matches: 3,
          difficulty: NORMAL,
          format: FORMAT_2_0,
        });
        for (const match of result.matches) minutes.push(match.durationSeconds / 60);
      }
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(
        `DURATION_MATRIX matches=${minutes.length} medianMin=${median(minutes).toFixed(2)} ` +
          `p90Min=${percentile(minutes, 0.9).toFixed(2)} elapsedMs=${elapsedMs}`,
      );
      expect(minutes).toHaveLength(30);
      expect(median(minutes)).toBeGreaterThanOrEqual(8);
      expect(median(minutes)).toBeLessThanOrEqual(12);
      expect(percentile(minutes, 0.9)).toBeLessThanOrEqual(15);
    },
  );
});
```

- [ ] **Step 2: Rodar e registrar o baseline**

Run: `npx vitest run src/game/simulation/BalanceBattery.test.ts`
Expected: os logs `BALANCE_MATRIX`/`DURATION_MATRIX` saem com os números reais. As asserções
**podem falhar** — é o baseline que orienta a Task 9. Anotar os quatro números.

- [ ] **Step 3: Commit (mesmo com bateria vermelha local, NÃO pushar)**

Se as faixas já passarem, commit direto. Se falharem, **não commitar ainda** — a Task 9 ajusta os
knobs e o commit sai junto com o tuning (o repositório nunca recebe commit com teste vermelho).

---

### Task 9: Tuning até as faixas (iterativo, sem tocar física)

**Files:**
- Modify: `src/core/constants.ts:72-103` (`DIFFICULTIES`), possivelmente
  `src/core/constants.ts:151-201` (`STRATEGIC_SERVE_TUNING.families[*].errorMultiplier`,
  `STRATEGIC_OFFENSE_REALIZATION`) — somente campos de erro/dispersão, nunca velocidade/potência
- Modify: `src/game/strategy/OpponentBrain.ts:26-33` (`STRATEGY_PROFILES`, `MEMORY_DEPTH`) se a
  concentração de zona exigir
- Test: baterias da Task 8 + suíte completa

**Interfaces:** nenhuma nova — apenas valores.

- [ ] **Step 1: Iterar com o mapa knob → métrica**

| Métrica fora da faixa | Knob primário | Onde |
|---|---|---|
| `contactsMedian` < 4 | ↑ `digChance` e/ou ↑ `passQuality[0]` do Normal; ↓ `serveError` | `DIFFICULTIES[1]` |
| `contactsMedian` > 8 | ↓ `digChance` do Normal | `DIFFICULTIES[1]` |
| `decisiveShare` < 0,65 | ↓ `serveError`/`attackError` (menos erro gratuito); ↑ `blockChance`/`digChance` (mais defesa forçada); ↓ `errorMultiplier` das famílias de saque | `DIFFICULTIES[1]`, `STRATEGIC_SERVE_TUNING.families` |
| `maxZoneShare` > 0,45 | ↑ `temperature`/`exploration` ou ↓ `cap` do perfil Normal | `OpponentBrain.ts` `STRATEGY_PROFILES[1]` |
| mediana de duração < 8 min | ↑ `digChance` (rallies mais longos) | `DIFFICULTIES[1]` |
| mediana > 12 min ou p90 > 15 | ↓ `digChance`; se insuficiente, ↓ `serveError` (menos pontos "grátis" que esticam sets no cap) | `DIFFICULTIES[1]` |

Processo por iteração: alterar **um** knob por vez →
`npx vitest run src/game/simulation/BalanceBattery.test.ts` → ler `BALANCE_MATRIX`/
`DURATION_MATRIX` → repetir. Guardas: física idêntica entre dificuldades (nenhuma mudança em
`PLAYER`, `GRAVITY`, `basePower`, `attackSpeed` por dificuldade); Fácil continua mais permissivo e
Difícil mais exigente que o Normal em cada campo alterado (ordem monotônica dos três perfis).

- [ ] **Step 2: Validar a suíte inteira**

Run: `npx vitest run`
Expected: PASS. Se algum teste unitário codificava valores antigos de `DIFFICULTIES`
(p.ex. asserts de `reactionDelay`/probabilidades), atualizar a expectativa **somente** se o teste
é de caracterização de constante; qualquer outra falha é regressão para investigar.

- [ ] **Step 3: Commit**

```bash
git add src/core/constants.ts src/game/strategy/OpponentBrain.ts src/game/simulation/BalanceBattery.test.ts
git add -u src
git commit -m "feat(ia): baterias de balanceamento e tuning do Normal na faixa 2.0"
```

(Registrar no corpo do commit os quatro números finais das matrizes.)

---

### Task 10: Gates finais, playtest real, docs de conclusão e push

**Files:**
- Modify: `docs/ROADMAP.md` (3D concluída + evidências), `docs/superpowers/plans/README.md`
  (linha 3D → concluído), `CLAUDE.md` (marco), `CHANGELOG.md` (entrada 3D),
  `docs/superpowers/specs/2026-07-12-pro-volei-2-0-design.md` (nota do critério 6: multiplicador
  removido)

**Interfaces:** nenhuma.

- [ ] **Step 1: Gates completos**

Run: `npm run check`
Expected: workflow + typecheck + lint + format + cobertura, tudo verde.

- [ ] **Step 2: Playtest real**

Usar a skill `playtest` (porta 5199): iniciar partida no formato default (agora "Oficial 2.0"),
completar ao menos um rally, verificar HUD de sets/placar com alvo 11, console sem erros,
screenshot capturado. O menu deve listar os três formatos com o 2.0 selecionado por padrão.

- [ ] **Step 3: Grep de resíduos**

Run: `Grep servePower em src/ e docs/ (fora de history/codereviews/plans antigos)`
Expected: nenhuma referência viva em `src/`; atualizar `docs/ARCHITECTURE.md` se mencionar o
campo. Atualizar a nota da spec (l. 13-15) para registrar que o critério 6 foi cumprido na 3D.

- [ ] **Step 4: Docs de conclusão**

- `docs/ROADMAP.md`: adicionar bullet "**Fase 3D — concluída:** ..." na lista de subfases com os
  números finais das matrizes e o SHA/run de CI; atualizar o "Marco atual" para 4A em seguida.
- `docs/superpowers/plans/README.md`: linha da 3D → "concluído".
- `CHANGELOG.md`: entrada com formato 2.0, métricas, remoção do servePower e tuning.
- `CLAUDE.md`: marco atual → 3D concluída, 4A em execução (quando iniciar).

- [ ] **Step 5: Commit de docs + push + CI**

```bash
git add docs CLAUDE.md CHANGELOG.md
git commit -m "docs(projeto): conclui fase 3d com evidencias das matrizes"
git push
```

Acompanhar o run do Actions até verde (`gh run watch`) e conferir o deploy do Pages + smoke
público, como nas fases anteriores. Se o CI falhar: parar trabalho novo e corrigir/reverter no
próximo commit (nunca amend/force-push).

---

## Self-Review (executado na escrita do plano)

1. **Cobertura da spec (3D):** formato §3.2 (Tasks 2-3), métricas §4.3 (Tasks 5-8), remoção do
   multiplicador legado/critério 6 (Task 4), tuning §4.2/§4.3 (Task 9), gates §12.2 e fluxo
   §13.1 (Tasks 1 e 10). A nota da spec l. 13-15 ("remoção pertence ao tuning 3D") é atendida.
2. **Placeholders:** todos os passos têm código/comando concretos; os dois pontos deliberadamente
   abertos são valores finais de tuning (Task 9, por natureza empírica, com processo e guardas
   explícitos) e ajustes de fixtures que só a suíte revela (Tasks 3/9, com regra clara: fixture
   sim, regra não).
3. **Consistência de tipos:** `SetScoringFormat` definido em constants e consumido por
   scoring/SetMatch; `PointClass`/`RallyTouch` definidos em BalanceMetrics e consumidos pelo
   runner; `HeadlessMatchSummary` produzido na Task 7 e consumido na Task 8 com os mesmos nomes.
