# Fase 2B — Simulação fixa, timeline analítica e interpolação

> **Execução:** TDD, commits pequenos diretamente em `main`, revisão independente e deploy
> publicável ao fim da fase.

**Objetivo:** tornar a partida determinística a 60 Hz independentemente do FPS de renderização,
consumir input no tick correto, descartar stalls sem espiral de morte, resolver eventos físicos no
instante analítico e interpolar a apresentação entre snapshots.

**Arquitetura:** o relógio DOM/rAF continua sendo a autoridade dos timestamps de input. Um runner
puro percorre cada intervalo real, converte-o em tempo escalado pela câmera lenta e chama ticks
fixos de `1/60 s`. Cada tick carrega o cutoff real até onde pode consumir o `InputHub`. `Match`
executa regras/física somente nos ticks; câmera, HUD e áudio continuam uma vez por rAF. A timeline
da partida segmenta cada tick nos eventos analíticos que ocorrerem dentro dele. Ball/Athlete
preservam snapshots anterior/atual e `Match.present(alpha)` altera somente transforms visuais.

```text
rAF(now) ── FixedStepRunner + SlowMotionClock
              ├─ descarte/cancelamento de stall
              ├─ tick 1/60 + inputThroughMs ── InputHub ── Match.step
              ├─ tick 1/60 + inputThroughMs ── InputHub ── Match.step
              └─ alpha ── Match.present ── Camera/HUD/Audio/renderer

Match.step ── EventTimeline ── integra até evento ── resolve ── integra restante
```

## Invariantes

- Passo interno exato: `1/60 s`; nunca usar `rawDt` em regras, bola ou movimento de atleta.
- Cada rAF aceita no máximo `250 ms` reais e executa no máximo `5` ticks.
- Excesso é descartado, contabilizado e cancela input/cargas do trecho descartado.
- Input mantém timestamps `performance.now()`; não converter evento DOM para `simTime`.
- `inputThroughMs` é monotônico e representa o ponto real exato que completou cada tick.
- A câmera lenta escala tempo acrescentado; não muda o tamanho do passo interno.
- Câmera lenta é piecewise-constant, avança somente em tempo real ativo e congela na pausa.
- Pausa executa zero ticks, zera backlog fracionário e drena input sem entregá-lo ao jogo.
- Eventos no mesmo instante usam prioridade e sequência estáveis; nenhum loop de tempo zero.
- Interpolação altera meshes/transforms, nunca estado lógico usado por regras ou IA.
- Mesmo input/seed produz o mesmo estado final renderizando a 30, 60 ou 120 Hz.

## Tarefa 1 — Runner temporal e câmera lenta puros

**Arquivos:**

- Criar: `src/core/time/FixedStepRunner.ts`
- Criar: `src/core/time/FixedStepRunner.test.ts`
- Criar: `src/core/time/SlowMotionClock.ts`
- Criar: `src/core/time/SlowMotionClock.test.ts`
- Modificar: `src/core/constants.ts`
- Modificar: `src/core/constants.test.ts`

1. Escrever RED para 30/60/120 Hz, passo exato, alpha, primeira frame, timestamp regressivo,
   pausa, resume e cutoff de input monotônico.
2. Fixar em tuning tipado: `hz=60`, `maxRealFrame=0.250`, `maxStepsPerFrame=5`.
3. Implementar runner callback-driven: o callback de tick pode acionar slow motion e o restante do
   mesmo frame precisa observar a nova escala.
4. Modelar `SlowMotionClock` com `scale`, `secondsUntilBoundary`, `trigger()` e
   `advanceActiveReal()`, sem relógio global.
5. Testar fronteiras exatas de duração/escala, retrigger e congelamento em pausa.
6. Testar stall >250 ms e backlog >5 ticks: emitir diagnóstico de wall/simulation descartados e
   callbacks de descarte nos pontos corretos.
7. Rodar testes focados, typecheck, lint e format. Esperado: GREEN.

## Tarefa 2 — Integrar o runner ao composition root

**Arquivos:**

- Modificar: `src/main.ts`
- Modificar: `src/core/Input.ts`
- Modificar: `src/core/input/InputFrame.ts`
- Modificar: `src/ui/TouchControls.ts`
- Modificar: `tests/e2e/gameHarness.ts`

1. Escrever teste de integração puro que injeta os mesmos eventos em schedules de render
   30/60/120 Hz e obtém a mesma sequência de frames/ticks.
2. Trocar `match.update(rawDt*timeScale)` por `runner.advance(..., onTick)`.
3. Em cada ticket: `input.consumeUntil(inputThroughMs)`, mapear pela base de câmera renderizada e
   chamar `match.step(FIXED_DT, controlFrame, ticket)`.
4. Em pausa/título/fim: drenar input até `now`, executar zero ticks e resetar backlog.
5. Em descarte: adicionar reason `stall`, cancelar hub/carga, limpar pointers touch e drenar o
   intervalo descartado antes de qualquer tick que possa enxergá-lo.
