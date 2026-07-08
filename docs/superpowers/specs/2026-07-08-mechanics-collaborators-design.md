# Design — Extração das mecânicas para colaboradores (Fase 1, passo 1.4)

**Data:** 2026-07-08
**Contexto:** Refatoração-alvo do projeto (quebrar `src/game/Match.ts`). Ver
[docs/ARCHITECTURE.md#refatoração-alvo](../../ARCHITECTURE.md). Passos anteriores já no `main`:
`rules/scoring`, `rules/rotation`, `mechanics/net`, `RallyState` (1.3), `mechanics/block`
geometria pura (1.4a).

## Objetivo

Tirar do `Match.ts` os métodos de **mecânica** (física da bola + efeitos + posse) que hoje
inflam o arquivo, movendo-os para `src/game/mechanics/` como funções livres sobre um contexto
injetado. Meta da fase: nenhum arquivo de `game/` acima de ~250 linhas e mecânicas isoladas/
plugáveis. Este passo deve derrubar `Match.ts` de ~1050 para perto de ~600 linhas.

## Escopo

**Dentro (1.4):**

- **1.4b** — consolidar campos rally-scoped de planejamento no `RallyState`.
- **1.4c** — extrair `performServe`/`aiServe`, `executeTouch`/`doPass`/`doSet`/`doSpike`,
  `prepareBlock`/`resolveBlock` para `mechanics/` (funções livres + `MechanicsCtx`).

**Fora (fica para 1.5 ou depois):**

- `planNext` (planejamento + ramos `isHuman`), `beginServePrep` (state machine + setup de
  controle), `attemptContact`/`attemptSpikeContact` (leem `timingQ`/`jumpQ` do humano),
  `updateHumanControl`, pontuação/set/partida.
- Remoção do código morto conhecido (`crossIn`, `prevBallX`, ternário `'pass' : 'pass'`) —
  commit à parte, neutro de comportamento.

## Decisões de design (aprovadas)

1. **Fronteira:** as mecânicas delegam o planejamento de volta ao `Match` via callback
   `planNext`. `planNext` e o estado de controle **ficam** no `Match` (são do 1.5). Só a
   mecânica (física + efeitos + posse) sai.
2. **Mecanismo:** funções livres em `mechanics/` (consistente com `scoring`/`rotation`/`net`/
   `block`), recebendo um `MechanicsCtx` como primeiro argumento — não classes colaboradoras.
3. **Contexto:** os campos do `Match` **continuam privados**. O `Match` fornece um objeto `ctx`
   (construído uma vez) que implementa `MechanicsCtx`, com **getters** para os valores que
   mudam (`diff`, `stats`, `servingTeam`, `chosenZone`) e referências diretas para os estáveis
   (`ball`, `rally`, `hooks`, `aim`) e delegações de método (`teamOf`, `after`, `planNext`).
   Rejeitado: tornar ~10 internos `public` só para satisfazer a interface.

## Layout de módulos

```
src/game/
├── Match.ts              orquestrador: state machine, planNext, controle, event queue, ctx
├── RallyState.ts         + setterHold, plannedAttacker, lastToucher, blockers
└── mechanics/
    ├── net.ts            (existe) geometria de cruzamento da rede
    ├── block.ts          (existe) geometria + NOVO prepareBlock, resolveBlock
    ├── context.ts        NOVO interface MechanicsCtx
    ├── serve.ts          NOVO performServe, aiServe
    └── touch.ts          NOVO executeTouch, doPass, doSet, doSpike
```

## 1.4b — Consolidar planejamento no `RallyState`

Mover para `RallyState` os quatro campos rally-scoped hoje no `Match`:

```ts
setterHold: Athlete | null = null;
plannedAttacker: Athlete | null = null;
lastToucher: Athlete | null = null;
blockers: { athlete: Athlete; jumpIn: number }[] = [];
```

Move puro de campos, **sem lógica nova**. `reset()` **não** os toca (preserva o comportamento
atual: `blockers` já é zerado no `prepareBlock`; os outros são sempre sobrescritos antes do uso,
inclusive no primeiro passe pós-saque, que usa `nearestTo` sem `lastToucher`). `Match.update()`
passa a ler `this.rally.blockers`. Guardado por typecheck + testes existentes + playtest.

## 1.4c — Interface `MechanicsCtx`

Em `mechanics/context.ts`:

```ts
export interface MechanicsCtx {
  ball: Ball;
  rally: RallyState;          // inclui setterHold/plannedAttacker/lastToucher/blockers após 1.4b
  hooks: Hooks;
  diff: Difficulty;
  servingTeam: TeamSide;      // leitura (performServe, aiServe)
  aim: THREE.Vector3;         // leitura (doSpike)
  chosenZone: number;         // leitura (doSet)
  stats: MatchStats;          // escrita (stats.blocks no resolveBlock)
  teamOf(side: TeamSide): Team;
  after(t: number, fn: () => void): void;
  planNext(kind: TouchKind): void;
}
```

`Hooks` e `MatchStats` são exportados de `Match.ts`; `context.ts` os importa (sem ciclo de
runtime — só tipos). O `ctx` é montado no construtor do `Match` fechando sobre `this`.

## 1.4c — Módulos de mecânica (funções livres)

Assinaturas (todas recebem `ctx: MechanicsCtx` primeiro):

- `serve.ts`: `performServe(ctx, server: Athlete, power, target, clearance)`, `aiServe(ctx)`
- `touch.ts`: `executeTouch(ctx, plan: TouchPlan, quality)`, `doPass(ctx, plan, q)`,
  `doSet(ctx, plan, q)`, `doSpike(ctx, plan, q)`
- `block.ts` (+): `prepareBlock(ctx, side: TeamSide, z, contactIn)`,
  `resolveBlock(ctx, attackSide: TeamSide)`

Delegação no `Match`: `this.doPass(...)` → `doPass(this.ctx, plan, q)`; o `doSpike` chama
`resolveBlock(ctx, side)` e `planNext(...)` via `ctx`. `beginServePrep` agenda o saque da IA com
`after(t, () => aiServe(this.ctx))`.

## O que fica no `Match` (fronteira p/ 1.5)

`beginServePrep`, `attemptContact`, `attemptSpikeContact`, `planNext`, `computeNetEvent`,
`updateHumanControl`, `resolvePoint`/`awardPoint`/`endSet`/`pushScore`, event queue e state
machine. Estes leem/escrevem estado de controle humano (`ctl`, `controlled`, `timingQ`, `jumpQ`,
`servePower`, `serveCharging`) e são o alvo do 1.5.

## Testes & verificação

As mecânicas são estocásticas (`rand`/`randPick`/`chance`) — **não** rendem testes unitários
determinísticos limpos; a parte pura testável (geometria) já saiu em `net.ts`/`block.ts`
(16 testes). Portanto 1.4b e 1.4c são refactors **preservando comportamento observável**,
verificados por:

1. `npm run check` — os 53 testes atuais continuam verdes (typecheck + lint + format + test).
2. **Playtest** (browser real, porta 5199 `--strictPort`) a cada incremento: ciclo
   saque → rally → ponto funciona, rallies longos exercitam toques/bloqueio, **zero erros de
   console**.

Nenhum incremento deve mudar o comportamento observável; se mudar, é bug — investigar (skill
`superpowers:systematic-debugging`).

## Ordem dos incrementos (cada um = commit verde no `main`)

1. **1.4b** — campos de planejamento → `RallyState`.
2. **1.4c-1** — `context.ts` + `block.ts` (prepareBlock/resolveBlock). Valida o `ctx` no caso
   mais contido.
3. **1.4c-2** — `serve.ts` (performServe/aiServe).
4. **1.4c-3** — `touch.ts` (executeTouch/doPass/doSet/doSpike).

## Riscos

- **`ctx` como "God object":** a interface é larga porque reflete o acoplamento real do `Match`.
  Mitigado pela consolidação do 1.4b (tira 4 campos da superfície). Aceitável como andaime
  temporário do strangler; encolhe quando 1.5 separar controle.
- **Closures agendados (`after`)** dentro das mecânicas leem estado via `ctx` no futuro — por
  isso os valores mutáveis (`servingTeam`, `diff`, `stats`, `chosenZone`) são getters no `ctx`,
  sempre vivos, evitando captura por valor obsoleta.
- **Renomeações mecânicas em massa** no `Match`: typecheck estrito é a rede — qualquer referência
  perdida a método/campo movido falha a compilação apontando a linha.

## Critérios de pronto

- Os 6 métodos movidos vivem em `mechanics/serve.ts`/`touch.ts`/`block.ts` como funções livres.
- `MechanicsCtx` em `mechanics/context.ts`; `Match` o fornece com campos privados.
- Campos de planejamento no `RallyState`.
- `npm run check` verde + playtest sem erros em cada commit.
- `Match.ts` visivelmente menor (~600 linhas).
