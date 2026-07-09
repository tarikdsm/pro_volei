# Resultado da execução — Plano de correção 2026-07-08

Execução **autônoma e serial** do [plano de correção](2026-07-08-plano-de-correcao.html),
derivado da [auditoria ampla](2026-07-08-codereview-amplo.html). Um agente executor de
contexto zerado por passo (Opus 4.8), na ordem por dependência, sem interação humana.

## Resumo executivo

- **34/34 passos concluídos. 0 pulados.**
- Suíte de testes: **60 → 267 testes Vitest** (+207), 32 arquivos de teste. Todos verdes.
- **`npm run check` VERDE** (typecheck + lint + format:check + test).
- **`npm run build` VERDE** (`vite build`, ~604 kB / 156 kB gzip).
- **e2e Playwright VERDE**: 8/8 (`smoke`, `pause` ×3, `matchEnd` ×3, `touch` mobile). O
  `performance.spec.ts` foi mantido fora dessa contagem por gravar artefato versionado
  (`docs/perf/baseline-latest.json`); é baseline informativo, não gate.
- Cada passo é **um commit verde** na branch `main`. Sem push, sem PR, sem branch nova.

## Baseline

A base estava **vermelha** só por Prettier em dois HTMLs de code review (o próprio relatório
amplo e o plano). Decisão autônoma: normalizar a formatação uma vez para dar um gate "verde"
objetivo e uniforme a todos os 34 executores — evitando que `npm run format` de cada agente
varresse esses docs para commits de escopo alheio. Commit de baseline: `f35f132`.

## Passos concluídos

| # | Item | Fase | Commit | Resumo |
|---|------|------|--------|--------|
| 1 | M14 | 0 | `78650ef` | Injeção de `CharFactory`/`CharVisual` — Team/Athlete instanciável em Node (destrava T5/M4/T3). |
| 2 | A1 | 1 | `079dd45` | Helper puro `integrateBallistic` — integração balística exata (fim do Euler semi-implícito). |
| 3 | A2 | 1 | `7064da4` | Snap ao ponto analítico no sucesso do contato/rede/bloqueio; helper `netTouchPoint`. |
| 4 | M1 | 1 | `8326491` | Guard `isBlockable` — falta de rede vence bloqueio no mesmo cruzamento. |
| 5 | A3 | 1 | `ec0912d` | Flag `jumped` por bloqueador + `RallyState.reset()` completo (sem vazar agendamento). |
| 6 | A4 | 1 | `758b73c` | Zera posse no "stuff" para liberar a cobertura (dig) do ataque bloqueado. |
| 7 | B1 | 1 | `60b7a8f` | `excludedPasser` — evita contato consecutivo do mesmo atleta no replanejamento de pass. |
| 8 | M2 | 2 | `4405d31` | Cruzamento fora das antenas classificado como falta (`outAntenna`), resolvido na hora. |
| 9 | M3 | 2 | `55fdfa7` | Alternância FIVB do primeiro sacador entre sets; sorteio no set decisivo. |
| 10 | M4 | 2 | `f6918c3` | `Team.resetLineup()` + `initialSlots()` chamados em `startMatch`. |
| 11 | T3 | 2 | `825f7d2` | Cobertura completa de `SetMatch` (awardPoint/endSet/side-out/rodízio/ace); mutation-tested. |
| 12 | M7 | 3 | `7fa98cc` | Reducer `appState` + guard de `e.repeat` + cancelamento da carga de saque na pausa. |
| 13 | M5 | 3 | `ba60437` | WASD move na recepção sem trocar zona de ataque. |
| 14 | M6 | 3 | `2f39423` | `camModeForTouch` — câmera volta ao modo rally após a cortada. |
| 15 | M8 | 3 | `40a18c3` | `AudioEngine.resume` idempotente (iOS/pausa/`visibilitychange`). |
| 16 | T4 | 3 | `7663eca` | Seams puros `KeyState`/`touchMapping` + testes de Input/UI (pausa, release, zona). |
| 17 | INFRA | 4 | `b5b751e` | Harness `npm run perf:baseline` (fora do gate) + teste de schema do artefato. |
| 18 | M11 | 4 | `b7f38e1` | Scratch `Vector3` por-instância em `Athlete.update` e no shake da câmera. |
| 19 | M9 | 4 | `5fc855c` | Throttle da torcida por tick fixo (`advanceCrowdTick`, `CROWD.*`) + remoção de atan2. |
| 20 | M10 | 4 | `e62a3c5` | Predicado `meshCastsShadow` — exclui estampas transparentes do shadow pass. |
| 21 | B9 | 4 | `ea81902` | `TrailBuffer` — ring buffer pré-alocado para o rastro da bola. |
| 22 | B10 | 4 | `54ae132` | Projeção da câmera recalculada só quando o FOV muda (offset já pré-alocado no M11). |
| 23 | B11 | 4 | `120e2f9` | Partículas: `needsUpdate` só com partícula viva + swap-remove O(1). |
| 24 | M12 | 5 | `3123f28` | Hook de formatação sem shell (`execFileSync`) + `resolveTargetFile` anti path-traversal. |
| 25 | M13 | 5 | `0c3e2ce` | Pin de `@playwright/mcp@0.0.77` (fora do `@latest`) + teste-guarda. |
| 26 | B5 | 5 | `982aa04` | `window.__match`/`__renderer` só em DEV ou via `?debug` (predicado `exporDebugHabilitado`). |
| 27 | B6 | 5 | `38ad8aa` | Dev server em `localhost` por padrão + script opt-in `dev:lan`. |
| 28 | B7 | 5 | `3fe381b` | `npm run deploy` roda `check` antes de build/publish (gate reprodutível local). |
| 29 | B8 | 5 | `f7da7b0` | Remove badges remotos do README + guard "sem assets remotos" nos docs. |
| 30 | B2 | 6 | `5a106b3` | Centraliza tuning `BLOCK`/`HUMAN_TIMING`/`SERVE_TUNING` em constants (valores 1:1). |
| 31 | B3 | 6 | `05cd3f1` | `role`/`aria-label` nos controles de toque (`TOUCH_A11Y`/`ZONE_A11Y`). |
| 32 | B4 | 6 | `f634a14` | `env(safe-area-inset-*)` com fallback nos controles de toque + `max()` no `#hint`. |
| 33 | B12 | 6 | `dc4846e` | Remove enums mortos `GameState`/`RallyPhase` + ROADMAP com a Fase 1 concluída. |
| 34 | T6 | 7 | `c81a3c4` | e2e de pausa/toque/fim de partida + costura DEV `debugWinMatch` + projeto mobile. |

