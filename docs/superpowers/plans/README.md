# Índice dos planos de execução

Fonte única para saber quais planos foram executados. Os arquivos individuais preservam decisões,
ordem TDD e evidências do momento; caixas abertas em blueprints históricos não significam trabalho
ativo. O estado de produto continua em [`docs/ROADMAP.md`](../../ROADMAP.md).

**Marco atual — 13/07/2026:** Fases 1–2 e subfases 3A–3C entregues; desenvolvimento pausado antes da 3D. Não há
plano ativo. A 3D e todas as fases seguintes aguardam nova autorização explícita do proprietário.

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

## Pausa de desenvolvimento

- Não criar plano de 3D/4A nem iniciar código, assets, tuning ou empacotamento como continuação
  automática.
- Correções críticas da versão entregue podem ser tratadas somente mediante nova solicitação.
- Ao retomar, primeiro reconciliar este índice, o roadmap e o design 2.0; depois escrever o plano
  detalhado da próxima subfase autorizada antes de alterar produção.
