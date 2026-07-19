# Fase 5A — Orientation Gate — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar a regra de orientação do §7.1 sobre a fundação da 2A: em touch, portrait
vira **pausa com área de menu** (instrução de girar + novo jogo + sair), landscape **inicia ou
retoma sozinho** (primeira abertura inclusive), fim de partida em landscape mostra **resultado
compacto com contagem de revanche**, e o áudio é **suspenso** fora do jogo ativo.

**Architecture:** A máquina `AppState` pura não muda (o gate continua sendo o congelamento por
`portraitBlocked` da 2A — `'playing'` congelado, decisão preservada). O delta é de
apresentação/fiação: modos novos no `Menu` (menu de portrait e vitória compacta com contagem),
`suspend()` no `AudioEngine`, e o `main.ts` orquestrando autostart, revanche in-place (reuso do
fluxo `onStart` existente, preservando dificuldade/formato escolhidos — sem `location.reload`)
e o listener de `change` na media query de orientação (robustez além do `resize`).

**Decisões de escopo registradas:** "Copa" e "opções" do §7.1 não existem ainda (Fases 6A–6D) —
o menu de portrait oferece o que existe: girar, novo jogo (seletores) e sair. "Sair" mantém o
mecanismo atual (`location.reload()` → título), que atende ao "volta ao título, não fecha a
aba". "Áudio reduzido" = `AudioContext.suspend()` (silêncio + economia), retomado nos pontos de
resume já existentes.

**Tech Stack:** DOM/TS existentes, Playwright para o aceite — sem dependências novas.

## Global Constraints

- Desktop (não-touch) não muda: título com JOGAR, pausa por Escape, painel de vitória com
  JOGAR DE NOVO (agora revanche in-place, sem reload — ganho colateral).
- Gate só em `isTouch` (como hoje); `?touch=1` continua forçando para testes.
- Simulação intocada; contagem de revanche vive na UI (segundos reais, 5 s; `?rematch=1` em
  DEV/?debug encurta para 1 s nos E2E).
- Comportamentos da 2A preservados: congelamento em portrait, retomada automática, pausa por
  cima do gate (menu PAUSA vence o gate quando `paused`), inputs cancelados nas transições.
- Gates: suíte + E2E touch/pause/matchEnd atualizados + smoke prod local + playtest 844×390 e
  390×844 + push/CI/Pages/smoke público + docs.

## Tasks

### Task 1: `AudioEngine.suspend()`
- `suspend(): void` (espelho do `resume()`: `void this.ctx?.suspend()`); teste unitário no
  padrão do `AudioEngine.test.ts` (ctx fake registra suspend/resume).
- Commit: `feat(audio): suspend explicito do contexto`.

### Task 2: Modos novos do `Menu`
- `showPortraitBreak(): void` — instrução “↻ Gire o celular para continuar” no topo + seletores
  de DIFICULDADE/PARTIDA + botões `NOVO JOGO` (`#btn-new` → `hide()` + `onStart?.()`) e
  `SAIR` (`#btn-quit-portrait` → `location.reload()`).
- `showVictoryCompact(homeWon, scoreline, seconds, onExpire, onCancelToFull)`: faixa compacta
  (resultado + placar de sets + “Revanche em N s”), decrementando por `setInterval` de 1 s;
  `dispose` interno ao esconder; sem botões (girar cancela — fiação na Task 3).
- Commit: `feat(ui): menu de portrait e vitoria compacta com contagem`.

### Task 3: Fiação no `main.ts`
- `portraitQuery.addEventListener('change', syncTouchOrientation)`.
- Portrait em jogo (`portraitBlocked && appState==='playing'`): além do congelamento atual,
  `audio.suspend()` + `menu.showPortraitBreak()`; volta a landscape: `menu.hide()` +
  fluxo atual (`snapPresentation`/`resume`). Pausa explícita continua vencendo (menu PAUSA).
  O `#rotate-tip` some (a instrução agora vive no menu de portrait) — remover elemento/CSS.
- `audio.suspend()` também em `togglePause` (entrada em pausa).
- **Autostart**: em `isTouch && !portrait` na primeira abertura, iniciar partida rápida com os
  defaults do menu (Normal/Oficial 2.0) sem exigir JOGAR (reusar o caminho de `onStart`).
- **Fim de partida**: extrair o corpo de `onStart` para `startMatchFromMenu()` reutilizável;
  no `matchEnd` com `isTouch && !portraitBlocked` → `menu.showVictoryCompact(..., 5 s,
  onExpire = startMatchFromMenu)`; girar para portrait durante a contagem cancela e mostra
  `showVictory` completo. Desktop e portrait: `showVictory` como hoje, com `JOGAR DE NOVO`
  agora chamando `startMatchFromMenu()` (in-place) em vez de `location.reload()`.
- Commit: `feat(ui): orientation gate completo com autostart e revanche`.

### Task 4: E2E
- Atualizar `touch.spec.ts`: portrait em jogo mostra o menu de portrait (instrução + NOVO
  JOGO), não mais `#rotate-tip`; landscape esconde e retoma (asserções de tick preservadas).
- Novo caso: primeira abertura touch em landscape inicia sozinha (tick avança sem clicar).
- Novo caso: `forceMatchEnd` em touch landscape (`?rematch=1`) → faixa compacta visível →
  ~1,5 s depois a partida seguinte está em andamento (score zerado, tick avançando).
- Novo caso: girar para portrait durante a contagem → painel de vitória completo, sem revanche.
- `matchEnd.spec.ts`: `JOGAR DE NOVO` reinicia in-place (score 0×0, `#hud` visível) sem reload.
- Commit: `test(e2e): aceite do orientation gate 5a`.

### Task 5: Prova, gates, docs e push
- Playtest `?touch=1`: 390×844 (menu portrait), 844×390 (jogo full-bleed), fim de partida com
  contagem; console limpo; screenshots.
- `npm run check` + smoke prod local; push funcional; CI/Pages; smoke público; docs (ROADMAP
  bullet 5A, plans README, CHANGELOG, CLAUDE.md marco → 5B).

## Self-Review
1. §7.1 coberto: portrait=pausa/menu ✓ (T2/T3), landscape auto ✓ (T3), primeira abertura ✓,
   revanche com contagem + cancelamento por giro ✓, resultado compacto ✓, sair→título ✓
   (decisão reload registrada), áudio reduzido ✓ (suspend), Screen Orientation API como
   melhoria progressiva ✓ (media query + change listener continuam a fonte de verdade).
   Preferências salvas na primeira abertura dependem do save (6A) — defaults por enquanto,
   como o próprio §7.1 admite ("usa preferências salvas OU inicia partida rápida Normal").
2. Sem placeholders: textos, ids e tempos definidos; corpo de `onStart` é lido na execução
   antes da extração (referência precisa no repo).
3. Contratos novos nomeados (T1/T2) e consumidos na T3/T4.
