# CLAUDE.md

Contexto do projeto para o Claude Code. Leia antes de mexer no código.

## O que é

**Pró Volei** — jogo de vôlei 3D no browser, **humano vs CPU**, 6×6, quadra oficial.
Roda 100% offline: geometria procedural, texturas geradas em canvas, áudio sintetizado
via Web Audio API. **Zero assets remotos.**

- **Alvos de publicação:** Web (atual) → Desktop/Steam (Tauri) → Mobile (Capacitor). Mesmo
  código web em todos; wrappers nativos entram depois. Ver [docs/ROADMAP.md](docs/ROADMAP.md).
- **Multiplayer:** fora de escopo — foco em single-player vs CPU. Não introduzir backend/netcode.

## Stack

| Camada | Tecnologia |
|---|---|
| Render 3D | Three.js r185 (WebGL) |
| Linguagem | TypeScript (strict, ES2022, ESM) |
| Build/dev | Vite 8 |
| Testes | Vitest 4 (ambiente Node p/ lógica pura) |
| Lint/format | ESLint 10 (flat config) + Prettier 3 |
| Áudio | Web Audio API (procedural) |
| Física | Solvers balísticos analíticos próprios (arcade-sim) |

## Comandos

```bash
npm run dev          # dev server em http://localhost:5173
npm run build        # build de produção em dist/
npm run preview      # serve o build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .   (lint:fix para autofix)
npm run format       # prettier --write .   (format:check só verifica)
npm run test         # vitest run   (test:watch para modo watch)
npm run check        # typecheck + lint + format:check + test  ← rode antes de commitar
npm run deploy       # build + publica dist/ na branch gh-pages
```

## Arquitetura (resumo)

Detalhes completos em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/
├── main.ts        bootstrap, renderer, game loop, slow-motion, injeta Hooks no Match
├── core/          constants, math3d (solvers balísticos), Input, AudioEngine
├── world/         Court, Arena, Crowd (~1500 instanciados), Referee
├── entities/      PlayerCharacter (humanoide procedural), Ball
├── systems/       CameraDirector (broadcast), Effects (partículas/confete)
├── game/          Team (rodízio) e Match (máquina de estados do rally + regras + IA)
└── ui/            HUD, Menu, TouchControls (celular)
```

- `Match` fala com UI/áudio/efeitos por uma interface `Hooks` injetada em `main.ts`
  (não acesse o DOM direto de dentro de `game/`). Mantenha essa fronteira.
- **`src/game/Match.ts` tem ~975 linhas e é a dívida técnica nº 1.** A prioridade atual é
  quebrá-lo em `rally/ · rules/ · ai/ · mechanics/ · control/`. Ver o plano de refatoração
  em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#refatoração-alvo). Faça isso com TDD:
  extraia helpers puros + testes antes de mover estado.

## Convenções

- **Unidades:** 1 unidade Three.js = 1 metro. `TeamSide.HOME` = humano, ocupa **x negativo**;
  `AWAY` = CPU, x positivo. `sideSign()`/`otherSide()` em `core/constants.ts`.
- **Idioma:** comentários e termos de domínio em **pt-BR** (saque, cortada, bloqueio, rodízio).
  Siga o estilo do arquivo em que estiver mexendo.
- **Tuning centralizado:** dimensões, física e parâmetros de IA/dificuldade ficam em
  `core/constants.ts`. Ajuste de gameplay = editar constantes, não espalhar números mágicos.
- **Nada de assets remotos.** Toda geometria/textura/som é gerado em runtime. Não adicione
  CDN, fontes externas nem arquivos de mídia sem discutir (quebra o offline-first).
- **Estilo:** Prettier decide formatação (aspas simples, ponto e vírgula, 100 colunas, 2 espaços).
  LF em todo o repo (`.gitattributes`). Rode `npm run check` antes de commitar.

## Gotchas

- **Node ≥ 20.19** (exigência do Vite 8). `.nvmrc` fixa a 22.
- **Windows/Mac:** se `git` reclamar de *dubious ownership*, rode
  `git config --global --add safe.directory "<caminho do repo>"`. `.gitattributes` força LF
  para evitar ruído de CRLF entre as máquinas.
- **Debug no browser:** o objeto da partida é exposto em `window.__match` no console.
- **Celular:** `?touch=1` na URL força os controles de toque no desktop para teste.
- Qualidade gráfica cai automaticamente em telas de toque (pixel ratio, tamanho da torcida).
