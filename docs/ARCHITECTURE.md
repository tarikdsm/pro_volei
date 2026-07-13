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
| `game/` | Regras, estado, IA e controle | `Match.ts` (orquestrador), `RallyState.ts`, `Team.ts`, `simulation/` (timeline analítica), `rules/`, `mechanics/`, `strategy/`, `ai/AiController`, `control/HumanController` |
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
│   ├── MatchTimeline.ts  segmentação do tick e integração dos eventos da partida
│   ├── HeadlessRallyRunner.ts  CPU×CPU, traces, batches e checkpoint estocástico
│   ├── RallyJournal.ts        eventos físicos versionados e serialização determinística
│   └── TacticalTrace.ts       execução coletiva observável por rally
├── rules/
│   ├── scoring.ts        funções puras: rally point, set/match point, vantagem de 2, ace, queda
│   ├── rotation.ts       rodízio de 6 posições
│   └── SetMatch.ts       orquestração ponto → set → partida sobre ScoringCtx
├── mechanics/
│   ├── context.ts        MechanicsCtx — fatia do Match injetada nas mecânicas
│   ├── serve.ts          performServe + realização física guardada do saque estratégico
│   ├── touch.ts          executeTouch, doPass, doSet, doSpike e diretivas estratégicas
│   ├── block.ts          geometria pura + prepareBlock, resolveBlock
│   └── net.ts            geometria de cruzamento da rede
├── ai/
│   └── AiController.ts   aproximação, pulos agendados e rolagens de qualidade por dificuldade
├── strategy/
│   ├── StrategyTypes.ts              DTOs e vocabulário estratégico
│   ├── CourtZones.ts                 opções canônicas e espelhamento da quadra
│   ├── StrategyObservationAdapter.ts observação pública validada, frozen e whitelisted
│   ├── StrategyMemory.ts             memória limitada de escolhas e resultados
│   ├── OpponentBrain.ts              pontuação e escolha de candidatas
│   ├── OpponentStrategySystem.ts     percepção atrasada, commits, outcomes e outbox
│   ├── StrategicServeSystem.ts       lifecycle causal do saque adaptativo
│   ├── StrategicOffenseSystem.ts     lifecycle causal de set, ataque e fallbacks seguros
│   ├── OwnContactRead.ts             propriocepção validada depois do contato executado
│   ├── ServeReceptionOutcome.ts      efetividade física da recepção
│   ├── StrategyTrace.ts              auditoria headless canônica, quantizada e hashável
│   ├── MatchStrategyBridge.ts        porta estrutural sobre os sistemas privados
│   └── MatchStrategyCoordinator.ts   wiring de lifecycle, observação e hooks do Match
└── control/
    ├── ControlFrame.ts      InputFrame já convertido para o plano da quadra
    ├── kinematics.ts        aceleração/frenagem compartilhadas por Athlete e ETA
    ├── AutoSelector.ts      score, histerese, máximo de trocas e lock por plano
    ├── AutoSelectionSession.ts adaptação Team/Athlete → candidatos de recepção/bloqueio
    ├── HumanAutoControl.ts  rebind + alvo manual + assistência limitada
    ├── ActionIntent.ts      DTO semântico de gesto/técnica/parâmetros
    ├── ActionButtonMachine.ts tap/hold/buffer/cancel por token e tick fixo
    ├── ActionResolver.ts    matriz pura contexto × gesto → técnica
    ├── ActionControl.ts     adaptador ControlFrame + pending até o contato
    ├── HumanController.ts  movimento/mira + ActionControl + estado + marker
    └── timing.ts           helpers puros timing → qualidade (recepção/pulo)
