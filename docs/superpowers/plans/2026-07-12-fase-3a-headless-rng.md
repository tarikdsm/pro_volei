# Fase 3A — RNG determinístico e simulação headless

> **Execução:** TDD, migração serial dos consumidores de aleatoriedade, contratos neutros antes do
> runner, commits atômicos em `main`, revisão independente e publicação comprovada no Pages.

**Objetivo:** tornar o resultado de gameplay reproduzível por seed e executar rallies completos em
Node, sem DOM, canvas, WebGL, áudio ou efeitos. A mesma seed e a mesma agenda de input devem gerar
o mesmo journal; apresentação, device tier e sample rate não podem alterar física ou decisões.

**Não objetivos:** TeamBrain/formações (3B), escolhas táticas avançadas (3C), balanceamento de mil
rallies (3D), snapshot serializável no meio de um rally, replay visual, rig/animação ou PWA.

## Decisões canônicas

- Algoritmo `xoshiro128**` versionado, quatro `uint32`, sem `BigInt`; seed raiz pública `uint32`.
- Browser aceita `?seed=<uint32>`; sem parâmetro usa `crypto.getRandomValues` uma vez por partida.
- Streams nomeados derivados sem consumir o pai: `rules`, `ai`, `contact` e `control`.
- Apresentação nunca recebe streams de gameplay. `Ball` visual, Crowd, Effects e Audio podem manter
  aleatoriedade cosmética isolada nesta fase; variar/desligar esses sistemas não muda o journal.
- `RandomSource` oferece `nextUint32`, `nextFloat`, `range`, `chance`, `pick`, snapshot/restore e
  contador de draws. Estado inclui algoritmo/versão e rejeita payload incompatível.
- Mecânicas recebem RNG explicitamente por `MechanicsCtx`; não há fallback ambiental.
- `src/game/**` fica proibido de chamar `Math.random` ou helpers globais sem fonte explícita.
- O primeiro checkpoint seguro é a fronteira entre pontos. Closures de `MatchTimeline` impedem
  snapshot mid-rally; eventos tipados ficam para uma fatia posterior se replay exigir.
- Headless ainda pode usar `three` apenas como biblioteca matemática (`Vector3`, `Group` vazio);
  não pode construir textura, canvas, renderer ou acessar `document/window`.
- `humanSide: null` significa AI × AI. Regras que hoje inferem humano por `TeamSide.HOME` passam a
  consultar `ctx.isHumanSide(side)` ou `plan.isHuman`.

## Arquitetura

```text
seed uint32
    │
    ▼
RandomHub ── rules / ai / contact / control
    │                    │
    └──────────► Match + MechanicsCtx
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
 browser adapters                   Headless adapters
 Ball + PlayerCharacter             HeadlessBall + HeadlessCharacter
 real presentation hooks            no-op hooks + SimulationTelemetry
        │                                 │
        └──────────── same Match ─────────┘
                                          │
                                          ▼
                               HeadlessRallyRunner + journal
```

## Tarefa 1 — núcleo RNG e seeds reproduzíveis

1. Criar `core/random/RandomSource.ts`, `Xoshiro128StarStar.ts`, `RandomHub.ts` e testes.
2. Fixar golden vectors de `nextUint32`/`nextFloat`, inclusive seed zero, wrap `uint32` e 10 mil
   draws sem valor fora de `[0,1)`.
3. Derivar streams por hash estável de `(rootSeed, nome)`; ordem de criação não altera sequência.
4. Snapshot/restore reproduz exatamente o sufixo e registra `algorithm`, `state[4]` e `draws`.
5. Criar `SequenceRandom` somente para testes de ramos exatos; remover spies de `Math.random` dos
   testes de gameplay à medida que cada consumidor migrar.
6. Criar parser puro de seed: aceita decimal `0..2^32-1`, rejeita inválida; main gera seed segura,
   registra no Match e expõe `__seed`/snapshot somente com debug habilitado.

## Tarefa 2 — injeção completa no gameplay

1. `Match` recebe `RandomHub` por options e usa `rules` para saque inicial/primeiro saque de set.
2. `MechanicsCtx` expõe streams tipados e `isHumanSide(side)`.
3. Migrar `AiController`, `HumanController`, `mechanics/serve.ts`, `touch.ts`, `block.ts` e os ramos
   aleatórios do Match para `range/chance/pick` explícitos.
4. Usar `plan.isHuman`, não HOME/AWAY, para técnica, alvo e bloqueio; `humanSide: null` ativa IA
   nos dois lados sem mudar física/dificuldade.
5. Spin da bola não participa do estado físico; recebe stream cosmético opcional ou fica confinado
   ao adaptador visual, jamais consumindo stream de gameplay.
6. Adicionar guarda estática que falha se `src/game/**` contiver `Math.random` ou importar
   `rand/chance/randPick` ambientais.
7. Testar samplers de saque, passe, ataque, defesa e bloqueio com sequências explícitas, incluindo
   quantidade de draws por ramo para detectar drift acidental.

## Tarefa 3 — ports lógicos e adapters headless

1. Extrair `BallSimulationPort` com apenas estado/métodos usados por Timeline e mecânicas.
2. Fazer `Ball` visual implementar o port sem mudar browser; criar `HeadlessBall` com a mesma
   balística, sem textura/mesh/rastro e sem acesso a DOM.
