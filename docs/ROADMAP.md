# Roadmap

Do protótipo jogável ao produto profissional. Ordenado por dependência, não por data.
Escopo fixado: **single-player vs CPU** (sem multiplayer/online); publicar em **Web, Desktop/Steam
e Mobile** a partir do mesmo código web.

Estado atual: **v1.1.0** jogável, com as **Fases 1–2 e subfases 3A–3D concluídas**.
**Design 2.0 aprovado**, documentado em
[`2026-07-12-pro-volei-2-0-design.md`](superpowers/specs/2026-07-12-pro-volei-2-0-design.md).
Em 18/07/2026 o proprietário autorizou explicitamente a retomada: a Fase 3D foi entregue no mesmo
dia e as subfases **4A–4E (personagens e render) são a próxima etapa autorizada**. Fases 5–7
continuam aguardando a conclusão dessas etapas.

### Fundação 2.0 — estado das subfases

- **Fase 1A — concluída:** políticas canônicas, escopo offline e fluxo main-only alinhados.
- **Fase 1B — concluída:** typecheck amplo, cobertura, build e smoke do `dist` no gate.
- **Fase 1C — concluída:** deploy automático e promoção por SHA comprovados. O primeiro deploy foi
  o run `29201051491` attempt 1 (`c917145`); o segundo, `29201410995` attempt 1 (`da18cbd`). O
  rollback promoveu `c917145` no attempt 2 do primeiro run (deployment `5414503098`) e a
  restauração promoveu `da18cbd` no attempt 2 do segundo (deployment `5414518284`); ambos ficaram
  verdes e passaram smoke público.
- **Fase 1D — concluída:** script, pacote e branch `gh-pages` removidos. O run `29202163302` do SHA
  `dcba25b` e o deployment `5414657439` ficaram verdes; smoke público passou antes e depois da
  exclusão. O remoto lista somente `main`, enquanto Pages permanece em workflow/HTTPS com policy
  `main`. O SHA histórico `15f9c244f7ab6fb58a4114a926d3c061a087a336` não precisou ser usado.
- **Fase 2A — concluída:** `InputFrame` timestamped, setas + Espaço, touch direto, direção relativa
  à câmera e cancelamento sem release passaram por testes unitários, E2E multitouch e playtest
  desktop/mobile. O run `29204014194` publicou o SHA `2714264` no deployment `5415090698`; smoke
  público desktop e touch landscape passaram sem erros.
- **Fase 2B — concluída:** runner fixo a 60 Hz, slow-motion determinística, timeline analítica e
  apresentação interpolada passaram por 359 testes, suíte E2E desktop/mobile, playtest real e
  revisão independente sem findings. O primeiro run (`29206272786`) revelou no CI lento que
  `wall-cap` apagava uma seta mantida; o commit corretivo `959ef37` adicionou regressão com stall
  forçado, passou no run `29206518556` e publicou o deployment `5415649743`. O smoke público
  confirmou direção contínua, descarte diagnosticado e rally jogável. O remoto mantém só `main`.
- **Fase 2C — concluída:** movimento planar com aceleração/frenagem,
  AutoSelector por ETA 2D, custos táticos, histerese 15%/duas trocas/lock 350 ms e assistência de
  0,65 m passaram por 398 testes, E2E desktop/mobile, smoke do build, playtest real e revisão
  independente sem findings. O run `29208396722` publicou o SHA `63aaf23` no deployment
  `5416115597`; o playtest no Pages observou o plano 2 travado na atleta 0, viável, sem troca e sem
  erros de console. O remoto continuou listando somente `main`.
- **Fase 2D — concluída:** máquina tap/hold/buffer vinculada ao plano,
  resolvedor contextual e técnicas distintas para os seis contextos passaram por 494 testes,
  11 E2E desktop/mobile, build/smoke de produção e duas revisões independentes sem findings após
  as correções de lifecycle. Teclado e touch compartilham a mesma intenção; o terceiro toque vai
  automaticamente à quadra rival. O run `29210820681` publicou o SHA `e1a1b10` no deployment
  `5416656576`; o playtest público observou `quick-set` hold (carga 0,4667), `tip` tap e `high-set`
  tap em uma partida real, sem erros de console. O remoto continuou somente com `main`.
- **Fase 2E — concluída:** feedback de timing sincronizado, câmera broadcast com safe frame,
  envelopes de FOV/shake e reduced motion foram integrados ao controle de um botão. Testes, E2E,
  playtests desktop/mobile, CI e Pages fecharam verdes sem alterar a física.
- **Fase 3A — concluída:** `RandomHub` com streams independentes, simulação CPU×CPU headless,
  `RallyJournal` versionado, watchdogs e determinismo em 30/60/120 Hz formam a base mensurável da
  IA coletiva.
