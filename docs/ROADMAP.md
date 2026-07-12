# Roadmap

Do protótipo jogável ao produto profissional. Ordenado por dependência, não por data.
Escopo fixado: **single-player vs CPU** (sem multiplayer/online); publicar em **Web, Desktop/Steam
e Mobile** a partir do mesmo código web.

Estado atual: **v1.1.0** jogável e corrigida. **Design 2.0 aprovado** em
[`2026-07-12-pro-volei-2-0-design.md`](superpowers/specs/2026-07-12-pro-volei-2-0-design.md).
A execução segue subfases publicáveis: Fase 1A políticas/docs; 1B gates; 1C deploy Actions; 1D
remoção de `gh-pages`; depois controles, IA, arte/render, mobile/áudio, Copa e release 2.0.0.

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
- **Fase 2D — implementação local concluída:** máquina tap/hold/buffer vinculada ao plano,
  resolvedor contextual e técnicas distintas para os seis contextos passaram por 494 testes,
  11 E2E desktop/mobile, build/smoke de produção e duas revisões independentes sem findings após
  as correções de lifecycle. Teclado e touch compartilham a mesma intenção; o terceiro toque vai
  automaticamente à quadra rival. Publicação e smoke público serão registrados no fechamento.

### Controle e game feel 2.0 — próximas subfases

- **Fase 2E:** feedback de timing, câmera e game feel sobre o novo controle.

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

### Fase 3 — Performance e arte

Elevar qualidade percebida e garantir 60fps em mobile.

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
