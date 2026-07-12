# Contribuindo com o Pró Volei

Guia de desenvolvimento. Para contexto de arquitetura, veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pré-requisitos

- **Node ≥ 20.19** (exigência do Vite 8). O repo fixa a versão em `.nvmrc` (Node 22).
  Com [nvm](https://github.com/nvm-sh/nvm): `nvm use`.
- **npm ≥ 10**.

## Setup

```bash
git clone https://github.com/tarikdsm/pro_volei.git
cd pro_volei
npm install
npm run dev        # http://localhost:5173
```

> **Windows:** se o git acusar *dubious ownership* (comum ao trazer o repo de outra máquina),
> rode `git config --global --add safe.directory "<caminho do repo>"`.

## Fluxo de trabalho

1. Trabalhe na checkout de `main` e confirme `git status` antes de editar.
2. Desenvolva com testes e valide o comportamento real no browser quando aplicável.
3. Antes de commitar e fazer push, rode `npm run check` e os testes E2E do escopo.
4. Faça commits diretamente em `main`, pequenos e atômicos. O CI valida o SHA enviado.
5. Se o CI remoto falhar, interrompa trabalho novo e corrija ou reverta em novo commit.

O CI roda `npm run check`, build e smoke Chromium do `dist/` servido por `vite preview` em cada
push para `main`. Depois do smoke, o mesmo `dist/` é enviado ao Pages e publicado pelo job
`deploy`; nenhum segundo job reconstrói o jogo. Consulte
[docs/deployment/web.md](docs/deployment/web.md) para verificar workflow, ambiente, deployment,
URL pública e rollback.

A Fase 1C comprovou rollback e restauração por SHA. `npm run deploy`, o pacote `gh-pages` e a
branch remota homônima permanecem somente como fallback transitório até a execução da Fase 1D,
agora autorizada e pendente. Não use o caminho legado em operação normal.

## Scripts

```bash
npm run dev          # dev server com HMR
npm run build        # build de produção (dist/)
npm run preview      # serve o build localmente
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .        (lint:fix aplica correções automáticas)
npm run format       # prettier --write .   (format:check só verifica)
npm run test         # vitest run      (test:watch para watch)
npm run test:coverage # cobertura V8 de todo src, com threshold inicial de 30%
npm run workflow:check # valida sintaxe/schema de .github/workflows/ci.yml
npm run test:e2e:smoke:prod # smoke Chromium do dist servido por vite preview
npm run check        # workflow + typecheck + lint + format:check + cobertura
```

## Estilo de código

- **TypeScript strict**, ES2022, ESM. Nada de `noEmit` desligado.
- **Formatação é do Prettier** (aspas simples, ponto e vírgula, 100 colunas, 2 espaços,
  trailing comma). Não formate à mão nem discuta estilo — rode `npm run format`.
- **LF** em todo o repo (`.gitattributes` normaliza). Não commite CRLF.
- **Domínio em pt-BR:** termos de vôlei (saque, cortada, bloqueio, rodízio) nos comentários e
  identificadores de domínio. Siga o padrão do arquivo que você está editando.
- **Tuning em `core/constants.ts`:** ajuste de gameplay é editar constantes, não espalhar
  números mágicos pelo código.
- **Offline-first:** nunca carregue asset por URL remota. Assets locais originais/licenciados
  podem ser adicionados com manifesto de autoria/licença, compressão, orçamento e fallback.
  Toda mudança de asset deve passar pelo teste `tests/docs/no-remote-assets.test.ts` e pelos
  gates de performance aplicáveis.

## Testes

- Vitest, ambiente Node, arquivos `src/**/*.test.ts` ao lado do código.
- **Priorize lógica pura:** física (`math3d`), regras (pontuação, rodízio, set/partida),
  seleção de alvo da IA. São determinísticas e baratas de testar.
- Ao refatorar `Match.ts`, escreva o teste de caracterização **antes** de mover o código
  (ver [ARCHITECTURE.md](docs/ARCHITECTURE.md#abordagem-strangler-com-tdd)).
- Código que depende de DOM/WebGL: isole a lógica testável; deixe o render fino e sem regra.

## Commits

- O projeto usa commits diretamente em `main`, sem PR, amend ou force-push.
- Mensagens no imperativo, em pt-BR, explicando o **porquê** quando não for óbvio.
- Prefixos úteis: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`.
- Commits pequenos e coesos. Um commit não deve deixar o `main` quebrado.

## Debug

- `window.__match` expõe a partida no console do browser (em dev sempre; no build publicado só
  com `?debug` na URL).
- `?touch=1` na URL força os controles de toque no desktop.
- Para investigar bug de comportamento, use a skill `superpowers:systematic-debugging`
  (achar a causa raiz antes de propor conserto).
