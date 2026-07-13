# Changelog

Todas as mudanças notáveis do Pró Volei. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Núcleo de controle 2.0 com `InputHub` timestamped, `InputFrame`, `ControlFrame` e mapeamento de
  direção relativo à câmera.
- Testes determinísticos de bordas, cancelamento, composição teclado/touch e teste Chromium de
  dois toques simultâneos com hit-testing real.
- Simulação fixa a 60 Hz com câmera lenta determinística, limite de 250 ms/5 ticks, diagnóstico de
  stalls e consumo de input no cutoff real exato de cada tick.
- Timeline analítica para callbacks, contatos, pulos, rede, antena e chão, com ordenação estável e
  tolerância numérica determinística nas fronteiras.
- Interpolação visual de bola, atletas, rotação, salto, marker, sombra e rastro entre snapshots da
  simulação, sem contaminar regras ou IA.
- AutoSelector para recepção/defesa e bloqueio com ETA 2D igual ao movimento real, custos táticos,
  histerese de 15%, máximo de duas trocas por plano e lock nos 350 ms finais.
- Movimento planar com aceleração/frenagem arcade e assistência de alvo limitada a 0,65 m, sem
  teleporte nem corrida humana automática até o contato.
- Máquina contextual única para Espaço/toque com tap abaixo de 12 ticks, hold/carga progressiva,
  buffer de 9 ticks, cancelamento por lifecycle e identidade vinculada ao plano.
- Técnicas semânticas para saque flutuante/potente, manchete/mergulho, set alto/rápido,
  largada/ataque colocado/cortada, bloqueio rápido/penetrante e terceiro toque para a quadra rival.
- Feedback compacto da ação no anel da atleta, snapshot DEV readonly e E2E determinístico da
  mesma gramática no teclado e no multitouch com joystick simultâneo.
- Feedback de timing sincronizado, câmera broadcast com safe frame, envelopes determinísticos de
  FOV/shake e modo reduced motion.
- `RandomHub` com streams independentes, simulação headless CPU×CPU, `RallyJournal` v1 e
  `TacticalTrace` reproduzíveis em 30/60/120 Hz.
- `TeamBrain`/`TeamTacticsSystem` para recepção, transição, cobertura de ataque, defesa por
  corredores e bloqueio simples/duplo coordenado das seis atletas.
- `OpponentBrain` puro com percepção pública atrasada, memória curta e compromissos causais de
  saque, levantamento e ataque para os dois lados no headless.
- Execução estratégica de saques float/power, sets alto/rápido/acelerado e ataques
  power/placed/tip, com fallbacks físicos seguros e sem retarget.
- `StrategyTrace` canônico e `HeadlessStochasticCheckpoint` transacional para auditar candidatas,
  outcomes, budget de RNG e restaurar RNG+estratégia sem rebobinar o `Match`.
- Ferramental de qualidade: ESLint 10 (flat config) + Prettier 3, `.editorconfig`,
  `.gitattributes` (LF), `.nvmrc` (Node 22).
- Testes com Vitest 4 e primeira suíte cobrindo os solvers balísticos (`math3d`).
- CI no GitHub Actions: typecheck · lint · format · test · build em push em main.
- Deploy contínuo do GitHub Pages após cobertura, build e smoke do `dist`, usando
  `checkout@v7`, `setup-node@v6`, `upload-pages-artifact@v5`, `configure-pages@v6` e
  `deploy-pages@v5`.
- Scripts npm: `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`,
  `test:watch`, `check`.
- Documentação: `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/deployment/*`, `docs/claude-code-setup.md`.
- Campo `engines` no `package.json` (Node ≥ 20.19).

### Alterado

- Gameplay do teclado simplificado para setas + Espaço; touch agora alimenta diretamente o mesmo
  contrato semântico, com ownership e captura de ponteiro.
- Em telas touch, portrait pausa a partida e pede rotação; landscape retoma o jogo com o máximo de
  área útil e controles simultâneos.
