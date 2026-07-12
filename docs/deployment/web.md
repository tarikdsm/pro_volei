# Deploy — Web

O alvo primário. Build estático, servível em qualquer host de arquivos.

## Build

```bash
npm run build     # gera dist/ (estático, ~150 kB gzip)
npm run preview   # confere o build localmente
```

`vite.config.ts` usa `base: './'` — caminhos relativos, então funciona em subdiretório
(GitHub Pages em `/pro_volei/`) ou na raiz de um domínio.

## GitHub Pages (atual: GitHub Actions)

Cada push em `main` que passa pelo workflow `.github/workflows/ci.yml` publica automaticamente em
`https://tarikdsm.github.io/pro_volei/`. O job `check` executa qualidade, cobertura, build e smoke
Chromium do `dist/` servido por `vite preview`; somente depois envia **esse mesmo diretório** ao
Pages. O job privilegiado `deploy` depende de `check` e não faz checkout nem executa comandos do
repositório.

O pipeline usa as actions oficiais atuais:

- `actions/checkout@v7` e `actions/setup-node@v6` no job `check`;
- `actions/upload-pages-artifact@v5` após o smoke, com o artefato
  `github-pages-${{ github.run_attempt }}`;
- `actions/configure-pages@v6` e `actions/deploy-pages@v5` no job `deploy`.

O sufixo `run_attempt` isola o artefato de cada reexecução. Assim, um rerun recompila, testa e
publica o SHA original sem colidir com o artefato de uma tentativa anterior.

### Evidência de deploy, rollback e restauração

| Operação | Run/attempt | SHA promovido | Deployment | Resultado |
|---|---|---|---|---|
| Primeiro deploy | `29201051491` attempt 1 | `c917145` | — | workflow e smoke público desktop/mobile verdes |
| Segundo deploy | `29201410995` attempt 1 | `da18cbd` | — | workflow e deployment verdes |
| Rollback | `29201051491` attempt 2 | `c917145` | `5414503098` | `success` e smoke público verde |
| Restauração | `29201410995` attempt 2 | `da18cbd` | `5414518284` | `success` e smoke público verde |

A prova promoveu primeiro o SHA anterior e depois restaurou o SHA mais recente. Ela valida o
controle operacional por SHA; não se baseia nem afirma diferença visual entre os builds, pois o
segundo SHA altera documentação que não entra no `dist/`. Com rollback e restauração comprovados,
a **Fase 1C está concluída**.

### Publicação da Fase 2B

O run `29206272786` aprovou qualidade e build, mas o smoke remoto expôs uma regressão real em
hardware lento: um `wall-cap` apagava a seta fisicamente mantida. O próximo commit (`959ef37`)
separou cancelamento de ação e movimento e adicionou ao smoke um stall forçado de 350 ms. O run
corretivo `29206518556` ficou verde e publicou o deployment `5415649743` do mesmo SHA.

No Pages público, o teste confirmou eixo direito preservado antes/depois do stall, incremento do
diagnóstico de tempo descartado, soltura da seta e início normal do rally. O remoto continuou
listando somente `refs/heads/main`.

### Publicação da Fase 2C

O run `29208396722` aprovou qualidade, cobertura, build e smoke de produção para o SHA `63aaf23`,
depois publicou o mesmo artefato no deployment `5416115597` (`success`). No Pages público, um
playtest real com setas + Espaço iniciou o rally e observou o AutoSelector travar o plano 2 na
atleta 0 com score `0.040951`, viável, zero trocas e status `locked`; a página não emitiu erros de
console. A API remota de branches retornou exclusivamente `main`.

### Conclusão main-only da Fase 1D

A capacidade local legada foi removida no SHA `dcba25b`. O run `29202163302` ficou verde e publicou
o deployment `5414657439`; o smoke público passou antes e depois da exclusão da branch operacional.
Após a exclusão:

- o remoto lista somente `main`;
- Pages continua em `build_type=workflow`, com HTTPS ativo;
- o ambiente `github-pages` autoriza somente `main`;
- não existe branch de deploy nem caminho concorrente de publicação.

O SHA histórico `15f9c244f7ab6fb58a4114a926d3c061a087a336` foi registrado como opção de recuperação durante a
operação, mas não foi usado: as verificações pós-exclusão permaneceram verdes. A **Fase 1D está
concluída** e o repositório é literalmente main-only.

### Verificação operacional

Use os comandos abaixo a partir de uma sessão autenticada do GitHub CLI:

```powershell
# Pages deve usar build_type=workflow e HTTPS
gh api 'repos/tarikdsm/pro_volei/pages' `
  --jq '{build_type, status, html_url, https_enforced, source}'

# O ambiente github-pages deve autorizar somente a branch main
gh api 'repos/tarikdsm/pro_volei/environments/github-pages/deployment-branch-policies' `
  --jq '.branch_policies[] | {id, type, name}'

# Workflow e jobs do run mais recente
gh run list --repo tarikdsm/pro_volei --workflow ci.yml --branch main --limit 5
gh run view RUN_ID --repo tarikdsm/pro_volei `
  --json headSha,attempt,status,conclusion,jobs,url

# Deployment mais recente e seu status
gh api 'repos/tarikdsm/pro_volei/deployments?environment=github-pages&per_page=1' `
  --jq '.[0] | {id, sha, ref, environment, created_at}'
gh api 'repos/tarikdsm/pro_volei/deployments/DEPLOYMENT_ID/statuses' `
  --jq '.[0] | {state, environment_url, created_at}'

# Resposta pública do Pages
curl.exe -I 'https://tarikdsm.github.io/pro_volei/'
```

Além dos comandos, abra a URL em contexto limpo, sem `?debug`, e confirme menu, início de partida,
console sem erros e carregamento dos assets relativos. A policy deve retornar exatamente uma
branch do tipo `branch`, com nome `main`.

### Rollback atual

Há somente dois mecanismos de produção:

1. **Promoção operacional por SHA:** reexecute integralmente um run verde anterior com
   `gh run rerun RUN_ID --repo tarikdsm/pro_volei`; o workflow preserva o `GITHUB_SHA` daquele run
   e publica seu artefato isolado por tentativa.
2. **Correção durável do código:** use `git revert SHA_PROBLEMATICO`, rode os gates e faça push do
   novo commit. Nunca use force-push, amend ou reescrita de histórico.

O rerun é uma promoção operacional por SHA; `git revert` é a correção durável do código. Após um
rollback por rerun, reexecute o run verde mais recente para restaurar a produção atual e repita o
smoke público. Não existe branch de deploy nem fallback concorrente.

## itch.io

Alternativa popular para jogos web: suba o `dist/` como zip (HTML5), marque como jogável no
browser, defina a resolução da janela. Bom para alcançar jogadores e receber feedback.

## Checklist de qualidade web

- [ ] Tela de carregamento enquanto o WebGL inicializa
- [ ] `<meta>` de PWA + manifest para "instalar" e rodar em tela cheia
- [ ] Testar em Chrome, Firefox, Safari (desktop e iOS Safari)
- [ ] Verificar caça a memória em sessões longas (a torcida instanciada é o maior custo)

> Este mesmo `dist/` é a base dos wrappers de [Desktop/Steam](desktop-steam.md) e
> [Mobile](mobile.md) — mantenha o build web saudável e todos se beneficiam.
