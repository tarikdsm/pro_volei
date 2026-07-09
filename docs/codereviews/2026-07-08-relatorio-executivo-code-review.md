# Code Review Agêntico do Pró Volei

**Relatório executivo · consolidado**

Um ciclo completo e autônomo de qualidade: revisão por múltiplos agentes, auditoria independente item a item, plano de correção por dependência e execução serial com um agente de contexto zerado por passo. Este documento consolida os três artefatos originais (code review amplo, plano de correção e resultado da execução) no essencial.

| Achados | Passos corrigidos | Passos pulados | Testes  | check + build + e2e |
| ------: | ----------------: | -------------: | ------- | ------------------- |
|      35 |                34 |              0 | 60→267  | verde               |

Data: 2026-07-08 · Escopo: projeto inteiro (`D:\Projetos TI\Games\pro_volei`) · Regras oficiais: FIVB Official Volleyball Rules 2025-2028 · Branch: `main`, um commit verde por passo.

---

## 1. O que foi feito: um code review agêntico orquestrado

Em vez de uma revisão manual única, o processo foi dividido em quatro estágios encadeados, cada um conduzido por agentes de IA especializados. A ideia central: quem _encontra_ o problema não é quem _valida_, e quem valida não é quem _corrige_ — cada etapa é um contexto limpo e independente, reduzindo viés e erro de confirmação.

| Estágio           | O que faz                                                                                                                                                                                          | Quem                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **1. Revisão ampla**        | Sete agentes, um por eixo (regras de vôlei, física, render/perf, UI/input/áudio, IA/gameplay, segurança/deploy, arquitetura/testes), varreram o código. Achados deduplicados por causa raiz e priorizados por impacto. | gpt-5.5 · effort xhigh                        |
| **2. Auditoria independente** | Cada achado foi reauditado por um agente isolado que releu o código real, confirmou (ou reavaliou a severidade) e escreveu a correção detalhada linha a linha — filtrando falsos positivos.        | Claude Opus 4.8 · effort high · contexto zerado |
| **3. Plano de correção**      | 34 passos ordenados por dependência, agrupados em 7 fases. Cada passo traz correção auditada, testes persistentes obrigatórios, arquivos, critério de aceitação e mensagem de commit — pensado para execução 100% autônoma. | Opus 4.8 · effort high                        |
| **4. Execução serial**        | Um orquestrador disparou um agente executor de contexto zerado por passo, em série. Gate objetivo: `npm run check` verde + verificação comportamental (playtest real no browser) + um commit por passo. | Orquestrador + 34 executores Opus 4.8         |

> **Por que serial e não paralelo?** Muitos itens tocam os mesmos arquivos quentes (`Match.ts`, `main.ts`, `constants.ts`, `block.ts`). Serial evita conflito de merge e garante que cada agente parta de uma base estável e testada. Cada executor começa limpo, recebendo apenas o contrato e a seção do seu passo.

---

## 2. Os números

**Achados por severidade**

| Severidade  | Qtd. | Natureza                                     |
| ----------- | ---: | -------------------------------------------- |
| Crítico     |    0 | Nenhum bug que quebrasse o runtime.          |
| Alto        |    4 | Física da bola e lifecycle de bloqueio.      |
| Médio       |   19 | Regras, game feel, performance, segurança dev. |
| Baixo       |   12 | Limpeza, tooling, docs, acessibilidade.      |

**Antes → depois**

| Métrica                 | Base      | Final                              |
| ----------------------- | --------- | ---------------------------------- |
| Testes Vitest           | 60        | **267** (+207)                     |
| Arquivos de teste       | 7         | 32                                 |
| Suíte e2e (Playwright)  | 1 smoke   | 8 (pausa, touch, fim de set/partida) |
| `npm run check`         | vermelho\* | verde                              |
| `npm run build`         | —         | verde                              |

\* A base só estava vermelha por Prettier em dois HTMLs de code review; normalizado antes do passo 1 para dar um gate verde uniforme.

> **Baseline de performance (informativo, não é gate de CI):** Chromium headless registrou ~9 FPS, p95 de frame ~117 ms, heap ~17 MB e ~536 draw calls/frame. Reproduzível por `npm run perf:baseline`. FPS headless é flaky, portanto nunca foi transformado em critério de aprovação.

---

## 3. Os 4 achados de maior impacto (severidade alta)

