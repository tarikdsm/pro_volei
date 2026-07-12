# Fase 1C — Deploy contínuo do GitHub Pages

> **Execução:** usar desenvolvimento orientado a testes, agentes novos por tarefa e revisão
> independente antes de publicar. O fluxo permanece main-only, sem PR, amend ou force-push.

**Objetivo:** publicar no GitHub Pages exatamente o `dist/` que passou por cobertura, build e
smoke de produção, comprovar o site público e validar um rollback real antes de remover o caminho
legado na Fase 1D.

**Arquitetura:** o job `check` existente continua sendo a única fábrica do artefato. Depois do
smoke do `dist/`, ele envia esse mesmo diretório com a action oficial do Pages. Um job `deploy`
separado, com privilégio mínimo e dependência explícita de `check`, publica o artefato no ambiente
`github-pages`. A fonte remota muda de `legacy` para `workflow` somente quando o commit do pipeline
estiver pronto para push. A branch `gh-pages` permanece intacta como fallback até o rollback ser
comprovado. A concorrência deixa de ser global: `check` pode cancelar apenas outro `check` antigo,
enquanto `deploy` usa um grupo próprio que nunca cancela uma publicação já iniciada.

**Stack:** GitHub Actions, Node.js 22, Vitest 4, Vite 8, Playwright 1.61,
`actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` e
`actions/deploy-pages@v5`.

## Estado confirmado em 12/07/2026

- Repositório: `tarikdsm/pro_volei`; branch padrão: `main`.
- Pages: `build_type=legacy`, fonte `gh-pages:/`, HTTPS ativo, sem domínio customizado.
- Ambiente `github-pages`: política customizada permite somente `gh-pages` (id `53766422`).
- Site: `https://tarikdsm.github.io/pro_volei/`.
- CI do SHA `f573985` passou cobertura, build e smoke do `dist/` no run `29199966290`.
- As releases oficiais atuais são `configure-pages@v6`, `upload-pages-artifact@v5` e
  `deploy-pages@v5`. O guia narrativo do GitHub ainda exibe majors anteriores; prevalecem as
  releases estáveis assinadas e marcadas como Latest.

## Restrições e decisões

- Não alterar gameplay, UI, assets nem regras nesta subfase.
- Não criar outro workflow que reconstrua o jogo: um único job produz e testa `dist/`.
- Não conceder `pages: write` ao job que executa código do repositório.
- Não cancelar um deploy já iniciado; o grupo de concorrência do Pages usa
  `cancel-in-progress: false`.
- Manter `npm run deploy`, pacote `gh-pages` e branch remota até a Fase 1D.
- Se o deploy Actions falhar, restaurar imediatamente `build_type=legacy` e a política de ambiente
  para `gh-pages`, sem reescrever histórico.
- Rollback definitivo do código continua sendo `git revert`; a validação operacional desta fase
  reexecuta um workflow verde anterior, que preserva seu `GITHUB_SHA`.

## Tarefa 1 — Teste-guarda do contrato de publicação

**Arquivos:**

- Modificar: `tests/config/ci-production-gate.test.ts`
- Criar: `tests/config/support/workflowContract.ts`
- Criar: `tests/config/pages-deploy-gate.test.ts`
- Modificar: `package.json`
- Modificar: `package-lock.json`
- Testar: `tests/config/ci-production-gate.test.ts`
- Testar: `tests/config/pages-deploy-gate.test.ts`

1. Extrair o parser textual controlado atual para `workflowContract.ts`, sem mudar expectativas;
   todos os testes existentes devem continuar verdes.
2. Adicionar `@action-validator/core` e `@action-validator/cli`, expor `npm run workflow:check` e
   incluí-lo em `npm run check`, garantindo validação de sintaxe/schema do workflow antes do push.
3. Escrever todos os contratos novos e confirmar RED. Exigir no job `check`, em ordem:
   `actions/checkout@v7`, `actions/setup-node@v6`, os gates existentes e, somente depois do smoke,
   `actions/upload-pages-artifact@v5` com `path: dist`.
