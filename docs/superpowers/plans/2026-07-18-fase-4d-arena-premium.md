# Fase 4D — Arena Premium — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identidade de transmissão premium (§6.1): paleta azul-marinho/teal/coral, iluminação
de TV com materiais PBR leves, fundo menos contrastado que a quadra e realce da atleta
controlada legível para daltonismo — preservando leitura de bola/atleta e os orçamentos §10.2.

**Architecture:** Passe visual concentrado em `core/constants.ts` (COLORS 2.0), `world/Court.ts`
e `world/Arena.ts` (luzes/materiais), mais o realce da atleta controlada onde ele vive hoje.
Sem geometria nova pesada; iteração dirigida por screenshot com os mesmos gates visuais da 4C
(revisão própria + revisão independente, desktop + 844×390).

**Tech Stack:** Three.js r185 — sem dependências novas.

## Global Constraints

- Leitura acima de tudo (§6.1): bola e atletas continuam os elementos de maior contraste; o
  fundo escurece/dessatura em relação à quadra, nunca o contrário.
- Tuning de cor centralizado em `COLORS` (constants); nada de hex espalhado.
- Orçamentos §10.2 valem: draw calls em rally ≤ 250 desktop; sem luzes com sombra novas (a key
  continua o único shadow-caster); pixel ratio/perf mobile intocados.
- Realce da atleta controlada: codificação dupla (cor + forma), legível para daltonismo (§6.1).
- Gates: `npm run check`, playtest desktop + 844×390, draw calls medidos, push verde, docs.

## Tasks

### Task 1: Paleta 2.0 (`COLORS`)
- [ ] Quadra coral (taraflex quente ~`0xe0704a`), zona livre teal (~`0x1f6f6a`), linhas claras;
  fundo/arquibancada azul-marinho mais profundo; acentos teal/coral em placas e placar.
- [ ] Testes de caracterização mínimos se existirem (constants.test) + suíte verde.
- [ ] Commit: `feat(render): paleta navy-teal-coral da arena 2.0`

### Task 2: Iluminação de TV e materiais (`Arena.ts`, `Court.ts`)
- [ ] Key quente mantida como única sombra; fill frio mais baixo; rim/contra-luz leve sem
  sombra; ambiente/hemisfério reequilibrados; roughness do piso ↓ (brilho de taraflex),
  paredes/teto mais escuros e foscos; refletores decorativos com acento teal.
- [ ] Screenshot desktop antes/depois; leitura de bola/atletas conferida.
- [ ] Commit: `feat(render): iluminacao de tv e materiais premium na arena`

### Task 3: Realce da atleta controlada
- [ ] Localizar o indicador atual; integrar ao piso (anel achatado) com codificação dupla
  (cor coral + forma de anel pulsante distinta do landing marker) e contraste testado sobre o
  taraflex novo.
- [ ] Commit: `feat(render): anel de selecao integrado ao piso com dupla codificacao`

### Task 4: Aceite visual + orçamento
- [ ] Screenshots rally desktop 1280×720 e 844×390; galeria `?gallery` re-verificada (fundo
  novo não é usado lá, mas os uniformes precisam continuar contrastando).
- [ ] Draw calls em rally ≤ 250 (via `?debug`/`__renderer`).
- [ ] Revisão independente (subagente, checklist §6.1: paleta, contraste bola/atleta, fundo
  menos contrastado, realce daltônico-legível). Nenhum item alto aberto.
- [ ] Commit de ajustes decorrentes.

### Task 5: Gates, docs e push
- [ ] `npm run check`; push funcional; CI/Pages; smoke público; docs (ROADMAP, plans README,
  CHANGELOG, CLAUDE.md marco → 4E).

## Self-Review
1. §6.1 coberto: paleta (T1), iluminação/PBR/fundo (T2), anel daltônico (T3), partículas/shake
   proporcionais já entregues na 2E, HUD compacto já existente — sem retrabalho.
2. Sem placeholders acionáveis: valores iniciais de cor definidos; o refinamento é
   deliberadamente iterativo por screenshot com aceite formal.
3. Sem tipos novos; mudanças em constantes e módulos de mundo existentes.
