> **Documento histórico.** Este é o plano original de construção do *protótipo* (feito no
> macOS), preservado como registro. Ele já foi **concluído** — todas as fases 0–8 estão no
> `git log`. O planejamento **vivo** do produto está em [../ROADMAP.md](../ROADMAP.md) e a
> arquitetura atual/alvo em [../ARCHITECTURE.md](../ARCHITECTURE.md).

---

# VOLEY PRO — Plano de Desenvolvimento

Jogo de vôlei 3D no browser. Humano vs Computador, 6x6, quadra oficial, torcida, juiz, câmera dinâmica.

## Stack
- **Three.js** (r185) — renderização 3D WebGL
- **TypeScript** — tipagem forte
- **Vite** — dev server + build
- **Web Audio API** — áudio 100% procedural (zero assets externos, funciona offline)
- **Física própria** — trajetórias balísticas analíticas (controle total da jogabilidade, estilo arcade-sim)

## Resiliência offline
- Todas as dependências em `node_modules` (instaladas antecipadamente)
- Git local com commit ao fim de cada fase — nada se perde
- Nenhum asset remoto: geometria procedural, texturas via canvas, áudio sintetizado

## Arquitetura
```
src/
├── main.ts                  — bootstrap, game loop, timeScale (slow-motion)
├── core/
│   ├── constants.ts         — dimensões oficiais, física, tuning, tipos
│   ├── math3d.ts            — solvers balísticos (arco/drive), easing, RNG
│   ├── Input.ts             — teclado + mouse
│   └── AudioEngine.ts       — apito, toques, torcida, jingles (procedural)
├── world/
│   ├── Court.ts             — piso Taraflex, linhas, rede, postes, antenas
│   ├── Arena.ts             — arquibancadas, iluminação de ginásio, placar 3D, banners
│   ├── Crowd.ts             — ~1500 torcedores instanciados, animação, ola, intensidade
│   └── Referee.ts           — juiz na cadeira, gestos de ponto, apito
├── entities/
│   ├── PlayerCharacter.ts   — humanoide procedural, uniforme, número, animações paramétricas
│   └── Ball.ts              — bola com gomos, rastro, sombra projetada
├── systems/
│   ├── CameraDirector.ts    — direção de câmera broadcast: saque, rally, spike-cam, celebração
│   └── Effects.ts           — partículas de impacto, confete, shake, anel de queda
├── game/
│   ├── Team.ts              — atleta (estado físico/animação), time, rotação
│   └── Match.ts             — máquina de estados do rally, regras, IA, controle humano
└── ui/
    ├── HUD.ts               — placar, medidor de saque, banners (ACE!, BLOQUEIO!), dicas
    └── Menu.ts              — título, dificuldade, formato, pausa, vitória com estatísticas
```

## Gameplay (humano = time da esquerda)
- **Saque**: segurar ESPAÇO carrega força (zona perfeita arriscada), WASD mira o alvo no campo adversário
- **Recepção/Defesa**: controla o jogador mais próximo da queda (anel no chão); WASD move; ESPAÇO no tempo certo = passe perfeito
- **Levantamento**: automático pelo levantador; A/W/D escolhe a zona de ataque (esquerda/centro/direita)
- **Ataque**: ESPAÇO pula (timing = potência), WASD mira no ar, contato automático no ápice
- **Bloqueio**: A/D desliza na rede, ESPAÇO pula; posição+timing decidem stuff/deflection
- Regras reais: rally point, 3 toques, rodízio, toque de bloqueio não conta, saque na rede = ponto adversário, bola fora

## IA (3 dificuldades)
Parâmetros: atraso de reação, velocidade, distribuição de qualidade de passe, taxa de erro
de ataque/saque, probabilidade de bloqueio/defesa. Alvos inteligentes (cantos, longe da defesa).

## Câmera dinâmica (broadcast director)
- Saque: atrás do sacador · Rally: lateral elevada seguindo a bola com amortecimento
- Spike-cam: aproximação rápida + slow-motion no contato + FOV punch + screen shake
- Ponto: órbita de celebração · Transições suaves com easing / cortes secos onde apropriado

## Elementos de experiência
Rastro da bola, partículas de impacto, confete na vitória, torcida que reage ao rally
(intensidade crescente, ola), banners animados (ACE!, MONSTER BLOCK!, SET POINT),
contador de rally longo, estatísticas de partida, áudio reativo.

## Fases (1 commit por fase)
0. Scaffold (Vite+TS+Three) ✅ deps instaladas
1. Constantes, matemática balística, quadra, arena, luzes
2. Personagens procedurais + bola + animações
3. Motor de rally: física, regras, IA completa
4. Controles humanos (saque/recepção/ataque/bloqueio)
5. Câmera dinâmica
6. Torcida, juiz, efeitos, áudio
7. HUD + menus + placar
8. Teste no browser (loop: rodar → screenshot → corrigir), tuning e polimento