```

### Pipeline de estratégia — marco 3A–3C concluído

`Match` delega o wiring ao `MatchStrategyCoordinator`, que acessa a estratégia somente pela porta
estrutural `MatchStrategyPort`; o bridge mantém `OpponentStrategySystem`,
`StrategicServeSystem` e `StrategicOffenseSystem` privados. A instância de produção recebe dois
streams determinísticos exclusivos do `RandomHub`, `strategy.home` e `strategy.away`, separados de
`rules`, `ai`, `contact` e `control`. Assim, decisões de um lado e mudanças na estratégia não
deslocam o orçamento aleatório das demais camadas.

No início de cada tick, logo depois de `Match` registrar `simulationTick` e antes de consumir input
ou avançar a simulação, o coordinator captura uma observação canônica. O adaptador aceita somente o recorte
público permitido: placar, fase, posse, saque, toques, bola e os 12 atletas na ordem atual dos
`Team.slots`. A estratégia percebe versões atrasadas desse histórico de acordo com a dificuldade;
ela não recebe objetos internos do `Match`, previsões privadas nem o input do tick corrente.

Cada preparação de saque abre um token de época. No saque da CPU, o atraso de apresentação consome
uma única rolagem de `ai`; o commit estratégico usa o stream do lado e, se a percepção ainda não
estiver pronta, tenta novamente um tick depois sem novo draw de `ai`. Guardas validam partida,
saque, lado e atleta no toss e no hit. Depois da realização física validada, o bridge marca o saque
e libera seu `ServeOutcomeToken`; a mecânica então chama `ball.launch` e publica o contato de
domínio. O token segue pelo `RallyState` e pelos `TouchPlan`.

Os hooks de domínio `MechanicsCtx.onBallContact` e `ScoringCtx.onPointResolved` fecham o outcome
uma única vez: pela primeira recepção adversária válida ou pelo ponto, ainda com o lado sacador
anterior à troca de saque. Esse caminho é interno e independente da telemetria; ausência ou falha
do sink de telemetria não muda memória, decisão nem resolução estratégica. Tokens de partida e
saque descartam callbacks antigos e impedem dupla resolução. Saque, levantamento e ataque da CPU
estão ligados a esse lifecycle adaptativo.

Depois de um passe executado, o coordinator cria `OwnContactRead` somente com a bola já lançada e
o elenco próprio atual. A leitura é combinada com o snapshot adversário atrasado para escolher a
levantadora, comprometer corredor/tempo e preparar o ataque sem reler a defesa. O bind ocorre
depois de o `TouchPlan` receber `planId`, `tacticalRevision` e atleta; mechanics apenas consome a
identidade confirmada. Set alto, rápido e acelerado têm voos distintos; power, placed e tip têm
realizações físicas distintas. Posse, plano ou ponto obsoleto revogam o compromisso, e fallbacks
tipados preservam uma bola jogável sem gerar memória falsa.

No headless, `StrategyTraceCollector` recebe o outbox comprometido e registra candidatas
quantizadas, escolha, ticket, janela de dois draws e outcome terminal. O fechamento de cada batch
exige cardinalidade igual às sequências comprometidas, zero outcome pendente e draws reais iguais
ao budget. `HeadlessStochasticCheckpoint` reúne `RandomHub` e estratégia na fronteira de ponto;
um fingerprint de placar, rotação, tick e epochs impede seu uso como rewind do estado físico.
Restore é transacional e reverte RNG e estratégia se qualquer metade falhar. O browser de produção
não instancia nem retém esse histórico de diagnóstico.

### Pipeline de controle 2.0

`KeyboardInput` e `TouchControls` escrevem no mesmo `InputHub`. O hub preserva press/release
timestamped e cancelamentos explícitos; `main.ts` converte o `InputFrame` de espaço de tela pelo
snapshot de `CameraDirector.inputBasis()` e entrega somente `ControlFrame` ao jogo. Assim,
`game/` não conhece DOM, códigos de tecla, eventos sintéticos nem Three.js para interpretar direção.

`ActionButtonMachine` consome esse frame uma vez por tick: menos de 12 ticks é tap, 12 ou mais é
hold, a carga chega a 1 após mais 30 ticks e um press até 9 ticks cedo vira buffer. O gesto fica
preso ao `planId`, sobrevive à troca de atleta do mesmo plano e é cancelado por token/lifecycle.
`ActionResolver` gera `ActionIntent` neutra de engine; `ActionControl` a retém até `Match` entregá-la
a `touch`/`block`. Teclado e touch nunca possuem gramáticas paralelas.

Recepção/defesa e bloqueio passam por `AutoSelector`. O ETA replica o mesmo integrador planar de
`Athlete.update`, inclusive velocidade lateral, aceleração e frenagem. A atribuição inicial não
conta como troca; depois exige score 15% menor, aceita no máximo duas trocas e trava nos 350 ms
finais. Ataque, levantamento e saque permanecem fora desse seletor. O alvo manual é a âncora da
assistência, que corrige no máximo 0,65 m sem acumular ou mover diretamente a atleta.

> Saque, levantamento e ataque da CPU são escolhidos por `strategy/OpponentBrain.ts` sobre opções
> de `CourtZones.ts`. `mechanics/serve.ts` e `mechanics/touch.ts` aplicam qualidade, erro,
> dispersão e trajetória às diretivas já comprometidas; não pontuam candidatas nem retargeteiam.

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