- **Fase 3B — concluída:** `TeamBrain` e `TeamTacticsSystem` coordenam as seis atletas em recepção,
  recomposição, transição, cobertura, defesa por corredores e bloqueio simples/duplo. A matriz de
  1.000 rallies terminou com zero violações táticas; o run `29220550106` e Pages ficaram verdes.
- **Fase 3C — concluída:** `OpponentBrain` usa observação pública atrasada e memória curta para
  comprometer saque, levantamento e ataque. O lifecycle causal executa float/power, set
  alto/rápido/acelerado e ataque power/placed/tip; trace e checkpoint estocástico comprovam
  budget fixo, terminalidade e determinismo. O commit funcional final `e33ab54` passou 911 testes,
  build, smoke e o run `29244051320`, com deploy Pages verde.
- **Fase 3D — concluída:** formato oficial 2.0 (melhor de 3 a 11·11·7 com caps 15/15/11),
  métricas de balanceamento no runner headless (side-outs, classe decisivo/erro gratuito, zonas
  de destino, partidas completas via `runHeadlessMatches`) e remoção do multiplicador físico
  legado `servePower` (critério 6). O diagnóstico sistemático corrigiu o pulo/aproximação do
  ataque da CPU e o levantamento de terceiro toque; o tuning do Normal fechou as faixas
  §4.3/§3.2 como gates de regressão: 1.000 rallies/20 seeds com mediana de 6 contatos, 78,4% de
  pontos decisivos e zona máxima 42%; 30 partidas/10 seeds com mediana de 10,6 min e p90 de
  13,5 min. O commit funcional `9ab1965` passou 938 testes, `npm run check` e playtest real; o
  run `29653613239` publicou o deploy Pages verde.
- **Fase 4A — concluída:** atleta com esqueleto real (19 ossos nomeados, `SkinnedMesh` por
  região de material, skinning rígido) construída proceduralmente em código e adotada como
  personagem padrão via `CharFactory`, com as 12 poses portadas para espaço de osso (idle agora
  determinístico por dt) e decal de número/nome injetável (headless-safe). Prova de orçamento no
  rally real: draw calls da cena caíram de ~515 para 235 e triângulos ficaram em ~144 mil
  (≤ 250 mil do alvo mobile); 950 testes e playtest com as 12 atletas legíveis na câmera
  broadcast. O commit funcional `8d89201` passou `npm run check` e smoke de produção; o run
  `29655834095` publicou o deploy Pages verde e o smoke público mostrou nome/número de Elisa
  nas costas. A direção "rig procedural, GLB opcional depois" foi autorizada pelo proprietário
  em 18/07/2026.
- **Fase 4B — concluída:** locomoção direcional (parada/ajuste/corrida frontal-lateral/freada
  via `classifyLocomotion`), solver analítico de IK de dois ossos, foot planting com deslize
  ≤ 0,15 m testado e mãos que buscam o ponto analítico do contato (≤ 0,12 m em alvo alcançável,
  com antecipação alimentada pelo `planNext`). `CharVisual` cresceu apenas com métodos
  opcionais (`setPlanarMotion`/`setContactAim`); IK e pose blendam nos alvos de um único
  damping, tudo determinístico por dt. 967 testes, playtest desktop/844×390 sem erros e draw
  calls em 249 (≤ 250 do §10.2). O commit funcional `a865482` passou `npm run check`; o run
  `29660489841` publicou o deploy Pages verde com smoke público limpo.
- **Fase 4C — concluída:** corpo parametrizado (altura 0,94–1,06 e porte 0,92–1,10, penteados
  `bun`/`braid` novos), elenco nomeado 6+6 (`roster.ts` — Elisa/Heloisa/Isabela preservadas,
  AWAY ganhou seis identidades) e galeria determinística DEV-only (`?gallery`) para o aceite.
  Duas revisões visuais independentes aplicaram o checklist §5.3 nos viewports 1920×1080,
  844×390 e 568×320 + câmera de rally: **APROVADO sem itens altos**; ressalvas médias tratadas
  (cabelo da nº 11 clareado) ou aceitas formalmente (no viewport 568 a distinção fina é por
  time; números legíveis com conforto só na atleta controlada; bola em voo já evidenciada nos
  screenshots da 4A/4B, sem mudança na 4C). 976 testes verdes; o commit funcional `89e83ad`
  passou `npm run check` e o run `29661585073` publicou o deploy Pages verde com smoke
  público limpo.

### Marco atual — IA coletiva 2.0 completa; personagens e render a seguir

- **Entregue:** Fases 1A–1D, 2A–2E e 3A–3D.
- **Autorizado, próxima etapa:** 4A–4E (personagens e render), em ordem, cada uma com plano
  detalhado antes de alterar produção.
- **Não iniciado:** Fases 5–7 do design 2.0 (aguardam autorização).
- O índice canônico dos planos e suas evidências está em
  [`superpowers/plans/README.md`](superpowers/plans/README.md).

