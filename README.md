# 🏐 PRÓ VOLEI

Jogo de vôlei 3D no browser — **você contra o computador**, 6×6, quadra oficial,
torcida viva, juiz, câmera de transmissão dinâmica. Feito com Three.js + TypeScript + Vite.

**🎮 Jogue agora: https://tarikdsm.github.io/pro_volei/**

Funciona no desktop (teclado) e no **celular (controles de toque)** — melhor na horizontal.

**Versão do código:** **2.0.0**. As Fases 1–7 estão concluídas; o artefato identificado por versão
e SHA é promovido pela `main`, CI/Pages e tag do mesmo commit. O jogo possui simulação
determinística, IA coletiva, Copa curta, cosméticos, opções de acessibilidade, PWA offline,
recuperação de plataforma e perfis adaptativos de qualidade.

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

A Copa tem quatro adversárias com identidades táticas, retomada entre sessões e quatro recompensas
cosméticas sem vantagem de gameplay. Preferências, estatísticas e progresso usam save versionado
com migração e fallback em memória quando o storage está bloqueado ou corrompido.

## Desenvolvimento

Ferramental profissional configurado. Antes de commitar, rode o portão de qualidade:

```bash
npm run check   # workflow + typecheck + lint + format + cobertura
npm run test    # só os testes (Vitest)
npm run test:coverage # testes + cobertura V8 (mínimo de 30% em todo src)
npm run lint    # ESLint (lint:fix aplica correções)
npm run format  # Prettier
```

O CI roda `npm run check`, build e smoke Chromium do `dist/` servido por `vite preview` em cada
push para `main`. O fluxo do projeto permanece main-only, com commits e push em main. Guia
completo de setup, estilo e fluxo em
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Publicar no GitHub Pages

Pushes verdes em `main` publicam automaticamente pelo GitHub Actions o mesmo `dist/` que passou
por cobertura, build e smoke de produção. O site atual é
**https://tarikdsm.github.io/pro_volei/**.

As Fases 1C e 1D deixaram o repositório literalmente main-only: o deploy é feito somente pelo
Actions. Para rollback, reexecute um workflow verde anterior ou use `git revert`; não existe
branch de deploy nem fallback concorrente. Verificação do Pages, policy, deployments e operação
estão em
**[docs/deployment/web.md](docs/deployment/web.md)**.

### Controles no celular (toque)

**Botão 🏐** (esquerda) faz tudo: segure para carregar o saque e toque no tempo da ação ·
**joystick** (direita) move, mira e escolhe o ataque durante o levantamento. Em portrait a partida
pausa e pede para girar o aparelho; em landscape ela ocupa a tela e volta ao jogo. A partida
rápida inicia automaticamente no landscape e não há botão de pausa sobre a quadra.

### Controles no teclado

| Momento | Tecla | Ação |
|---|---|---|
| Saque | **segurar ESPAÇO** | carrega a força — solte na *zona verde* para o saque perfeito |
| Saque | **SETAS** | ajusta a mira no campo adversário, relativa à câmera |
| Recepção/Defesa | **SETAS** | move o jogador (anel verde) até o ponto de queda (anel amarelo) |
| Recepção/Defesa | **ESPAÇO** | no momento do toque = passe perfeito · contra cortada forte é obrigatório! |
| Levantamento | **SETAS** | escolhe a direção do ataque; neutro preserva a recomendação atual |
| Ataque | **ESPAÇO** | pula — o timing do pulo define a força da cortada |
| Ataque | **SETAS** | mira a cortada no ar (losango azul), relativa à câmera |
| Bloqueio | **SETAS** | desliza ao longo da rede |
| Bloqueio | **ESPAÇO** | pula para bloquear |
| — | **ESC** | pausa |

### Regras implementadas
Rally point · 3 toques por posse · rodízio de 6 posições · toque de bloqueio não conta ·
saque na rede = ponto do recebedor · bola na rede durante o rally continua viva ·
set point / vitória por 2 de vantagem · formatos: Oficial 2.0 (melhor de 3 a 11·11·7),
Rápida (1 set a 15) e Clássica (melhor de 3 a 25).

### Dificuldades
**Fácil** — CPU lenta, erra mais, defende pouco. **Normal** — equilíbrio.
**Difícil** — CPU reage rápido, saca forte, bloqueia e defende muito. Cortadas fortes
exigem ESPAÇO no tempo certo para defender ("DEFESAÇA!").

A IA 2.0 observa somente informação pública atrasada conforme a dificuldade, mantém memória curta
da partida e compromete jogadas sem retarget: saque float/potente, levantamentos alto/rápido/
acelerado e ataques de potência/colocado/largada. A dificuldade altera percepção, decisão e
consistência técnica, mas não a realização física do saque nem lê input/alvo privado do jogador.

## Arquitetura

```
src/
├── core/        constantes, solvers balísticos, input, áudio procedural
├── world/       quadra, ginásio, torcida instanciada (~1500), juiz
├── entities/    personagens humanoides procedurais, bola com rastro
├── systems/     diretor de câmera broadcast, partículas/confete
├── game/        Match, regras, controle, simulação headless, TeamBrain e estratégia da CPU
├── meta/        Copa, cosméticos e preferências/acessibilidade
├── platform/    save, PWA, desbloqueio de áudio e recuperação do app
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
| [docs/superpowers/plans/README.md](docs/superpowers/plans/README.md) | Índice e estado de todos os planos |
| [docs/codereviews/2026-07-13-fase-3-relatorio-final.md](docs/codereviews/2026-07-13-fase-3-relatorio-final.md) | Fechamento técnico do marco 3A–3C |
| [docs/release/2.0.0-verification.md](docs/release/2.0.0-verification.md) | Evidências e gates do release 2.0.0 |
| [docs/deployment/](docs/deployment/) | Publicar em Web · Desktop/Steam · Mobile |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |

## Build de produção

```bash
npm run build    # gera dist/ estático (~222 kB JS gzip no fechamento técnico da Fase 7C)
npm run preview  # serve o build
```
