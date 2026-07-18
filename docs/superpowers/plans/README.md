# Índice dos planos de execução

Fonte única para saber quais planos foram executados. Os arquivos individuais preservam decisões,
ordem TDD e evidências do momento; caixas abertas em blueprints históricos não significam trabalho
ativo. O estado de produto continua em [`docs/ROADMAP.md`](../../ROADMAP.md).

**Marco atual — 18/07/2026:** Fases 1–2 e 3A–3C entregues. O proprietário autorizou a retomada:
o plano ativo é a Fase 3D; as subfases 4A–4E estão autorizadas na sequência.

| Plano | Estado | Resultado |
|---|---|---|
| [`2026-07-08-ai-human-control.md`](2026-07-08-ai-human-control.md) | histórico concluído | Separação de `HumanController`/`AiController`, absorvida pela refatoração da Fase 1 |
| [`2026-07-12-fase-1a-politicas-documentacao.md`](2026-07-12-fase-1a-politicas-documentacao.md) | concluído | Políticas offline, main-only e design 2.0 alinhados |
| [`2026-07-12-fase-1b-gates-producao.md`](2026-07-12-fase-1b-gates-producao.md) | concluído | Typecheck amplo, cobertura, build e smoke de produção |
| [`2026-07-12-fase-1c-deploy-pages-actions.md`](2026-07-12-fase-1c-deploy-pages-actions.md) | concluído | GitHub Actions, deploy por SHA, rollback e restauração comprovados |
| [`2026-07-12-fase-1d-remove-gh-pages.md`](2026-07-12-fase-1d-remove-gh-pages.md) | concluído | Caminho legado removido; remoto literalmente main-only |
| [`2026-07-12-fase-2a-inputframe.md`](2026-07-12-fase-2a-inputframe.md) | concluído | Setas/Space e touch no mesmo `InputHub` semântico |
| [`2026-07-12-fase-2b-fixed-timestep.md`](2026-07-12-fase-2b-fixed-timestep.md) | concluído | Simulação fixa 60 Hz, timeline analítica e interpolação visual |
| [`2026-07-12-fase-2c-autoselector.md`](2026-07-12-fase-2c-autoselector.md) | concluído | Seleção automática por ETA, histerese, lock e assistência limitada |
| [`2026-07-12-fase-2d-maquina-um-botao.md`](2026-07-12-fase-2d-maquina-um-botao.md) | concluído | Gramática contextual tap/hold/buffer para todas as ações |
| [`2026-07-12-fase-2e-feedback-camera-gamefeel.md`](2026-07-12-fase-2e-feedback-camera-gamefeel.md) | concluído | Feedback de timing, câmera segura e game feel determinístico |
| [`2026-07-12-fase-3a-headless-rng.md`](2026-07-12-fase-3a-headless-rng.md) | concluído | RNG por streams, simulação CPU×CPU e journal determinístico |
| [`2026-07-12-fase-3b-formacoes-cobertura.md`](2026-07-12-fase-3b-formacoes-cobertura.md) | concluído | Formações, transição, cobertura, defesa e bloqueio coletivo |
| [`2026-07-13-fase-3c-ia-estrategica.md`](2026-07-13-fase-3c-ia-estrategica.md) | concluído | Saque, set e ataque estratégicos, memória, trace e checkpoint |
| [`2026-07-18-fase-3d-metricas-tuning.md`](2026-07-18-fase-3d-metricas-tuning.md) | em execução | Formato 2.0, métricas de balanceamento, remoção do servePower legado e tuning §4.3/§3.2 |

## Retomada de desenvolvimento

- Autorização explícita do proprietário em 18/07/2026 cobre a Fase 3D e as subfases 4A–4E, nesta
  ordem, cada uma com plano detalhado antes de alterar produção.
- Fases 5–7 do design 2.0 permanecem aguardando o término dessas etapas.