- **Física — integração da bola.** `Ball.step()` integrava por Euler semi-implícito (atualizava a velocidade vertical antes da posição), deixando a bola real mais baixa que os solvers analíticos que preveem queda, rede e contato. Corrigido com integração balística exata (`integrateBallistic`).
- **Física — eventos em posição stale.** Contato, rede e bloqueio eram resolvidos com a posição do frame anterior (até ~1 m de erro em bola rápida). Corrigido com _snap_ ao ponto analítico do evento no instante do sucesso.
- **Regras/IA — lifecycle de bloqueio.** A lista de bloqueadores misturava "agendado" com "elegível" e não era limpa entre pontos — permitia bloqueio antes do salto ou pulo-fantasma no ponto seguinte. Corrigido com flag explícita `jumped` + `reset()` completo do rally.
- **Regras — cobertura pós-bloqueio.** No bloqueio "stuff" a posse não era reiniciada, e o guard de posse impedia a cobertura legal (dig) do ataque bloqueado. Corrigido zerando a posse no toque de bloqueio.

---

## 4. O que foi alterado (34 passos, por fase)

Da fundação de testabilidade à suíte de browser, na ordem em que as dependências exigiam. Cada linha é um commit verde.

### Fase 0-1 — Testabilidade e integridade físico-temporal do rally

| #   | Item | Alteração                                                                                                   | Commit    |
| --- | ---- | ---------------------------------------------------------------------------------------------------------- | --------- |
| 1   | M14  | Injeta `CharFactory`/`CharVisual`: separa o modelo lógico de Team/Athlete do visual (instanciável em Node). | `78650ef` |
| 2   | A1   | Helper puro `integrateBallistic` — integração balística exata.                                             | `079dd45` |
| 3   | A2   | Resolve contato/rede/bloqueio no ponto analítico do evento; helper `netTouchPoint`.                        | `7064da4` |
| 4   | M1   | Guard `isBlockable`: falta de rede vence bloqueio no mesmo cruzamento.                                      | `8326491` |
| 5   | A3   | Estado explícito por bloqueador (`jumped`) + `reset()` completo do rally.                                   | `ec0912d` |
| 6   | A4   | Reinicia posse no "stuff" para permitir a cobertura do ataque bloqueado.                                    | `758b73c` |
| 7   | B1   | `excludedPasser`: evita contato consecutivo do mesmo atleta no pass replanejado.                           | `60b7a8f` |

### Fase 2 — Regras oficiais de voleibol

| #   | Item | Alteração                                                                    | Commit    |
| --- | ---- | ---------------------------------------------------------------------------- | --------- |
| 8   | M2   | Cruzamento fora das antenas tratado como falta (`outAntenna`).               | `4405d31` |
| 9   | M3   | Alternância FIVB do primeiro sacador entre sets; sorteio no set decisivo.    | `55fdfa7` |
| 10  | M4   | `Team.resetLineup()` + `initialSlots()` em `startMatch`.                      | `f6918c3` |
| 11  | T3   | Cobertura completa de `SetMatch` (side-out, rodízio, set/match point, ace); mutation-tested. | `825f7d2` |

### Fase 3 — Input, câmera, áudio e estado de app

| #   | Item | Alteração                                                                        | Commit    |
| --- | ---- | -------------------------------------------------------------------------------- | --------- |
| 12  | M7   | Reducer `appState` + guard de `e.repeat` + cancelar carga de saque na pausa.      | `7fa98cc` |
| 13  | M5   | WASD move na recepção sem trocar a zona de ataque.                                | `ba60437` |
| 14  | M6   | `camModeForTouch`: câmera volta ao modo rally após a cortada.                     | `2f39423` |
| 15  | M8   | `AudioEngine.resume` idempotente (iOS/pausa/`visibilitychange`).                 | `40a18c3` |
| 16  | T4   | Seams puros `KeyState`/`touchMapping` + testes de Input/UI.                       | `7663eca` |

### Fase 4 — Performance de render