- `HumanController` deixou de consultar teclas/DOM; a direção do levantamento substitui A/W/D e
  cancelamentos de blur/pausa não fabricam release de ação.
- `Match` delega a segmentação temporal a `MatchTimeline`; regras e física não dependem mais do FPS
  de renderização, e pausa/resume não reapresenta snapshots antigos.
- Stalls acima de 250 ms cancelam ação/carga sem apagar setas ou joystick mantidos; o smoke de
  produção força um frame de 350 ms para proteger esse comportamento em hardware lento.
- `TouchPlan` ganhou identidade monotônica; rebind de atleta preserva timing, mira e ação do mesmo
  plano, e o bloqueio usa um canal HOME separado da atacante AWAY.
- CI ampliado: typecheck de produção/testes/configs, cobertura V8 de todo `src`, build e smoke
  Chromium do artefato servido por `vite preview`.
- O mesmo `dist/` aprovado pelo job `check` agora é publicado automaticamente pelo job `deploy`.
  O primeiro deploy foi o run `29201051491` attempt 1 (`c917145`) e o segundo foi o run
  `29201410995` attempt 1 (`da18cbd`). O rollback pelo attempt 2 do primeiro run promoveu
  `c917145` no deployment `5414503098`; o attempt 2 do segundo restaurou `da18cbd` no deployment
  `5414518284`. Ambos os deployments ficaram verdes e passaram smoke público, concluindo a Fase
  1C e autorizando a Fase 1D.
- A Fase 1D removeu o caminho concorrente após o run `29202163302` do SHA `dcba25b` e o deployment
  `5414657439` ficarem verdes. O smoke público passou antes e depois da exclusão; Pages permaneceu
  em workflow/HTTPS, com policy `main`, e o remoto passou a listar somente `main`.
- Design da versão 2.0 aprovado: controles de setas + ação contextual, IA coletiva,
  personagens locais animados, experiência mobile landscape e Copa curta. A implementação ocorre
  em fases; esta entrada não anuncia essas features como disponíveis na v1.1.
- Política offline permite assets locais originais/licenciados e continua proibindo URLs remotas
  em runtime.
- Baseline de formatação do código aplicado com Prettier.
- `PLAN.md` movido para `docs/history/PROTOTYPE-PLAN.md` (registro histórico do protótipo);
  o planejamento vivo agora é `docs/ROADMAP.md`.

### Corrigido

- Removidas duas pendências apontadas pelo lint (atribuição inútil em `Match.ts`,
  variável morta em `Team.ts`) — sem mudança de comportamento.

### Removido

- `KeyState`, WASD de gameplay, zonas touch clicáveis e todos os `KeyboardEvent` sintéticos usados
  por joystick, ação e pausa.
- Script npm e pacote do deploy legado, seguidos pela exclusão da branch `gh-pages`. O SHA
  histórico de recuperação `15f9c244f7ab6fb58a4114a926d3c061a087a336` foi registrado, mas não
  precisou ser usado porque o smoke pós-exclusão permaneceu verde.

---

## [1.1.0] — protótipo

Estado herdado do desenvolvimento inicial (feito no macOS). Marco de referência.

### Adicionado

- Jogo de vôlei 3D completo e jogável: humano vs CPU, 6×6, quadra oficial.
- Motor de rally com regras reais (rally point, 3 toques, rodízio, bloqueio não conta,
  set/match point com vantagem de 2, formatos de 1 set a 15 ou melhor de 3 a 25).
- IA em 3 dificuldades (Fácil/Normal/Difícil).
- Câmera broadcast dinâmica com spike-cam e slow-motion; efeitos, torcida (~1500), juiz.
- Controles de teclado e de toque (celular). Deploy no GitHub Pages.
- Jogadoras personalizadas (Elisa, Heloisa, Isabela) com nomes e visuais.

> Histórico detalhado das fases de construção em
> [docs/history/PROTOTYPE-PLAN.md](docs/history/PROTOTYPE-PLAN.md) e no `git log`.
