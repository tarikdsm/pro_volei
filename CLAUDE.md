# CLAUDE.md

Contexto do projeto para o Claude Code. Leia antes de mexer no código.

## O que é

**Pró Volei** — jogo de vôlei 3D no browser, **humano vs CPU**, 6×6, quadra oficial.
Roda 100% offline. A v1.1 usa geometria procedural, texturas em canvas e áudio sintetizado;
a versão 2.0 também pode usar assets locais otimizados e versionados.

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
npm run dev          # dev server local em http://localhost:5173
npm run dev:lan      # dev server exposto na LAN (--host) p/ testar no celular físico
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
- **A Fase 1 (quebrar o `Match.ts`) está concluída:** de ~1100 para ~490 linhas, com a lógica
  em `RallyState`, `rules/` (scoring, rotation, SetMatch), `mechanics/` (serve, touch, block,
  net), `control/HumanController` e `ai/AiController`, cada um sobre um contexto injetado
  (`MechanicsCtx`/`ScoringCtx`). `Match` é o orquestrador fino (state machine + event queue).
  Ao mexer em `game/`, siga esse padrão: helper puro + teste antes de mover estado, e delegue
  via contexto em vez de inchar o `Match`. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Convenções

- **Unidades:** 1 unidade Three.js = 1 metro. `TeamSide.HOME` = humano, ocupa **x negativo**;
  `AWAY` = CPU, x positivo. `sideSign()`/`otherSide()` em `core/constants.ts`.
- **Idioma:** comentários e termos de domínio em **pt-BR** (saque, cortada, bloqueio, rodízio).
  Siga o estilo do arquivo em que estiver mexendo.
- **Tuning centralizado:** dimensões, física e parâmetros de IA/dificuldade ficam em
  `core/constants.ts`. Ajuste de gameplay = editar constantes, não espalhar números mágicos.
- **Assets de runtime devem ser locais.** É proibido carregar CDN, fonte, imagem, modelo,
  áudio, vídeo ou API por URL: **zero URLs remotas em runtime**. Assets locais são permitidos
  quando forem originais ou tiverem autoria ou licença registrada, manifesto, orçamento e
  fallback. A geometria procedural existente continua válida; não é mais uma obrigação para
  toda arte nova.
- **Estilo:** Prettier decide formatação (aspas simples, ponto e vírgula, 100 colunas, 2 espaços).
  LF em todo o repo (`.gitattributes`). Rode `npm run check` antes de commitar.

## Gotchas

- **Node ≥ 20.19** (exigência do Vite 8). `.nvmrc` fixa a 22.
- **Windows/Mac:** se `git` reclamar de *dubious ownership*, rode
  `git config --global --add safe.directory "<caminho do repo>"`. `.gitattributes` força LF
  para evitar ruído de CRLF entre as máquinas.
- **Debug no browser:** o objeto da partida é exposto em `window.__match` no console (em dev
  sempre; no build de produção só com `?debug` na URL, no mesmo estilo do `?touch=1`).
- **Celular:** `?touch=1` na URL força os controles de toque no desktop para teste. `npm run dev`
  fica só em `localhost`; para abrir no celular físico rode `npm run dev:lan` e acesse
  `http://<ip-da-maquina>:5173/?touch=1` (mesma rede Wi-Fi).
- Qualidade gráfica cai automaticamente em telas de toque (pixel ratio, tamanho da torcida).