| #   | Item  | Alteração                                                                    | Commit    |
| --- | ----- | ---------------------------------------------------------------------------- | --------- |
| 17  | INFRA | Harness reproduzível `npm run perf:baseline` (fora do gate) + teste de schema. | `b5b751e` |
| 18  | M11   | Reusa scratch `Vector3` por instância em `Athlete.update` e no shake.         | `b7f38e1` |
| 19  | M9    | Throttle da torcida por tick fixo (`advanceCrowdTick`) + remove atan2 redundante. | `5fc855c` |
| 20  | M10   | `meshCastsShadow`: exclui estampas transparentes do shadow pass.              | `e62a3c5` |
| 21  | B9    | `TrailBuffer`: ring buffer pré-alocado para o rastro da bola.                 | `ea81902` |
| 22  | B10   | Projeção da câmera recalculada só quando o FOV muda.                          | `54ae132` |
| 23  | B11   | Partículas: `needsUpdate` só com partícula viva + swap-remove O(1).           | `120e2f9` |

### Fase 5 — Segurança de tooling e deploy

| #   | Item | Alteração                                                                         | Commit    |
| --- | ---- | --------------------------------------------------------------------------------- | --------- |
| 24  | M12  | Hook de formatação sem shell (`execFileSync`) + `resolveTargetFile` anti path-traversal. | `3123f28` |
| 25  | M13  | Pin de `@playwright/mcp@0.0.77` (fora do `@latest`).                               | `0c3e2ce` |
| 26  | B5   | `window.__match`/`__renderer` só em DEV ou via `?debug`.                          | `982aa04` |
| 27  | B6   | Dev server em `localhost` por padrão + script opt-in `dev:lan`.                    | `38ad8aa` |
| 28  | B7   | `npm run deploy` roda `check` antes de build/publish.                              | `3fe381b` |
| 29  | B8   | Remove badges remotos do README + guard "sem assets remotos".                     | `f7da7b0` |

### Fase 6-7 — Limpeza, consistência e smoke de browser

| #   | Item | Alteração                                                                       | Commit    |
| --- | ---- | ------------------------------------------------------------------------------- | --------- |
| 30  | B2   | Centraliza tuning `BLOCK`/`HUMAN_TIMING`/`SERVE_TUNING` em constants (valores 1:1). | `5a106b3` |
| 31  | B3   | `role`/`aria-label` nos controles de toque.                                      | `05cd3f1` |
| 32  | B4   | `env(safe-area-inset-*)` com fallback nos controles de toque + `max()` no hint.  | `f634a14` |
| 33  | B12  | Remove enums mortos `GameState`/`RallyPhase` + ROADMAP com Fase 1 concluída.      | `dc4846e` |
| 34  | T6   | e2e de pausa/toque/fim de set/partida + costura DEV `debugWinMatch` + projeto mobile. | `c81a3c4` |

---

## 5. Memória de engenharia — regras para não repetir

Os 35 achados não são aleatórios: caem em poucos padrões de causa raiz que se repetem. Estas são as regras destiladas para que os _mesmos erros_ não voltem. Consulte antes de mexer nas áreas indicadas.

### 1. Física: exata e no instante certo _(A1, A2)_

- **Sintoma recorrente:** integrar por Euler semi-implícito e resolver eventos com a posição do frame anterior → a realidade diverge das previsões analíticas.
- **Regra:** use integração balística exata (`pos += vel*dt + 0.5*g*dt²` antes de atualizar `vel`) e resolva contato/rede/bloqueio no _ponto analítico_ do evento, nunca na posição stale do frame. Onde há previsão analítica, a física real precisa coincidir com ela.

### 2. Regras de vôlei: fonte oficial e prioridade correta _(M1, M2, M3, A4)_

- **Sintoma recorrente:** modelar regra por intuição → prioridade de faltas errada, antena jogável, saque/rodízio fora do padrão FIVB.
- **Regra:** valide contra as _Official Volleyball Rules 2025-2028 (FIVB)_. Uma falta (rede, antena) tem prioridade sobre bloqueio no mesmo instante; o primeiro sacador alterna entre sets (sorteio só no set decisivo); o toque de bloqueio não conta para os 3 toques.

### 3. Ciclo de vida de estado: resete tudo entre pontos/sets/partidas _(A3, A4, M4, M7)_

- **Sintoma recorrente:** estado vaza de um ponto para o seguinte (agendamento de bloqueio, posse, line-up) → pulo-fantasma, cobertura bloqueada, rodízio herdado.
- **Regra:** todo `reset()` limpa _todo_ o estado efêmero; nunca misture "agendado" com "elegível" num mesmo campo; modele o estado do app com uma máquina de estados explícita, não booleans soltos.

### 4. Input: previsível e sem eventos duplicados _(M5, M7)_