6. Expor diagnóstico DEV somente leitura (`tick`, `simulationSeconds`, `alpha`, descartes) para
   E2E/perf; manter produção sem `?debug` fechada.
7. Atualizar apresentação uma vez por rAF com relógios explícitos:
   - câmera, HUD e áudio: tempo real visual;
   - regras, bola e atletas: somente ticks;
   - efeitos/referee/crowd: perfil documentado e testado, sem atualização acidental em substeps.

## Tarefa 3 — Timeline analítica dentro do tick

**Arquivos:**

- Criar: `src/game/simulation/EventTimeline.ts`
- Criar: `src/game/simulation/EventTimeline.test.ts`
- Modificar: `src/game/Match.ts`
- Modificar: `src/game/Match.test.ts` ou testes de caracterização equivalentes
- Modificar: `src/game/RallyState.ts`
- Modificar: `src/game/RallyState.test.ts`
- Modificar: `src/entities/Ball.ts`
- Modificar: testes de bola/matemática relevantes

1. Criar seletor puro de próximo evento por tempo analítico + prioridade + sequência estável.
   Cobrir scheduled callback, contato, rede, antena e chão.
2. Migrar a fila `after()` para timestamps absolutos de simulação e sequência; callback removido
   antes de executar pode agendar novos eventos com segurança.
3. Segmentar `Match.step`:
   - aplicar input/intenção uma vez;
   - escolher o evento mais próximo dentro do restante do tick;
   - integrar bola, atletas, timers e pulos exatamente até ele;
   - resolver evento e recalcular candidatos;
   - integrar o restante.
4. Calcular cruzamento do piso com `timeToHeight(BALL_RADIUS)`, posicionar a bola no ponto exato e
   só então classificar dentro/fora/pontuar.
5. Tratar eventos em `t=0` com consumo explícito/token e limite defensivo; nunca repetir o mesmo
   contato/rede no mesmo tick.
6. Testar empates, evento que agenda outro evento, mudança de estado no meio do tick, bola que
   cruza o piso e rede/contato muito próximos.
7. Manter `Match` orquestrador: cálculo/ordenação ficam no helper puro e o arquivo não cresce.

## Tarefa 4 — Interpolação visual sem contaminar a simulação

**Arquivos:**

- Modificar: `src/entities/Ball.ts`
- Modificar: `src/game/Team.ts`
- Modificar: `src/game/control/HumanController.ts`
- Modificar: `src/game/Match.ts`
- Modificar: testes de Ball/Team/HumanController

1. Antes de cada tick, capturar snapshots previous; após o tick, preservar current lógico.
2. Implementar `present(alpha)` para bola, atletas e marker, usando lerp planar/vertical e menor
   arco para rotação.
3. Sincronizar `CameraDirector.ballPos` com a posição apresentada, não com mutação lógica parcial.
4. Garantir que `present()` não altera `Ball.pos`, `Athlete.pos`, velocidade, target, timers ou
   decisões de contato.
5. Snap/warp/hold/launch sincronizam previous=current para impedir ghosting.
6. Testar alpha 0/0,5/1, teleporte, ângulo cruzando ±π e repetição de `present()` sem drift.

## Tarefa 5 — Invariância, revisão, playtest e publicação

**Arquivos:**

- Criar/modificar: testes de simulação/invariância
- Modificar: `tests/e2e/performance.spec.ts`
- Modificar: `tests/e2e/pause.spec.ts`
- Modificar: `tests/e2e/smoke.spec.ts`
- Modificar: `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`

1. Provar automaticamente o mesmo resultado a 30/60/120 Hz para input timestamped idêntico.
2. Provar slow motion no meio de um rAF, pausa/resume, frame de 1 s, input durante trecho
   descartado e nenhuma ação atrasada após stall.
3. E2E DEV observa tick/alpha; pausa congela simulationSeconds; stall forçado incrementa métrica e
   não dispara saque/ataque pendente.
4. Rodar playtest real desktop e touch landscape, screenshots e console; comparar perf com baseline.
5. Executar agente de code review independente; corrigir findings válidos e repetir todos os gates.
6. Commit/push direto na única `main`, acompanhar Actions/Pages e repetir smoke público.

## Gate final

```powershell
npm run check
npm run build
npm run test:e2e
npm run test:e2e:smoke:prod
git status --short
```

- [ ] Simulação executa somente em ticks de 1/60 s.
- [ ] Input é consumido uma vez no cutoff real correto de cada tick.
- [ ] Slow motion é determinística, piecewise e congela na pausa.
- [ ] Stall respeita 250 ms/5 ticks, registra descarte e não deixa ação atrasada.
- [ ] Contato/rede/antena/chão são resolvidos por instante analítico dentro do tick.
- [ ] Interpolação não altera estado lógico.
- [ ] Invariância 30/60/120 Hz está automatizada.
- [ ] E2E, playtest, review, CI, Pages e smoke público estão verdes.
- [ ] Remoto continua literalmente somente `main`.