4. Exigir no job `deploy`:
   - `needs: check`;
   - `permissions` com `contents: read`, `pages: write` e `id-token: write`;
   - ambiente `github-pages` e URL vinda do output `deployment.page_url`;
   - exatamente `actions/configure-pages@v6` e `actions/deploy-pages@v5`, esta última com
     `id: deployment`;
   - nenhum checkout nem comando `run`, para não executar código do repositório com privilégio.
5. Exigir concorrência do `check` com cancelamento e do `deploy` com grupo `pages` e
   `cancel-in-progress: false`.
6. Exigir trigger somente em `push` da `main`, `permissions: contents: read` exato no topo e
   ausência de `concurrency` global, impedindo que um push novo cancele o job `deploy`.
7. Adicionar mutações negativas para upload antes do smoke, artefato diferente de `dist`, ausência
   de `needs`, permissão ausente, action presente apenas em comentário e deploy duplicado.
8. Rodar os testes focados e confirmar RED antes da alteração do workflow.

## Tarefa 2 — Publicar o artefato aprovado

**Arquivos:**

- Modificar: `.github/workflows/ci.yml`
- Modificar: `tests/config/ci-production-gate.test.ts` apenas se a implementação revelar uma
  lacuna real no contrato, nunca para enfraquecê-lo.

1. Atualizar `actions/checkout` para a major oficial atual `@v7`; manter `setup-node@v6` e a
   versão definida por `.nvmrc`.
2. Definir `permissions: contents: read` por padrão.
3. Mover a concorrência `ci-${{ github.ref }}` com cancelamento para dentro do job `check`, para
   que um push novo não consiga cancelar um `deploy` já iniciado.
4. Após o smoke de produção, enviar `dist/` com `actions/upload-pages-artifact@v5`.
5. Criar o job `deploy`, dependente de `check`, com permissões exclusivas
   `contents: read`, `pages: write`, `id-token: write`.
6. Configurar `environment.name: github-pages`, URL pelo output da action e concorrência
   `pages` sem cancelar deploy em andamento.
7. Executar `actions/configure-pages@v6` e `actions/deploy-pages@v5` no job privilegiado; o job
   não faz checkout nem executa scripts do repositório.
8. Rodar teste focado, `npm run check`, `npm run build` e smoke de produção. Esperado: GREEN.
9. Solicitar revisão independente de requisitos e qualidade; corrigir achados antes do commit.

## Tarefa 3 — Migrar o estado remoto e fazer o primeiro deploy

**Pré-condição:** árvore limpa; apenas o commit do pipeline revisado está à frente de
`origin/main`; gates locais e `npm run workflow:check` verdes.

1. Registrar novamente o estado remoto:

   ```powershell
   gh api 'repos/tarikdsm/pro_volei/pages'
   gh api 'repos/tarikdsm/pro_volei/environments/github-pages/deployment-branch-policies'
   ```

2. Derivar o id da policy retornada e abortar se não existir exatamente uma policy do tipo branch
   chamada `gh-pages`; não usar id histórico fixo.
3. Atualizar essa policy para `main` e validar por GET o mesmo id e o novo nome.
4. Atualizar Pages para `build_type=workflow` e confirmar por GET; só então fazer push do commit do
   pipeline.
5. Acompanhar o run do SHA até o fim. Confirmar `check`, upload, `deploy` e environment verdes.
6. Se qualquer etapa falhar, restaurar `build_type=legacy`, fonte `gh-pages:/` e a policy derivada
   para `gh-pages`; depois criar commit corretivo normal antes de tentar novamente.
7. Verificar a URL pública em contexto limpo de navegador real, sem `?debug`, usando query única
   por SHA/attempt e retentativas limitadas: carregamento, console, menu e início de partida.
   Confirmar também HTTPS e assets relativos.

## Tarefa 4 — Documentar operação e rollback após o primeiro deploy