---

## Fase 0 — Fundação de engenharia ✅ (concluída nesta organização)

Base para desenvolver com segurança e ritmo.

- [x] ESLint + Prettier + EditorConfig + `.gitattributes` (LF) + `.nvmrc`
- [x] Vitest com primeiro conjunto de testes (`math3d`)
- [x] CI no GitHub Actions (typecheck · lint · format · test · build)
- [x] Documentação (CLAUDE.md, ARCHITECTURE, CONTRIBUTING, CHANGELOG, deployment)
- [ ] Configurar proteção compatível com main-only: bloquear force-push/deleção sem exigir PR.

## Fase 1 — Refatoração da arquitetura ✅ (concluída)

Quebrar `Match.ts` antes de crescer o jogo. Detalhes e passo a passo em
[ARCHITECTURE.md](ARCHITECTURE.md#refatoração-alvo).

- [x] Testes de caracterização das regras (pontuação, rodízio, set/partida)
- [x] Extrair `rules/` (Scoring, Rotation, SetMatch) como funções puras testadas
- [x] Introduzir `RallyState` explícito
- [x] Extrair `mechanics/` (Serve, Touch, Block)
- [x] Separar `ai/AiController` de `control/HumanController`
- [x] `Match.ts` vira orquestrador de state machine + event queue + update loop; permanece acima
      do tamanho-alvo e não deve crescer

**Saída:** cada regra testável isoladamente; IA e dificuldades plugáveis.

## Roadmap legado absorvido pelo plano 2.0

As antigas Fases 2–5 abaixo registram o roadmap anterior. Seus objetivos foram absorvidos e
reordenados pelo design 2.0 e pelas subfases publicáveis descritas acima; não definem a ordem
vigente de execução.

### Fase 2 — Qualidade de jogo e conteúdo

Aprofundar o que já roda, agora sobre base limpa.

- [ ] Ajuste fino de dificuldade guiado por métricas (taxa de erro, duração de rally)
- [ ] Mais variedade de jogadas (fintas, saque viagem, ataques de fundo)
- [ ] Progressão/meta: torneio, seleção de time, desbloqueáveis cosméticos
- [ ] Telas de opções (volume, qualidade gráfica, rebind de teclas)
- [ ] Persistência local (recordes, preferências) via `localStorage`
- [ ] Acessibilidade: daltonismo, escala de UI, legendas de eventos

### Fase legado 3 — Performance e arte

Elevar qualidade percebida e garantir 60fps em mobile.

> Esta seção pertence ao roadmap legado e **não** é o marco 3A–3C de IA coletiva recém-concluído. Seus
> objetivos foram redistribuídos entre as Fases 4, 5 e 7 do design 2.0 e estão pausados.

- [ ] Orçamento de performance por plataforma (draw calls, triângulos, texturas)
- [ ] LODs / instancing revisado para a torcida; sombras adaptativas
- [ ] Passe de iluminação e materiais; pós-processamento opcional no desktop
- [ ] Profiling em dispositivos reais de baixo/médio porte

### Fase 4 — Empacotamento multiplataforma

Mesmo código web, três alvos de loja. Guias em [docs/deployment/](deployment/).

- [ ] **Web:** deploy, rollback e remoção do legado concluídos nas Fases 1C/1D; itch.io,
      `<meta>` de PWA e tela de carregamento permanecem pendentes
- [ ] **Desktop/Steam:** wrapper [Tauri](deployment/desktop-steam.md) (build Win/Mac/Linux,
      ícones, integração Steamworks, página na loja)
- [ ] **Mobile:** wrapper [Capacitor](deployment/mobile.md) (iOS/Android, ícones/splash,
      safe-areas, ciclo das lojas)
- [ ] Matriz de release: um `git tag` gera artefatos para as três plataformas

### Fase 5 — Produção contínua

- [ ] Versionamento semântico + CHANGELOG mantido a cada release
- [ ] Telemetria opcional e anônima (opt-in) para balanceamento
- [ ] Canal de feedback/bug e triagem
- [ ] Trailer, screenshots, presskit

---

## Princípios

- **Offline-first:** assets de runtime devem ser locais, originais ou licenciados; zero URLs
  remotas em runtime.
- **Refatorar antes de crescer:** não empilhar features sobre `Match.ts` monolítico.
- **Verde sempre:** `npm run check` passando; `main` sempre buildável e jogável.
- **Literalmente main-only:** o remoto mantém somente `main`; não existe branch de deploy.
- **Um código, três lojas:** evitar divergência de plataforma; isolar o específico nos wrappers.

> Este roadmap é vivo. Ajuste as caixas conforme a prioridade real. O histórico de como o
> protótipo foi construído está em [docs/history/PROTOTYPE-PLAN.md](history/PROTOTYPE-PLAN.md).
