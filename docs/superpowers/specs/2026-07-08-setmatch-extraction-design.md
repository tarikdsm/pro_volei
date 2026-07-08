# Design — Extrair fluxo de ponto/set/partida para rules/SetMatch (Fase 1, passo 1.6)

**Data:** 2026-07-08
**Contexto:** Refatoração-alvo do projeto (quebrar `src/game/Match.ts`). Ver
[docs/ARCHITECTURE.md#refatoração-alvo](../../ARCHITECTURE.md). Fase 1 (1.3→1.5) já no `main`:
`RallyState`, `mechanics/`, `control/HumanController`, `ai/AiController`. `Match.ts` está em
**561 linhas**. As **decisões puras** de pontuação já vivem em `rules/scoring.ts` (19 testes).

## Objetivo

Tirar do `Match` a **orquestração** de ponto/set/partida (`resolvePoint`/`awardPoint`/`endSet`/
`pushScore`, ~110 l.) para `rules/SetMatch.ts` como funções livres sobre um contexto injetado —
mesmo padrão de `mechanics/`. Deixa o `Match` como state machine + event queue + wiring. Alvo:
`Match.ts` para a casa dos ~450 linhas, fechando a Fase 1.

## Escopo

**Dentro (1.6):** mover `resolvePoint`, `awardPoint`, `endSet`, `pushScore` para
`rules/SetMatch.ts`; criar `ScoringCtx`; `Match` delega e fornece o ctx.

**Fora:** as decisões puras (já em `rules/scoring.ts`), a state machine em si (`state`/`stateTime`/
`events`/`update`), `beginServePrep` e a mecânica. `Match` mantém os campos de placar
(`score`/`sets`/`setNumber`/`servingTeam`/`stats`/`format`/`state`) — o ctx só dá acesso a eles.

## Decisões de design

1. **Funções livres + contexto** (consistente com `mechanics/`), não classe. `SetMatch.ts` recebe
   `ScoringCtx` como primeiro argumento.
2. **Transições de estado como métodos de intenção, não setters crus.** A pontuação muta o fluxo
   da partida, mas o `state` continua sendo do orquestrador: o ctx expõe `enterPoint()`/
   `enterSetEnd()`/`enterMatchEnd()`/`isRally()` em vez de `set state(...)`. Evita um contexto que
   só re-exporta as tripas do `Match`.
3. **Acesso via getters** (não refs capturadas). `startMatch`/`endSet` **reatribuem**
   `score`/`sets` (`this.score = [0,0]`); uma ref capturada no construtor ficaria obsoleta. Logo
   `score`/`sets`/`stats`/`format` são getters; `servingTeam`/`setNumber` são get+set (a pontuação
   legitimamente os altera). A reatribuição `this.score = [0,0]` em `endSet` vira mutação in-place
   (`ctx.score[0] = 0; ctx.score[1] = 0`) para casar com o acesso por getter.

## `ScoringCtx` (em `rules/SetMatch.ts`)

```ts
export interface ScoringCtx {
  ball: Ball;
  rally: RallyState;
  hooks: Hooks;
  get score(): [number, number]; // mutado in-place
  get sets(): [number, number];  // mutado in-place
  get stats(): MatchStats;       // mutado in-place
  get format(): { sets: number; pointsPerSet: number };
  get servingTeam(): TeamSide;
  set servingTeam(s: TeamSide);
  get setNumber(): number;
  set setNumber(n: number);
  teamOf(side: TeamSide): Team;
  after(t: number, fn: () => void): void;
  releaseControl(): void; // human.release()
  beginServePrep(): void;
  enterPoint(): void; // state='point'; stateTime=0; events=[]
  enterSetEnd(): void; // state='setEnd'; stateTime=0
  enterMatchEnd(): void; // state='matchEnd'
  isRally(): boolean; // state === 'rally'  (guard do awardPoint)
}
```

`Hooks`/`MatchStats` importados de `Match.ts` (só tipos, sem ciclo de runtime). `Match` fornece o
ctx via `makeScoringCtx()` (montado no construtor, fecha sobre `this`), ao lado de `makeCtx()`.

## Assinaturas (`rules/SetMatch.ts`)

- `resolvePoint(ctx)` — lê a queda (`resolveRallyOutcome`), monta o motivo, chama `awardPoint`.
- `awardPoint(ctx, winner: TeamSide, reason: string)` — guard `isRally()`; `enterPoint()`; placar/
  stats; banners/áudio/câmera/torcida/juiz; troca de saque + rodízio; `pushScore`; agenda `endSet`
  ou `beginServePrep`; aviso de set point.
- `endSet(ctx, winner: TeamSide)` — `sets[winner]++`; `enterSetEnd()`; confete/fanfarra; agenda
  `enterMatchEnd()`+`hooks.matchEnd` ou próximo set (`setNumber++`, reset in-place do placar,
  `servingTeam`, `pushScore`, `beginServePrep`).
- `pushScore(ctx)` — `hooks.setScore` + `hooks.arena.updateScoreboard`.

Delegação no `Match`: `onNetTouch` chama `awardPoint(this.scoringCtx, otherSide(...), '...')`;
`update` chama `resolvePoint(this.scoringCtx)` na queda da bola durante o rally.

## Testes & verificação

As decisões puras já têm testes (`scoring.test.ts`). A orquestração é efeito puro (banners/áudio/
câmera) sem núcleo determinístico novo — como no 1.4, é um **move preservando comportamento**,
verificado por:

1. `npm run check` — os 60 testes atuais continuam verdes.
2. **Playtest** (porta 5199 `--strictPort`): ponto do humano e do CPU (banner/áudio/câmera/troca de
   saque), ace, set point, fim de set e fim de partida (tela final). **Zero erros de console.**

## Riscos

- **Contexto amplo mutável:** mitigado pelos métodos de intenção (state) e por manter os campos no
  `Match`. O ctx é acesso, não posse — encolhe a superfície vs. setters crus.
- **Reatribuição vs. getter:** cobrir a troca `this.score = [0,0]` → in-place; typecheck + playtest
  do fim de set/partida guardam.
- **`enterPoint` limpa `events` antes de agendar:** preservar a ordem (limpar → agendar `endSet`/
  aviso), idêntica ao original.

## Critérios de pronto

- `resolvePoint`/`awardPoint`/`endSet`/`pushScore` vivem em `rules/SetMatch.ts` sobre `ScoringCtx`.
- `Match` delega e fornece `makeScoringCtx()`; campos de placar seguem no `Match`.
- `npm run check` verde + playtest (ponto/ace/set point/fim de set/fim de partida) sem erros.
- `Match.ts` ~450 linhas.
