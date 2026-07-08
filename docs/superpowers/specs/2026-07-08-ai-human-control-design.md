# Design — Separar IA e controle humano (Fase 1, passo 1.5)

**Data:** 2026-07-08
**Contexto:** Refatoração-alvo do projeto (quebrar `src/game/Match.ts`). Ver
[docs/ARCHITECTURE.md#refatoração-alvo](../../ARCHITECTURE.md). Passos anteriores já no `main`:
`rules/scoring`, `rules/rotation`, `mechanics/net`, `RallyState` (1.3), `mechanics/block`,
e o 1.4 completo (`mechanics/serve`, `mechanics/touch`, `mechanics/context`). `Match.ts` está
em **798 linhas**.

## Objetivo

Desentrelaçar os ramos `isHuman` que ainda vivem no `Match`: separar **decisão da IA** e
**controle humano** em colaboradores dedicados (`ai/AiController.ts`, `control/HumanController.ts`),
deixando o `Match` como orquestrador fino. Fecha o objetivo "separar IA e controle humano" da
Fase 1. Meta: `Match.ts` para a casa dos ~450-500 linhas; IA plugável (facilita ajustar/adicionar
dificuldades).

## Escopo

**Dentro (1.5):**

- `control/HumanController.ts` — absorve `updateHumanControl`, o estado de interação humana
  (`ctl`, `controlled`, `aim`, `timingQ`, `jumpQ`, `chosenZone`, carga do saque, `marker`) e os
  ramos `isHuman` de `planNext`/`attemptContact`/`attemptSpikeContact`/`beginServePrep`.
- `ai/AiController.ts` — absorve os ramos `!isHuman`: agendamento de aproximação/pulo em
  `planNext`, os pulos agendados de `update()`, as rolagens de qualidade da IA e o gatilho do
  saque da IA.

**Fora (fica onde está ou para depois):**

- **Seleção de alvo da IA** (`ai/targeting.ts` do arch doc): já vive limpa em `mechanics/`
  (`touch.ts` `doSpike`/`doSet`, `serve.ts` `aiServe` nunca leem `aim`/`chosenZone`). Não mover
  agora — mexeria em arquivos já refatorados sem ganho.
- **Mecânica de bloqueio** (`prepareBlock`/`resolveBlock`): já ramifica lado IA×humano
  internamente; continua em `mechanics/block.ts`.
- Pontuação/set/partida (`resolvePoint`/`awardPoint`/`endSet`), state machine e event queue —
  ficam no `Match` (não são controle IA×humano).

## Decisões de design (aprovadas)

1. **Colaboradores assimétricos, sem interface `Controller` simétrica.** Humano e IA têm
   responsabilidades genuinamente diferentes (humano reage a `Input` por frame e é dono de
   hints/marker/aim; IA agenda eventos temporizados e usa `diff`). Cada um expõe a interface
   natural da sua responsabilidade. Rejeitado: forçar simetria — geraria métodos no-op e não
   acomodaria o caso cruzado "humano bloqueia cortada da IA".
2. **Reuso do `MechanicsCtx`.** Os controllers recebem o mesmo `ctx` já usado pelas mecânicas
   (ball, rally, hooks, `after`, `teamOf`, `planNext`, `diff`). Sem contexto novo.
3. **Dono de `aim`/`chosenZone`/`timingQ`/`jumpQ`:** passa a ser o `HumanController`. O `ctx`
   expõe `aim`/`chosenZone` às mecânicas via getters que delegam ao `HumanController`
   (`ctx.aim → human.aim`, `ctx.chosenZone → human.chosenZone`).
4. **`marker` (anel do jogador controlado):** a mesh passa a ser do `HumanController`; o `Match`
   só a adiciona ao `group` no construtor. Visibilidade/posição por frame saem do `Match.update`.
5. **`diff` continua no `Match`.** O `AiController` lê `ctx.diff` (é efetivamente sem estado —
   métodos recebem `ctx`). Isso mantém um único dono de `diff` e já materializa o ponto de plugue
   de dificuldade (trocar comportamento = trocar o controller ou o `diff` que ele lê).
6. **`planNext` continua no `Match`** como planejador: computa geometria + monta o `TouchPlan`
   (compartilhado), depois delega o setup do lado ao controller certo. `prepareBlock` e
   `camera('spike')` seguem no `planNext` (mecânica/apresentação, não controle).

## Layout de módulos

```
src/game/
├── Match.ts              orquestrador: state machine, planNext (geometria), event queue, ctx
├── control/
│   └── HumanController.ts  NOVO estado + input humano, qualidade de toque/cortada humana
├── ai/
│   └── AiController.ts     NOVO agendamento de aproximação/pulo, qualidade da IA, saque da IA
└── mechanics/            (inalterado) serve, touch, block, net, context
```

## `control/HumanController.ts`

Estado (movido do `Match`):

```ts
type CtlMode = 'none' | 'serve' | 'receive' | 'attack' | 'block';

class HumanController {
  private ctl: CtlMode = 'none';
  private controlled: Athlete | null = null;
  private serveCharging = false;
  private servePower = 0;
  private serveDir = 1;
  readonly aim = new THREE.Vector3(5.5, 0, 0);
  private timingQ = -1;   // qualidade do ESPAÇO na recepção
  private jumpQ = -1;     // timing do pulo no ataque
  chosenZone = 0;         // 0 esq · 1 centro · 2 dir
  readonly marker: THREE.Mesh;  // Match adiciona ao group
}
```

| Método | Origem no `Match` |
|---|---|
| `update(dt, input, ctx)` | `updateHumanControl` inteiro + bloco do marker de `update()` (l. 500-511) |
| `beginServe(server, ctx)` | ramo `humanServes` de `beginServePrep` (l. 172-181) |
| `awaitOpponentServe()` | ramo `else` de `beginServePrep` (l. 183-185): `ctl='none'`, `controlled=null` |
| `resetForServe()` | `timingQ=-1; jumpQ=-1; chosenZone=randPick([0,1,2])` (l. 148-150) |
| `assignReceive(athlete, ctx)` | `planNext` l. 259-264 (`ctl='receive'`, hint, showLanding) |
| `awaitSet(ctx)` | `planNext` l. 265-269 (`ctl='none'`, hint de zona, `zoneHint`) |
| `assignAttack(athlete, ctx)` | `planNext` l. 270-276 (`ctl='attack'`, `aim`, hint) |
| `assignBlock(blocker, ctx)` | `planNext` l. 277-282 (`ctl='block'`, hint) |
| `idle(ctx)` | `planNext` l. 283-289 (libera controle salvo se bloqueando; esconde landing) |
| `reachQuality(plan, hard, medium)` → `number` | ramo humano de `attemptContact` (l. 536-550) |
| `spikeQuality()` → `number` | ramo humano de `attemptSpikeContact` (l. 581-583) |
| getters `aim`, `chosenZone`, `mode`, `isControlling` | lidos por `ctx`/marker/attemptContact |

`reachQuality`/`spikeQuality` consomem e **resetam** `timingQ`/`jumpQ` (hoje resetados no fim de
`attemptContact`/`attemptSpikeContact`). Os banners "PERFEITO!"/"DEFESAÇA!" acompanham o cálculo.

## `ai/AiController.ts`

Sem estado próprio; métodos recebem `ctx` e leem `ctx.diff`.

| Método | Origem no `Match` |
|---|---|
| `serve(ctx)` | `after(rand, () => aiServe(ctx))` de `beginServePrep` (l. 186); chama `aiServe` (mechanics) |
| `scheduleApproach(ctx, plan)` | ramos `!isHuman` de `planNext`: `moveTo` com `reactionDelay` e `jumpScheduledIn` (l. 239-255) |
| `updateScheduledJumps(dt, ctx)` | pulo agendado do atacante + `rally.blockers` de `update()` (l. 447-464) |
| `reachQuality(ctx, plan, hard)` → `number` | ramo IA de `attemptContact` (l. 551-558): `diff.digChance`, `diff.passQuality` |
| `spikeQuality()` → `number` | ramo IA de `attemptSpikeContact` (l. 584-585): `rand(0.6, 1)` |

## `Match` depois — glue do `planNext` e do `attemptContact`

`planNext` mantém a geometria e a montagem do `TouchPlan`. Movimento/pulo e setup de controle
passam a ser delegação:

```ts
// ...calculado plan (side, athlete, kind, isHuman, point, contactIn)...
if (plan.kind === 'spike') {
  this.hooks.camera.setMode('spike');
  prepareBlock(this.ctx, otherSide(plan.side), cPoint.z, cT);  // mecânica: fica
}

if (plan.isHuman) this.human.onAssigned(this.ctx, plan);       // receive/awaitSet/attack + nudge moveTo
else this.ai.scheduleApproach(this.ctx, plan);                 // moveTo(reactionDelay) + jumpScheduledIn

// caso cruzado: humano bloqueia cortada da IA
if (plan.kind === 'spike' && plan.side === TeamSide.AWAY)
  this.human.assignBlock(this.home.nearestFrontRowTo(cPoint.z), this.ctx);
else if (plan.side === TeamSide.AWAY)
  this.human.idle(this.ctx);                                   // AI com a bola, humano ocioso
```

> `human.onAssigned` despacha internamente por `plan.kind` para `assignReceive`/`awaitSet`/
> `assignAttack` e faz o `moveTo` inicial (nudge com delay 0) que hoje está no `planNext`.

`attemptContact`/`attemptSpikeContact` mantêm a geometria de alcance; a qualidade vem do
controller certo, e o caminho do peixinho (`lungeReach`) é **compartilhado** (fica no `Match`):

```ts
if (d <= CONTACT.reach) {
  const q = plan.isHuman
    ? this.human.reachQuality(plan, hard, medium)
    : this.ai.reachQuality(this.ctx, plan, hard);
  if (q >= 0) executeTouch(this.ctx, plan, q);
  else a.act('dive', 0.8);
} else if (d <= CONTACT.lungeReach) {
  /* peixinho compartilhado — inalterado */
}
```

`update()` fica: `this.human.update(dt, input, ctx)` (input + marker) e, dentro do bloco do
plano, `this.ai.updateScheduledJumps(dt, ctx)`.

O `ctx` (em `makeCtx`) passa a expor `aim`/`chosenZone` via getters que delegam ao
`HumanController`:

```ts
get aim() { return human.aim; },
get chosenZone() { return human.chosenZone; },
```

## TDD — partes puras testadas antes de mover

As partes **determinísticas** viram helpers puros (em `control/`, ao lado do controller ou num
`control/timing.ts`) com teste antes da migração:

- `receiveTimingQuality(contactIn)` → `clamp(1 - |contactIn - 0.08|*3.2, 0, 1)`
- `jumpTimingQuality(contactIn)` → `clamp(1 - |contactIn - 0.26|*2.8, 0, 1)`
- `humanContactQuality(timingQ, hard)` → `(0.45 + 0.55*timingQ) * (hard ? 0.8 : 1)`
- `serveShot(power)` → `{ power, clearance }` (núcleo determinístico; o overshoot/`chance`
  aleatório e o "morre na rede" ficam no `update` do controller, fora do helper puro)

As rolagens estocásticas da IA (`diff.digChance`/`passQuality`, `rand(0.6,1)`) e a seleção de
alvo seguem cobertas por **playtest**, como no 1.4.

## Testes & verificação

1. `npm run check` — os 54 testes atuais continuam verdes + os novos testes dos helpers puros.
2. **Playtest** (browser real, porta 5199 `--strictPort`) a cada incremento: ciclo
   saque → recepção → levantamento → ataque → bloqueio → ponto funciona nas duas pontas
   (humano saca/recebe/ataca/bloqueia; IA saca/recebe/ataca/bloqueia), **zero erros de console**.

Nenhum incremento muda comportamento observável; se mudar, é bug — investigar (skill
`superpowers:systematic-debugging`).

## Ordem dos incrementos (cada um = commit verde no `main`)

1. **1.5a** — helpers puros de timing/qualidade em `control/` + testes (TDD, sem mover uso ainda).
2. **1.5b** — `control/HumanController.ts`: mover estado + `updateHumanControl` + marker; `Match`
   delega `update`/`makeCtx`(getters)/`beginServePrep`(ramo humano). `attemptContact` chama
   `human.reachQuality`/`spikeQuality`. Playtest com foco no lado humano.
3. **1.5c** — `ai/AiController.ts`: mover agendamento (`scheduleApproach`,
   `updateScheduledJumps`), qualidade da IA, `serve`. `planNext`/`attemptContact` delegam o ramo
   IA. Playtest com foco no lado da IA.
4. **1.5d** — enxugar `planNext` para o glue final (delegação + caso cruzado do bloqueio) e
   limpar restos. Playtest completo.

## Riscos

- **Caso cruzado (humano bloqueia cortada da IA):** `plan.side === AWAY` mas quem controla é o
  humano. Tratado explicitamente no glue (`assignBlock`), e `resolveBlock`/`prepareBlock` já
  ramificam `isHumanDef`/`isAI` internamente — não mudam. Verificar no playtest: bloquear a
  cortada da IA ainda stuffa/pinga corretamente.
- **`aim`/`chosenZone` via getter do `ctx`:** as mecânicas passam a ler do `HumanController`.
  Como só o ramo HOME as consome (o ramo IA usa `randPick`/spots próprios), o valor "residual"
  do humano no lado da IA nunca é lido — comportamento preservado.
- **Ordem no `update`:** hoje `updateHumanControl` roda antes do avanço do plano. Preservar a
  ordem (`human.update` → avanço do plano/contato → `ai.updateScheduledJumps` no lugar exato).
- **Renomeações em massa:** typecheck estrito é a rede; qualquer referência perdida falha a
  compilação apontando a linha.

## Critérios de pronto

- `control/HumanController.ts` e `ai/AiController.ts` existem; o estado de controle humano saiu
  do `Match`.
- Ramos `isHuman`/`!isHuman` de `planNext`/`attemptContact`/`attemptSpikeContact`/`beginServePrep`
  delegados aos controllers; `planNext` é só geometria + glue.
- Helpers de timing/qualidade puros com testes; `npm run check` verde + playtest sem erros em
  cada commit.
- `Match.ts` visivelmente menor (~450-500 linhas).
