# Fase 4C — Variantes de Elenco — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar às 12 atletas identidades visuais distinguíveis na câmera de rally (§5.2/§5.3):
corpo parametrizado (altura/porte), penteados adicionais, elenco nomeado dos dois lados e uma
galeria determinística de aceite nos três viewports do design.

**Architecture:** O corpo da 4A ganha parâmetros (`heightScale`, `buildScale`, penteados
`bun`/`braid` além dos três atuais) aplicados na tabela de ossos e nos raios dos segmentos —
tudo procedural e testável em Node. Um módulo `roster.ts` define as 12 identidades
(nome, número, altura, porte, pele, cabelo) consumidas pelo `Team`; a AWAY deixa de ser
genérica. Uma rota de debug `?gallery` alinha as 12 em pose de ciclo determinístico para o
aceite visual por screenshot.

**Tech Stack:** Three.js r185, TypeScript strict, Vitest — sem dependências novas.

## Global Constraints

- Física/gameplay intocados: altura/porte são **somente visuais** (contatos continuam usando
  `CONTACT`/`reachPoint` lógicos); `heightScale` limitado a [0,94, 1,06] e `buildScale` a
  [0,92, 1,10] para não quebrar leitura nem IK (comprimentos de osso escalados junto).
- Elisa, Heloisa e Isabela preservam seus looks atuais (reconhecíveis, §5.2).
- Orçamento por atleta ≤ 4.500 triângulos segue valendo (asserção existente).
- Galeria é DEV-only (`?gallery`, mesmo padrão do `?debug`); zero impacto no bundle de gameplay
  além de um branch no bootstrap.
- Aceite §5.3: 12 atletas distinguíveis por silhueta/uniforme na câmera de rally nos viewports
  568×320, 844×390 e 1920×1080; duas revisões visuais independentes do mesmo checklist
  (uma minha + uma por subagente sobre os screenshots).
- Gates de sempre: `npm run check`, playtest, push verde, docs.

---

### Task 1: Corpo parametrizado (altura, porte, penteados novos)

**Files:**
- Modify: `src/entities/rig/AthleteSkeleton.ts` (`buildAthleteSkeleton(options?)` com
  `heightScale`; `ATHLETE_REST_POSE` vira função `athleteRestPose(heightScale)` mantendo o
  export atual para escala 1)
- Modify: `src/entities/rig/AthleteBodyGeometry.ts` (`AthleteBodyOptions` ganha `heightScale`,
  `buildScale`, penteados `'bun' | 'braid'`; raios × buildScale, offsets × heightScale)
- Modify: `src/entities/PlayerCharacter.ts` (`CharLook.hairstyle` aceita os novos valores;
  `CharLook` ganha `heightScale?`/`buildScale?` opcionais)
- Modify: `src/entities/rig/RiggedCharacter.ts` (repassa os parâmetros; comprimentos de IK de
  perna escalados por `heightScale`)
- Test: testes existentes dos três módulos + casos novos

- [ ] Testes: esqueleto com `heightScale 1.06` tem cabeça ~1,63 m e continua simétrico;
  `bun`/`braid` produzem geometria de cabelo própria; orçamento de triângulos vale para o corpo
  mais alto/forte; RiggedCharacter aceita look com escala e mantém determinismo.
- [ ] Implementação mínima; suíte inteira verde (`npx vitest run`).
- [ ] Commit: `feat(render): corpo parametrizado por altura, porte e penteados novos`

### Task 2: Elenco nomeado dos dois lados (`roster.ts`)

**Files:**
- Create: `src/entities/rig/roster.ts` — `HOME_ROSTER`/`AWAY_ROSTER: readonly CharLook[]` (6+6)
  com nome, número, pele, cabelo, penteado, `heightScale`, `buildScale`; Elisa/Heloisa/Isabela
  preservadas; AWAY ganha 6 identidades fictícias próprias
- Modify: `src/game/Team.ts` (consome os rosters; remove as paletas/roster inline)
- Test: `src/entities/rig/roster.test.ts` — 12 entradas, números únicos por lado, nomes únicos,
  escalas dentro dos limites, os três looks canônicos preservados

- [ ] TDD + suíte verde.
- [ ] Commit: `feat(render): elenco nomeado com identidades visuais dos dois lados`

### Task 3: Galeria determinística de aceite (`?gallery`)

**Files:**
- Create: `src/ui/galleryMode.ts` — monta cena com as 12 atletas em fila (2 linhas de 6),
  câmera fixa, ciclo determinístico de poses (idle → run → bump → spikeWindup, 2 s cada, por
  relógio acumulado)
- Modify: `src/main.ts` — branch `?gallery` (DEV e `?debug`-style) que troca o bootstrap da
  partida pela galeria

- [ ] Implementar (sem teste unitário de cena; a verificação é o aceite visual).
- [ ] Commit: `feat(render): galeria deterministica de aceite do elenco`

### Task 4: Aceite visual em três viewports + revisão independente

- [ ] Screenshots da galeria em 1920×1080, 844×390 e 568×320 e da câmera de rally em partida.
- [ ] Checklist §5.3: silhueta/uniforme distinguíveis, bola/atleta/placar legíveis; revisão 1
  (minha) + revisão 2 (subagente com os mesmos screenshots e checklist). Nenhum item alto aberto.
- [ ] Ajustar cores/penteados/escalas conforme as revisões e re-verificar.

### Task 5: Gates, docs e push

- [ ] `npm run check` + playtest final; push funcional; CI/Pages; smoke público.
- [ ] Docs: ROADMAP (bullet 4C + evidências), plans README, CHANGELOG, CLAUDE.md (marco → 4D).

## Self-Review

1. **Spec §5.2/§5.1/§5.3:** modelos reconhecíveis das três canônicas (Task 2), equipes
   fictícias completas com silhuetas/alturas distintas (Tasks 1–2), materiais parametrizados
   reutilizados (Task 1), galeria + viewports + duas revisões (Tasks 3–4). "Funções e estilos
   de jogo distintos" visuais limitam-se a porte/altura nesta fase; estilo de JOGO é IA (3C) e
   não muda aqui.
2. **Placeholders:** parâmetros com faixas numéricas definidas; rosters com regras testáveis;
   código completo emerge no TDD.
3. **Tipos:** `CharLook` estendido na Task 1 é consumido pelas Tasks 2–3.