**Arquivos:**

- Modificar: `docs/deployment/web.md`
- Modificar: `README.md`
- Modificar: `CLAUDE.md`
- Modificar: `CONTRIBUTING.md`
- Modificar: `docs/ROADMAP.md`
- Modificar: `CHANGELOG.md`

1. Documentar que pushes verdes da `main` publicam automaticamente o mesmo `dist/` testado.
2. Registrar como verificar `build_type`, ambiente, workflow, deployment e URL pública com `gh`.
3. Descrever os dois rollbacks:
   - transição: voltar para `legacy`/`gh-pages` enquanto a branch existir;
   - produção: reexecutar um run verde anterior ou criar `git revert`, sem force-push.
4. Manter explícito que o script e a branch legados só serão removidos na Fase 1D, após a prova.
5. Registrar o primeiro deploy público, mantendo a Fase 1C como “rollback em validação”.
6. Rodar guardas documentais, formatação e revisão independente.

## Tarefa 5 — Comprovar rollback e restauração

1. Depois do primeiro deploy Actions verde, enviar o commit documental da Tarefa 4 para produzir
   um segundo deployment verde com SHA diferente no histórico do ambiente.
2. Reexecutar integralmente o primeiro run Actions com `gh run rerun RUN_ID`; confirmar que o run
   usa o SHA antigo, vira o deployment mais recente no ambiente e deixa o smoke público verde.
3. Reexecutar integralmente o run mais recente; confirmar que o SHA atual volta a ser o deployment
   ativo e o site permanece jogável.
4. Não fazer novos pushes enquanto as duas reexecuções estiverem em andamento.
5. Tratar a prova como controle de promoção por SHA, não como diferença visual: os dois commits
   podem gerar bytes idênticos porque documentação não entra em `dist/`.
6. Guardar os run ids e resultados para o registro final, não em metadados de runtime.
7. Só após essa prova autorizar a finalização documental e a Fase 1D.

## Tarefa 6 — Finalizar o registro da Fase 1C

**Arquivos:**

- Modificar: `docs/ROADMAP.md`
- Modificar: `CHANGELOG.md`
- Modificar: `docs/deployment/web.md`, se necessário para registrar a prova sem informação
  efêmera ou redundante.

1. Registrar os runs do primeiro deploy, rollback e restauração, seus SHAs e os resultados do smoke
   público.
2. Marcar a Fase 1C concluída e liberar explicitamente a Fase 1D.
3. Rodar gates documentais, revisar, commitar e fazer push.
4. Acompanhar o novo workflow até deploy verde e repetir o smoke público com query sem cache.

## Gate final da Fase 1C

```powershell
npm ci
npm run workflow:check
npm run check
npm run build
npm run test:e2e:smoke:prod
git status --short
```

- [ ] Todos os testes, cobertura, lint, formato, typecheck, build e smoke local passam.
- [ ] O workflow remoto do SHA atual está verde.
- [ ] `build_type=workflow` e ambiente `github-pages` autorizam somente `main`.
- [ ] O deployment depende do job que testou e enviou o mesmo `dist/`.
- [ ] O job privilegiado não executa código do repositório.
- [ ] Site público abre por HTTPS, carrega assets relativos e inicia uma partida.
- [ ] Reexecução de um run anterior faz rollback; reexecução do atual restaura produção.
- [ ] Branch `gh-pages` e caminho manual ainda existem intactos para a Fase 1D.

## Fontes oficiais

- [Custom workflows para GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Fonte de publicação do Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [REST API do GitHub Pages](https://docs.github.com/en/rest/pages/pages)
- [Políticas de branch de deployment](https://docs.github.com/en/rest/deployments/branch-policies)
- [Reexecutar workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
- [configure-pages v6](https://github.com/actions/configure-pages/releases/tag/v6.0.0)
- [upload-pages-artifact v5](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0)
- [deploy-pages v5](https://github.com/actions/deploy-pages/releases/tag/v5.0.0)