Nenhum passo foi pulado; nenhum precisou de segunda tentativa por falha de gate.

## Decisões autônomas tomadas (pré-resolvidas no plano)

- **Baseline normalizado**: formatação dos dois HTMLs de code review para dar gate verde
  uniforme (commit `f35f132`). Só whitespace; conteúdo/render inalterados.
- **Telemetria (Pacote 2)**: NÃO implementada — é feature nova, não achado.
- **CSP inicial (Pacote 3)**: NÃO implementada — risco de quebrar WebGL/canvas/blob;
  registrada como follow-up.
- **Baseline de perf (passo 17)**: executado, mas FPS **nunca** virou gate de CI (headless
  ~9 FPS é flaky). O harness roda por `npm run perf:baseline`, fora do `npm run check`.
- **Deploy (passo B7)**: apenas o gate local (`deploy` roda `check` antes). A migração para
  GitHub Actions/Pages foi **deliberadamente adiada** (ROADMAP Fase 4) e documentada em
  `docs/deployment/web.md` como follow-up.
- **Regressão visual de canvas (passo T6)**: `toHaveScreenshot` de canvas WebGL evitado
  (flaky); a cobertura de pausa/toque/fim de partida usa asserções de estado/DOM (`expect.poll`).

## Follow-ups registrados (fora do escopo desta execução)

- **M14**: propagar `makeChar` de `Match` para os `new Team(...)` tornaria `Match` testável em
  Node — mudança maior, opcional.
- **A2/A3**: velocidade da bola no bloqueio fica ~1 frame stale; recalcular analiticamente em
  `cross.t` só se algum tuning futuro depender de velocidade fina. Fidelidade de altura prevista
  do bloqueio da IA (A3 passo 6) exige revalidar `blockReach`/`blockChance` via playtest.
- **M4**: o fluxo "JOGAR DE NOVO" usa `location.reload()`; ao migrar para Tauri/Capacitor,
  trocar por reinício em-processo para o `resetLineup` valer.
- **B10**: guard de FOV usa igualdade exata; se o FOV passar a ser suavizado por damping,
  trocar por tolerância (epsilon).
- **B4**: o `400px` do `#hint` é número mágico acoplado ao tamanho dos controles — extrair para
  custom property `--tc-side-reserve`.
- **M9**: mover a animação da torcida para vertex shader (`InstancedBufferAttribute`) eliminaria
  todo o reupload por frame.
- **CSP** e **deploy contínuo (Actions/Pages)**: adiados conforme decisões acima.
- **T6**: baselines de regressão visual só de painéis DOM (canvas mascarado) num ambiente de CI
  fixo, se desejado.

## Estado final

```
npm run check  → typecheck ✓  lint ✓  format:check ✓  test: 267 passed (32 files)
npm run build  → vite build ✓  (dist/assets ~604 kB / 156 kB gzip)
npm run test:e2e (sem perf) → 8 passed (smoke, pause ×3, matchEnd ×3, touch mobile)
git status → limpo; 35 commits na main (1 baseline + 34 passos)
```

Os commits estão na branch `main`, prontos para revisão. Nenhum merge, PR ou push foi feito.
