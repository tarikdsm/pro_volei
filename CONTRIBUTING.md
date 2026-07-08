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

1. Crie um branch a partir de `main`: `git checkout -b tipo/descricao-curta`
   (ex.: `refactor/extrair-scoring`, `feat/tela-opcoes`, `fix/saque-antena`).
2. Desenvolva com testes (ver abaixo). Rode o app e confira de verdade a mudança.
3. **Antes de commitar:** `npm run check` (typecheck + lint + format + test) deve passar.
4. Abra PR para `main`. O CI roda o mesmo `check` + build. Só faça merge com o CI verde.

## Scripts

```bash
npm run dev          # dev server com HMR
npm run build        # build de produção (dist/)
npm run preview      # serve o build localmente
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .        (lint:fix aplica correções automáticas)
npm run format       # prettier --write .   (format:check só verifica)
npm run test         # vitest run      (test:watch para watch)
npm run check        # tudo acima — o portão de qualidade
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
- **Offline-first:** nunca adicione asset remoto (CDN, fonte externa, imagem, som). Tudo é
  gerado em runtime. Isso é regra de projeto, não preferência.

## Testes

- Vitest, ambiente Node, arquivos `src/**/*.test.ts` ao lado do código.
- **Priorize lógica pura:** física (`math3d`), regras (pontuação, rodízio, set/partida),
  seleção de alvo da IA. São determinísticas e baratas de testar.
- Ao refatorar `Match.ts`, escreva o teste de caracterização **antes** de mover o código
  (ver [ARCHITECTURE.md](docs/ARCHITECTURE.md#abordagem-strangler-com-tdd)).
- Código que depende de DOM/WebGL: isole a lógica testável; deixe o render fino e sem regra.

## Commits

- Mensagens no imperativo, em pt-BR, explicando o **porquê** quando não for óbvio.
- Prefixos úteis: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`.
- Commits pequenos e coesos. Um commit não deve deixar o `main` quebrado.

## Debug

- `window.__match` expõe a partida no console do browser.
- `?touch=1` na URL força os controles de toque no desktop.
- Para investigar bug de comportamento, use a skill `superpowers:systematic-debugging`
  (achar a causa raiz antes de propor conserto).