- **Sintoma recorrente:** auto-repeat de tecla alternando a pausa, WASD movendo e trocando zona ao mesmo tempo, carga de saque presa ao despausar.
- **Regra:** ignore `e.repeat` em toggles; separe movimento de ações/seleção; cancele input pendente ao pausar. Uma ação do usuário, um efeito.

### 5. Game loop: zero alocação e zero upload quando nada muda _(M9, M10, M11, B9, B10, B11)_

- **Sintoma recorrente:** alocar `new Vector3()` por frame, marcar `needsUpdate`/reenviar buffers e recalcular matrizes incondicionalmente — inclusive no menu e na pausa.
- **Regra:** reuse scratch buffers por instância; faça upload/recálculo só quando o dado realmente mudou; use throttle por tick fixo, ring buffers pré-alocados e `castShadow` seletivo. O custo por frame não pode ser fixo e independente do que está acontecendo.

### 6. Segurança de tooling: nunca confie em input, nunca em `@latest` _(M12, M13, B5, B6)_

- **Sintoma recorrente:** interpolar path em shell (command injection), expor debug global em produção, dev server em `0.0.0.0`, dependência em `@latest`.
- **Regra:** execute sem shell (`execFile`/array de args) e valide/normalize paths; exponha debug só em DEV/via flag; dev server em `localhost` por padrão; fixe versões exatas de ferramentas.

### 7. Testabilidade: helper puro + teste antes de mover; injete para desacoplar _(M14, B2, T3, T4)_

- **Sintoma recorrente:** lógica presa atrás de `document`/canvas/WebGL (não testável no Node do Vitest), números mágicos espalhados, `game/` tocando o DOM.
- **Regra:** extraia a lógica para um helper puro e escreva o teste _antes_ de movê-la; injete dependências (factory) para desacoplar do visual; centralize tuning em `src/core/constants.ts`; respeite a fronteira Hooks (game/ nunca acessa o DOM direto).

### 8. Offline-first: zero assets remotos _(B8)_

- **Sintoma recorrente:** badge/imagem/fonte servida de CDN quebra o princípio de rodar 100% offline.
- **Regra:** toda geometria/textura/som/badge é gerado ou versionado localmente. Nenhum asset servido por URL remota. Há teste-guarda varrendo os docs.

### 9. Operacional no Windows (tooling do dia a dia) _(recorrente em todo playtest)_

- **Sintoma recorrente:** processo `vite` órfão trava o git com "Permission denied" em `.claude`/`.github`; a porta 5173 colide com outro projeto do usuário; screenshots do Playwright MCP caem na raiz do repo.
- **Regra:** ao terminar um playtest, _encerre_ o processo dev/vite que iniciou (mate o node órfão se o git reclamar de lock); use a porta dedicada `5199 --strictPort`; limpe os screenshots que escaparem para a raiz.

---

## 6. Decisões autônomas e follow-ups

**Decisões autônomas (pré-resolvidas)**

- **Telemetria e CSP:** não implementadas — são feature nova / risco de quebrar WebGL, não achados. CSP fica como follow-up.
- **Baseline de perf:** coletado, mas FPS nunca virou gate de CI (headless flaky).
- **Deploy:** só o gate local (`deploy` roda `check`); migração para GitHub Actions/Pages adiada para a Fase 4 do ROADMAP e documentada.
- **Regressão visual:** sem pixel-diff de canvas WebGL (flaky); e2e usa asserções de estado/DOM (`expect.poll`).

**Follow-ups registrados**

- Propagar a factory `makeChar` até `Match` para testá-lo em Node.
- Trocar `location.reload()` do "jogar de novo" por reinício em-processo (Tauri/Capacitor).
- Guard de FOV por tolerância (epsilon) se o FOV virar suavizado.
- Extrair o `400px` mágico do hint para custom property.
- Animação da torcida em vertex shader (elimina reupload por frame).
- CSP inicial e deploy contínuo via Actions/Pages.

---

**Estado final:** `npm run check` verde (267 testes / 32 arquivos) · `npm run build` verde · e2e 8/8 (smoke, pausa ×3, matchEnd ×3, touch mobile) · árvore limpa, 35 commits na `main` (1 baseline + 34 passos).

Pipeline agêntico: revisão (gpt-5.5, xhigh) → auditoria independente (Claude Opus 4.8, high, contexto zerado) → plano por dependência → execução serial autônoma, um commit verde por passo. Documento consolidado a partir do code review amplo, do plano de correção e do resultado da execução (2026-07-08).
