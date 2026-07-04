# 🏐 VOLEY PRO

Jogo de vôlei 3D no browser — **você contra o computador**, 6×6, quadra oficial,
torcida viva, juiz, câmera de transmissão dinâmica. Feito com Three.js + TypeScript + Vite.

![stack](https://img.shields.io/badge/Three.js-r185-blue) ![lang](https://img.shields.io/badge/TypeScript-strict-blue)

## Como jogar

```bash
npm install   # (já instalado se você clonou com node_modules)
npm run dev   # abre em http://localhost:5173
```

Funciona **100% offline** depois do `npm install` — zero assets remotos:
toda a geometria é procedural, texturas geradas em canvas e áudio sintetizado via Web Audio API.

### Controles

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

Detalhes de design em [PLAN.md](PLAN.md).

## Build de produção

```bash
npm run build    # gera dist/ estático (~150 kB gzip)
npm run preview  # serve o build
```
