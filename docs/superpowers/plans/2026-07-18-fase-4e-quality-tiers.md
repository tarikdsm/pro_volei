# Fase 4E — Quality Tiers e Otimização — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `QualityManager` com tiers Baixo/Médio/Alto (§10.1): tier inicial por capacidade,
medição de frame time e ajuste automático **com histerese e somente entre pontos**, aplicando
pixel ratio, resolução de sombra, densidade/animação da torcida e escala de partículas — com os
orçamentos §10.2 como guarda.

**Architecture:** Núcleo puro `core/quality/QualityManager.ts` (janela deslizante de frame
times, p95, histerese com cooldown — testável em Node) + um aplicador fino em `main.ts` que
consome o tier via interfaces já existentes (renderer/Arena/Crowd/Effects). A troca de tier só
é avaliada quando o `Match` entra no estado `point`. `?tier=0|1|2` (DEV/?debug) força tier para
testes. Decisão registrada: pós-processamento (FXAA/bloom, "opcional" no §10.1) fica para a
Fase 7 de polimento — MSAA nativo já cobre o anti-alias e o composer adicionaria bundle/perf
sem necessidade atual.

**Tech Stack:** Three.js r185, TypeScript, Vitest — sem dependências novas.

## Global Constraints

- Ajuste nunca ocorre durante o rally; histerese evita ping-pong (§10.1).
- Física/simulação intocadas: tier é apresentação pura.
- Parâmetros por tier centralizados em `core/constants.ts` (`QUALITY_TIERS`).
- Torcida: reduzir densidade em runtime via `InstancedMesh.count` (sem realocar buffers);
  sombra: redimensionar `shadow.mapSize` + dispose do mapa antigo.
- Orçamentos §10.2 como gate de regressão: draw calls ≤ 250 desktop em rally; bundle ≤ 250 kB
  gzip; sem crescimento de heap anômalo.
- Gates: suíte + `npm run check` + smoke prod local + playtest com evidências (incluindo o
  frame de bola em voo sobre a torcida nova, pendência da 4D) + push/CI/Pages/smoke público.

## Tasks

### Task 1: Núcleo puro `QualityManager`
- Create: `src/core/quality/QualityManager.ts` + teste.
- `QUALITY_TIERS` em constants: `[{ name:'baixo', dpr:1.25, shadowRes:1024, crowdDensity:0.55, crowdTickHz:12, particleScale:0.5 }, { name:'medio', dpr:1.5, shadowRes:2048, crowdDensity:0.8, crowdTickHz:16, particleScale:1 }, { name:'alto', dpr:2, shadowRes:2048, crowdDensity:1, crowdTickHz:20, particleScale:1 }]`.
- API: `constructor(initialTier)`, `sampleFrame(dtSeconds)`, `evaluateAtBreak(): number | null`
  (novo tier ou null), `get tier`. Regras: janela de 180 amostras; p95 > 33 ms em 2 avaliações
  seguidas ⇒ desce um tier; p95 < 12 ms em 4 avaliações seguidas ⇒ sobe; cooldown de 2
  avaliações após qualquer troca; clamp [0,2].
- [ ] TDD (janela, histerese, cooldown, clamp, determinismo) → commit
  `feat(render): quality manager com histerese entre pontos`.

### Task 2: Aplicação e fiação
- `Crowd`: método `setQuality(density, tickHz)` (count por densidade + throttle);
  `Effects`: `particleScale` multiplicador; `Arena`: `setShadowResolution(res)`.
- `main.ts`: tier inicial (`isTouch ? 1 : 2`, override `?tier=`), `sampleFrame(visualDt)` por
  rAF, avaliação na transição para `state === 'point'`, aplicação do tier.
- [ ] Testes unitários dos métodos novos (Crowd count/tick, Effects escala) + suíte inteira.
- [ ] Commit: `feat(render): tiers aplicados a dpr, sombra, torcida e particulas`.

### Task 3: Prova e orçamento
- [ ] Playtest desktop + 844×390: rally com `?tier=0/1/2` (visível: torcida menor no baixo);
  frame de bola em voo sobre a torcida silenciada (fecha pendência da 4D); draw calls por tier
  (esperado: baixo < médio < alto; alto ≤ 250 em rally).
- [ ] `npm run build`: bundle ≤ 250 kB gzip.
- [ ] Revisão independente curta (subagente): tier baixo continua legível (§6.1) e o ajuste
  automático não muda nada durante o rally (inspeção do código + screenshots).

### Task 4: Gates, docs e push
- [ ] `npm run check` + smoke prod local; push funcional; CI/Pages; smoke público.
- [ ] Docs: ROADMAP (4E + marco final — mandato 3D+4A–4E completo), plans README, CHANGELOG,
  CLAUDE.md (marco → aguardando autorização das Fases 5–7).

## Self-Review
1. §10.1 coberto: tiers/DPR/sombras/torcida/partículas + histerese entre pontos; pós adiado com
   decisão registrada; §10.2 parcial por gates locais (medição física em aparelhos reais
   continua pendência formal da Fase 7B, como o design já prevê).
2. Sem placeholders: números de tier/histerese definidos acima.
3. Interfaces novas nomeadas nas Tasks 1–2 e consumidas na fiação.
