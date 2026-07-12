# 🏐 PRÓ VOLEI

Jogo de vôlei 3D no browser — **você contra o computador**, 6×6, quadra oficial,
torcida viva, juiz, câmera de transmissão dinâmica. Feito com Three.js + TypeScript + Vite.

**🎮 Jogue agora: https://tarikdsm.github.io/pro_volei/**

Funciona no desktop (teclado) e no **celular (controles de toque)** — melhor na horizontal.

O time da casa conta com **Elisa** (#1, rabo de cavalo castanho claro), **Heloisa**
(#2, cabelo preto liso) e **Isabela** (#3, loira) — nomes estampados nas costas das camisas.

## Como rodar localmente

```bash
npm install   # instala as dependências (node_modules não vai para o git)
npm run dev   # abre em http://localhost:5173
```

A release atual funciona **100% offline** depois do `npm install`: geometria procedural,
texturas em canvas e áudio via Web Audio API, sem downloads remotos em runtime. O design 2.0
também permite modelos, texturas e sons locais otimizados; a regra de zero assets remotos permanece.

## Desenvolvimento

Ferramental profissional configurado. Antes de commitar, rode o portão de qualidade:

```bash
npm run check   # typecheck + lint + format + testes
npm run test    # só os testes (Vitest)
npm run lint    # ESLint (lint:fix aplica correções)
npm run format  # Prettier
```

O CI (GitHub Actions) roda o mesmo `check` + build em cada push em main. Guia completo de
setup, estilo e fluxo em **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Publicar no GitHub Pages

```bash
npm run deploy   # builda e publica dist/ na branch gh-pages
```

### Controles no celular (toque)

**Joystick** (esquerda) move e mira · **botão 🏐** (direita) faz tudo: segure para
carregar o saque, toque no momento da recepção, toque para pular no ataque/bloqueio ·
**zonas de ataque** são botões tocáveis · **⏸** pausa.

### Controles no teclado

| Momento | Tecla | Ação |
|---|---|---|
| Saque | **segurar ESPAÇO** | carrega a força — solte na *zona verde* para o saque perfeito |
| Saque | **WASD** | ajusta a mira no campo adversário |
| Recepção/Defesa | **WASD** | move o jogador (anel verde) até o ponto de queda (anel amarelo) |
| Recepção/Defesa | **ESPAÇO** | no momento do toque = passe perfeito · contra cortada forte é obrigatório! |
| Levantamento | **A / W / D** | escolhe a zona de ataque (esquerda / centro / direita) |
| Ataque | **ESPAÇO** | pula — o timing do pulo define a força da cortada |
| Ataque | **WASD** | mira a cortada no ar (losango azul) |
| Bloqueio | **A / D** | desliza ao longo da rede |
| Bloqueio | **ESPAÇO** | pula para bloquear |
| — | **ESC** | pausa |

### Regras implementadas
Rally point · 3 toques por posse · rodízio de 6 posições · toque de bloqueio não conta ·
saque na rede = ponto do recebedor · bola na rede durante o rally continua viva ·
set point / vitória por 2 de vantagem · formatos: 1 set de 15 ou melhor de 3 a 25.

### Dificuldades
**Fácil** — CPU lenta, erra mais, defende pouco. **Normal** — equilíbrio.
**Difícil** — CPU reage rápido, saca forte, bloqueia e defende muito. Cortadas fortes
exigem ESPAÇO no tempo certo para defender ("DEFESAÇA!").

## Arquitetura

```
src/
├── core/        constantes, solvers balísticos, input, áudio procedural
├── world/       quadra, ginásio, torcida instanciada (~1500), juiz
├── entities/    personagens humanoides procedurais, bola com rastro
├── systems/     diretor de câmera broadcast, partículas/confete
├── game/        Team (rodízio) e Match (máquina de estados do rally + IA)
└── ui/          HUD (placar, medidor, banners) e menus
```

Detalhes em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. Plano de produto em
**[docs/ROADMAP.md](docs/ROADMAP.md)**.

## Documentação

| Doc | Para quê |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Contexto do projeto para o Claude Code |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, fluxo de trabalho e estilo de código |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura atual e refatoração-alvo |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Do protótipo ao produto (fases) |
| [docs/deployment/](docs/deployment/) | Publicar em Web · Desktop/Steam · Mobile |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |

## Build de produção

```bash
npm run build    # gera dist/ estático (~150 kB gzip)
npm run preview  # serve o build
```
