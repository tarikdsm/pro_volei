# Arquitetura

Como o Pró Volei é montado hoje e para onde a estrutura de código deve evoluir.

## Visão geral

O jogo é uma aplicação web single-page. `src/main.ts` monta o renderer Three.js, o mundo
(quadra, arena, torcida, juiz), os sistemas (câmera, efeitos) e a partida (`Match`), e roda
o game loop via `requestAnimationFrame`. Tudo é procedural e offline.

```
┌─────────────────────────────────────────────────────────────┐
│ main.ts  — renderer · scene · game loop · slow-motion         │
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
| `core/` | Fundamentos sem estado de jogo | `constants.ts` (dimensões, física, dificuldades, cores), `math3d.ts` (solvers balísticos, easing, RNG), `Input.ts` (teclado/mouse), `AudioEngine.ts` (áudio procedural) |
| `world/` | Cenário estático e ambiente | `Court.ts`, `Arena.ts`, `Crowd.ts` (~1500 instanciados), `Referee.ts` |
| `entities/` | Atores dinâmicos | `PlayerCharacter.ts` (humanoide + animações paramétricas), `Ball.ts` (rastro, sombra) |
| `systems/` | Sistemas transversais | `CameraDirector.ts` (câmera broadcast), `Effects.ts` (partículas, confete, shake) |
| `game/` | Regras, estado e IA | `Team.ts` (atletas, rodízio), `Match.ts` (máquina de estados do rally) |
| `ui/` | Apresentação e input do jogador | `HUD.ts`, `Menu.ts`, `TouchControls.ts` |

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

`main.ts::frame(now)` a cada quadro: calcula `dt` (com `timeScale` para slow-motion),
avança `match.update(dt, input)`, atualiza torcida/juiz/efeitos/áudio/HUD/câmera e renderiza.
O slow-motion é acionado pelos hooks (ex.: spike-cam no contato da cortada).

---

## Refatoração-alvo

**Prioridade nº 1 do projeto.** `src/game/Match.ts` (~975 linhas) concentra máquina de estados,
regras, IA e controle humano num só arquivo. Hoje ele já é organizado por seções comentadas
(SAQUE · PLANEJAMENTO · TOQUES · PONTO · UPDATE) — essas seções são as costuras naturais.

### Destino proposto

```
src/game/
├── Match.ts              orquestrador fino: referências, event queue, roda o update loop
├── RallyState.ts         estado do rally (posse, nº de toques, fase, bola em jogo)
├── rules/
│   ├── Scoring.ts        awardPoint, rally point, set/match point, vantagem de 2
│   ├── Rotation.ts       rodízio de 6 posições
│   └── SetMatch.ts       endSet, endMatch, formatos (15 / melhor de 3 a 25)
├── ai/
│   ├── AiController.ts   decisões por dificuldade (quando/como sacar, atacar, bloquear, defender)
│   └── targeting.ts      escolha de alvos (cantos, longe da defesa)
├── mechanics/
│   ├── Serve.ts          beginServePrep, performServe
│   ├── Touch.ts          executeTouch, doPass, doSet, doSpike
│   └── Block.ts          prepareBlock, resolveBlock, computeNetEvent
└── control/
    └── HumanController.ts  Input → intenções (mira, timing do toque/pulo, zona de ataque)
```

### Abordagem (strangler, com TDD)

Refatorar um motor de jogo que já funciona é arriscado. Faça incremental e verificável:

1. **Congele o comportamento com testes primeiro.** Antes de mover código, escreva testes de
   caracterização para regras puras (pontuação, rodízio, vantagem de 2, fim de set/partida).
   `math3d` já tem testes — use o mesmo padrão.
2. **Extraia funções puras** (sem estado, sem `this`) para `rules/` e `ai/targeting.ts` e
   cubra-as. Ex.: "dado placar e formato, o set acabou? quem ganhou?".
3. **Introduza `RallyState`** como objeto de estado explícito, passado às funções extraídas,
   em vez de campos espalhados em `Match`.
4. **Mova a mecânica** (`Serve`/`Touch`/`Block`) para colaboradores que recebem `RallyState`
   e `Hooks`. `Match` passa a delegar.
5. **Separe IA e controle humano** (`AiController` vs `HumanController`) — hoje entrelaçados
   por flags `isHuman` dentro de cada método.
6. Rode `npm run check` a cada passo. Nenhum passo deve mudar o comportamento observável;
   quando algo mudar, é bug — investigue (ver skill `superpowers:systematic-debugging`).

> Meta: nenhum arquivo de `game/` acima de ~250 linhas, cada regra testável isoladamente,
> IA plugável (facilita ajustar/adicionar dificuldades).

## Convenções de código

Ver [CLAUDE.md](../CLAUDE.md#convenções) e [CONTRIBUTING.md](../CONTRIBUTING.md).
