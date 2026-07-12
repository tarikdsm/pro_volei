# Fase 1D — Remoção definitiva do deploy legado

> **Execução:** TDD, commits pequenos diretamente em `main`, revisão independente e verificação
> local/remota antes de excluir a branch operacional.

**Objetivo:** deixar o repositório literalmente main-only, removendo script, pacote, teste e branch
`gh-pages` sem interromper o site publicado pelo workflow Actions comprovado na Fase 1C.

**Arquitetura:** primeiro o código elimina a capacidade de publicar pelo pacote `gh-pages`, mas a
branch remota continua intacta. Esse commit precisa passar pelo workflow e produzir um deployment
Pages verde. Só então a branch remota é excluída. Um commit documental final remove o fallback
transitório, registra a exclusão e comprova que produção continua no SHA atual via Actions.

## Pré-condições confirmadas

- Fase 1C concluída com rollback e restauração por SHA.
- Pages em `build_type=workflow`, HTTPS ativo e environment restrito a `main`.
- Deployment final da 1C: run `29201791884`, SHA `e506a4a`, verde e com smoke público aprovado.
- Branches remotas atuais: `main` e `gh-pages`; `gh-pages` aponta para `15f9c24`.

## Tarefa 1 — Guardar a ausência do caminho legado

**Arquivos:**

- Substituir: `tests/config/deploy-gate.test.ts` por
  `tests/config/pages-legacy-removed.test.ts`
- Modificar: `package.json`
- Modificar: `package-lock.json`

1. Escrever o novo teste antes da implementação e confirmar RED exigindo:
   - ausência do script npm `deploy`;
   - ausência da dependência `gh-pages`;
   - presença do workflow Actions e do gate `workflow:check`.
2. Remover `tests/config/deploy-gate.test.ts`, que protegia o comportamento agora proibido.
3. Remover script e pacote `gh-pages` sem alterar outras versões/dependências.
4. Rodar teste focado, `npm run check`, build e smoke de produção. Esperado: GREEN.
5. Revisar e criar commit atômico; não alterar a branch remota ainda.

## Tarefa 2 — Comprovar Actions sem o pacote legado

1. Fazer push do commit da Tarefa 1 e acompanhar o workflow até `check` e `deploy` verdes.
2. Confirmar que o deployment ativo aponta para o SHA do commit e que Pages continua em
   `build_type=workflow` com policy única `main`.
3. Executar smoke público em navegador limpo com cache-busting; iniciar partida e exigir zero erro
   de console.
4. Se falhar, manter `gh-pages`, interromper trabalho novo e corrigir/reverter em novo commit.

## Tarefa 3 — Excluir a branch remota operacional

**Pré-condição:** Tarefa 2 inteiramente verde e worktree limpa.

1. Reler as refs autoritativas com `git ls-remote --heads origin`, confirmar exatamente `main` e
   `gh-pages` e registrar o SHA completo de `gh-pages` para recuperação.
2. Confirmar novamente que Pages usa `workflow`, não a branch.
3. Excluir somente `origin/gh-pages` com push de deleção normal; nunca usar force-push.
4. Reler `git ls-remote --heads origin` e exigir exatamente `main`.
5. Reler Pages/environment/deployment e repetir smoke público. A exclusão não pode alterar o site.
6. Se qualquer verificação pós-exclusão falhar, recriar somente a ref ausente com push normal
   `SHA_COMPLETO:refs/heads/gh-pages`, confirmar a restauração remota e interromper trabalho novo.
   Não mudar Pages para `legacy` nem avançar à Tarefa 4 até corrigir a causa.

## Tarefa 4 — Finalizar documentação main-only

**Arquivos:**

- Modificar: `CLAUDE.md`
- Modificar: `README.md`
- Modificar: `CONTRIBUTING.md`
- Modificar: `CHANGELOG.md`
- Modificar: `docs/ROADMAP.md`
- Modificar: `docs/deployment/web.md`
- Modificar: testes documentais, apenas para guardar a nova política canônica.

1. Remover comandos e instruções operacionais de `npm run deploy`, pacote e branch `gh-pages`.
2. Manter o histórico apenas onde necessário, deixando explícito que a branch foi excluída.
3. Marcar Fase 1D concluída e registrar SHA/run/deployment/smoke da Tarefa 2 e a prova pós-exclusão.
4. Reforçar que rollback atual é rerun de workflow verde ou `git revert`; não existe branch de
   deploy nem fallback concorrente.
5. Adicionar guarda documental contra a volta de script/pacote/branch operacional.
6. Rodar testes focados, `npm run check`, build, revisão e commit atômico.
7. Fazer push, acompanhar o novo deployment e repetir smoke público.

## Gate final

```powershell
npm ci
npm run workflow:check
npm run check
npm run build
npm run test:e2e:smoke:prod
git status --short
```

- [ ] `package.json` e lockfile não contêm `gh-pages`.
- [ ] Não existe script `deploy` nem teste que recomende o fluxo legado.
- [ ] GitHub lista somente a branch `main`.
- [ ] Pages usa `build_type=workflow`; environment autoriza somente `main`.
- [ ] Workflow, deployment e smoke público do SHA final estão verdes.
- [ ] Documentação descreve somente Actions, rerun e `git revert` como caminhos atuais.
