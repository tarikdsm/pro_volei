# Arquitetura

Como o Pró Volei é montado hoje e para onde a estrutura de código deve evoluir.

## Visão geral

O jogo é uma aplicação web single-page. `src/main.ts` monta o renderer Three.js, o mundo
(quadra, arena, torcida, juiz), os sistemas (câmera, efeitos) e a partida (`Match`), e roda
o game loop via `requestAnimationFrame`. Tudo é procedural e offline.

```
┌─────────────────────────────────────────────────────────────┐
│ main.ts  — renderer · scene · fixed step 60 Hz · slow-motion  │
│   injeta Hooks ─────────────┐                                 │
├─────────────────────────────┼───────────────────────────────┤
│ world/        systems/       │  game/            ui/          │
│ Court         CameraDirector │  Match ──Hooks──▶ HUD          │
│ Arena         Effects        │  Team             Menu         │
│ Crowd                        │                   TouchControls │
│ Referee                      │  entities/                     │
│                              │  PlayerCharacter · Ball        │
├──────────────────────────────────────────────────────────────┤
│ core/  constants · math3d (balística) · Input · AudioEngine   │
└──────────────────────────────────────────────────────────────┘
```

### Fronteira Hooks (importante)

`Match` **não** conhece o DOM nem a UI. Ele se comunica com o mundo externo por uma interface
`Hooks` (banner, hint, setScore, serveMeter, zoneHint, slowMo, matchEnd) e por referências
injetadas (audio, effects, camera, crowd, referee, arena). O wiring acontece em `main.ts`.

> **Regra:** lógica de jogo em `game/` fala com a apresentação só via `Hooks`/referências
> injetadas. Isso mantém a partida testável e portável (essencial para desktop/mobile depois).

## Camadas

| Pasta | Responsabilidade | Arquivos |
|---|---|---|
| `core/` | Fundamentos sem estado de jogo | `constants.ts` (dimensões, física, dificuldades, cores), `math3d.ts` (solvers balísticos, easing, RNG), `Input.ts` + `input/` (fila semântica e câmera), `time/` (runner fixo e slow-motion), `AudioEngine.ts` (áudio procedural) |
| `world/` | Cenário estático e ambiente | `Court.ts`, `Arena.ts`, `Crowd.ts` (~1500 instanciados), `Referee.ts` |
| `entities/` | Atores dinâmicos | `PlayerCharacter.ts` (humanoide + animações paramétricas), `Ball.ts` (rastro, sombra) |
| `systems/` | Sistemas transversais | `CameraDirector.ts` (câmera broadcast), `Effects.ts` (partículas, confete, shake) |
| `game/` | Regras, estado, IA e controle | `Match.ts` (orquestrador), `RallyState.ts`, `Team.ts`, `simulation/` (timeline analítica), `rules/`, `mechanics/`, `ai/AiController`, `control/HumanController` |
| `ui/` | Apresentação e input do jogador | `HUD.ts`, `Menu.ts`, `TouchControls.ts` |

### Pipeline local de assets 2.0

A v1.1 continua procedural. A 2.0 pode carregar GLB, texturas e áudio versionados em
`public/assets/`, sempre por caminhos locais e manifesto. Fontes reproduzíveis vivem em
`assets-src/` ou `tools/`; o runtime nunca busca CDN/API. Render/animação consomem snapshots e
eventos da simulação, sem alterar regras ou física.

## Física

Trajetórias são resolvidas de forma **analítica** (não há integrador de física genérico) em
`core/math3d.ts`. Isso dá controle total e determinístico sobre a jogabilidade:

- `ballisticArc(p0, target, apexAbove)` — passe/levantamento em arco; garante chegada no alvo.
- `ballisticDrive(p0, target, time)` — cortada/saque tenso; resolve a velocidade dado o tempo.
- `serveDrive(p0, target, crossHeight)` — saque que cruza o plano da rede numa altura exata
  (evita o bug histórico de "todo saque na rede").
- `timeToHeight` / `positionAt` — previsão para IA e posicionamento de defensores.

Coberto por testes em `src/core/math3d.test.ts`.

## Game loop

`main.ts::frame(now)` entrega o intervalo real ao `FixedStepRunner`. O runner acumula tempo,
aplica o `SlowMotionClock` e executa somente ticks de `1/60 s`, no máximo cinco por rAF e com
janela real limitada a 250 ms. Cada ticket contém o cutoff monotônico usado para consumir o
`InputHub`; pausas executam zero ticks. Em `wall-cap`, somente ação/carga antiga é cancelada e a
direção fisicamente mantida sobrevive; o limite de passos também preserva estado contínuo para
hardware lento.