3. Tornar `Match` configurável com `ball`, `CharFactory`, `humanSide` e RNG; defaults preservam o
   jogo atual. Inicialização de Team/Ball sai dos field initializers para o construtor.
4. Substituir tipos concretos de áudio/efeitos/câmera/arena em `Hooks` por interfaces estruturais
   mínimas. Classes atuais continuam satisfazendo; `HeadlessHooks` usa no-ops.
5. Criar `HeadlessCharacter` mínimo que preserva posição/ação lógica sem CanvasTexture.
6. Testar que Match AI × AI instancia em Vitest com `document/window` ausentes e nenhuma chamada
   aos hooks cosméticos é necessária para o resultado.

## Tarefa 4 — telemetry, journal e runner de rally

1. Criar `SimulationTelemetryPort` opcional com eventos readonly: rally start, serve, contact,
   block, point e rally end. Emissão não altera ordem de RNG nem física.
2. `RallyJournal` registra tick, tipo, lado, toque, alvo/qualidade quantizados e contador de draws;
   nenhum objeto Three.js ou referência mutável entra no journal.
3. `HeadlessRallyRunner` executa fixed tick de 60 Hz até um ponto ou limite defensivo, AI × AI,
   retornando winner, duração, contatos, aces, blocks, erro/ataque e journal.
4. Criar batch pequeno para 100 rallies/seed com agregação de duração/toques/resultados. A fase 3A
   prova infraestrutura e sanidade; faixas de balanceamento de 1.000 rallies pertencem à 3D.
5. Mesmo seed/options gera journal byte a byte idêntico; seeds diferentes divergem; 30/60/120 Hz
   de chamada externa chegam ao mesmo estado porque o runner usa ticks fixos.
6. Desligar áudio/efeitos, alternar torcida low/high e variar sample rate simulado não altera o
   hash do journal. Snapshot/restore dos streams na fronteira de ponto reproduz o rally seguinte.

## Tarefa 5 — integração browser e diagnóstico

1. `main.ts` cria seed antes do Match sem consumir RNG de apresentação.
2. Debug expõe cópia readonly de seed, draws por stream e último hash de journal; produção sem
   `?debug` não expõe superfície de mutação.
3. E2E abre duas páginas com `?seed=...`, executa a mesma agenda e compara snapshot/journal; outra
   seed deve divergir em ao menos um evento estocástico.
4. E2E repete com `?touch=1` e reduced motion para provar que apresentação/device não muda lógica.
5. Preservar setas + Espaço, câmera, feedback e Pages sem alteração observável fora da seed.

## Tarefa 6 — revisão, orçamento e publicação

1. Agente independente revisa RNG/stream ownership e procura qualquer fallback ambiental.
2. Agente independente revisa headless ports contra duplicação de regra/browser-only imports.
3. Rodar `npm run check`, build, E2E completo, runner headless e smoke de `dist`.
4. Meta inicial: 100 rallies headless em até 10 s no ambiente local e zero crescimento monotônico
   de listeners/timers; registrar tempo sem transformá-lo em gate de hardware.
5. Playtest browser desktop/mobile com seed visível em debug e zero erro de console.
6. Commit/push direto em `main`, acompanhar CI/Pages e repetir smoke público com seed fixa.

## Gate final

- [x] Golden vectors, streams, snapshot/restore e parser de seed estão estáveis.
- [x] Todo RNG de gameplay é explícito; apresentação não altera física/IA.
- [x] `humanSide: null` executa AI × AI usando as mesmas regras do browser.
- [x] HeadlessBall/Character/Hooks rodam sem DOM, canvas, WebGL, áudio ou timers wall-clock.
- [x] Um rally completo e batch de 100 rallies produzem métricas/journal determinísticos.
- [x] Mesma seed + inputs é idêntica; seeds diferentes divergem; 30/60/120 é invariável.
- [x] Checkpoint entre pontos reproduz o sufixo; mid-rally está explicitamente fora do escopo.
- [x] Testes, E2E, performance informativa, playtest, review, CI, Pages e smoke estão verdes.
- [x] Remoto continua literalmente somente `main`.

## Resultado de encerramento — 2026-07-12

- RNG `xoshiro128**` versionado, quatro streams nomeados e guarda estática contra aleatoriedade
  ambiental em `src/game/**`.
- `Match` configurável com ports headless, AI × AI real e física da bola compartilhada entre os
  adapters visual e lógico.
- Journal `pro-volei-rally-journal-v1`, telemetria por outbox, métricas simétricas e checkpoint de
  RNG somente na fronteira segura entre pontos.
- Batch de referência: 100 rallies, 71.111 ticks, 52 × 48, hash `3ffc9230`, 316,3 ms localmente.
- Gates locais: 72 arquivos de teste, 618 testes unitários/integrados, 15 E2E e build de produção.
- Revisões independentes encerradas sem findings em RNG, ports headless, runner/journal e browser.
- CI `29215756322` e deployment Pages `5417660432` verdes no SHA `c4fa0d6`.
- Smoke público desktop/mobile: HTTP 200, seed `305441741`, journal debug disponível, partida em
  `servePrep`, controles touch visíveis em paisagem e zero erro de console.