Dentro de cada tick, `MatchTimeline` integra bola, atletas e timers até o próximo evento analítico
(callback, contato, rede, antena, pulo ou chão), resolve-o e continua pelo tempo restante. No fim,
`Match.present(alpha)` interpola bola, atletas, marker, sombra e ponta do rastro sem alterar estado
lógico. Câmera, HUD, áudio e renderer continuam uma vez por rAF.

---

## Estrutura de `game/` (refatoração concluída)

A Fase 1 — quebrar o antigo `Match.ts` monolítico (~1100 linhas) — está **concluída**.
`Match` é o orquestrador de state machine/event queue. Ele está acima do tamanho-alvo e não deve
crescer; novos contratos, seletores, input e IA entram em módulos focados e testáveis. A lógica
vive em colaboradores focados, cada um sobre um **contexto injetado** (a fatia do `Match` que ele
precisa) em vez de acessar o `Match` inteiro.

### Estrutura atual

```
src/game/
├── Match.ts              orquestrador: state machine, event queue, update loop, makeCtx/makeScoringCtx
├── RallyState.ts         estado do rally (posse, nº de toques, plano do contato, eventos de rede)
├── simulation/
│   ├── EventTimeline.ts  seleção determinística por instante, prioridade e sequência
│   └── MatchTimeline.ts  segmentação do tick e integração dos eventos da partida
├── rules/
│   ├── scoring.ts        funções puras: rally point, set/match point, vantagem de 2, ace, queda
│   ├── rotation.ts       rodízio de 6 posições
│   └── SetMatch.ts       orquestração ponto → set → partida sobre ScoringCtx
├── mechanics/
│   ├── context.ts        MechanicsCtx — fatia do Match injetada nas mecânicas
│   ├── serve.ts          performServe, aiServe
│   ├── touch.ts          executeTouch, doPass, doSet, doSpike (inclui escolha de alvo da IA)
│   ├── block.ts          geometria pura + prepareBlock, resolveBlock
│   └── net.ts            geometria de cruzamento da rede
├── ai/
│   └── AiController.ts   decisões por dificuldade: aproximação, pulos agendados, qualidade, saque
└── control/
    ├── ControlFrame.ts      InputFrame já convertido para o plano da quadra
    ├── HumanController.ts  ControlFrame → intenções (mira, timing, zona) + estado + marker
    └── timing.ts           helpers puros timing → qualidade (recepção/pulo)
```

### Pipeline de controle 2.0

`KeyboardInput` e `TouchControls` escrevem no mesmo `InputHub`. O hub preserva press/release
timestamped e cancelamentos explícitos; `main.ts` converte o `InputFrame` de espaço de tela pelo
snapshot de `CameraDirector.inputBasis()` e entrega somente `ControlFrame` ao jogo. Assim,
`game/` não conhece DOM, códigos de tecla, eventos sintéticos nem Three.js para interpretar direção.

> A escolha de alvo da IA ficou em `mechanics/` (já lê `ctx.diff` e nunca depende de `aim`/
> `chosenZone` do humano), então `ai/targeting.ts` do plano original não foi necessário.

### Padrão a seguir (strangler, com TDD)

O mesmo método que quebrou o `Match` vale para qualquer mudança em `game/`:

1. **Congele o comportamento com testes primeiro** — regras/lógica pura ganham teste de
   caracterização antes de mover (padrão de `math3d`/`scoring`/`timing`).
2. **Extraia funções puras** (sem estado, sem `this`) e cubra-as.
3. **Estado explícito** (`RallyState`) em vez de campos espalhados no `Match`.
4. **Colaboradores sobre contexto injetado** (`MechanicsCtx`/`ScoringCtx`): o `Match` mantém o
   estado e fornece uma fatia via getters (valores mutáveis) e métodos de intenção (transições
   de estado) — não exponha os internos crus.
5. Rode `npm run check` + `/playtest` a cada passo. Nenhum passo muda comportamento observável;
   se mudar, é bug — investigue (skill `superpowers:systematic-debugging`).

> Meta atingida: cada regra/mecânica testável isoladamente, IA e controle humano plugáveis, e
> nenhum arquivo de `game/` acima de ~300 linhas exceto o próprio `Match` (o orquestrador).

## Convenções de código

Ver [CLAUDE.md](../CLAUDE.md#convenções) e [CONTRIBUTING.md](../CONTRIBUTING.md).
