# Roadmap

Do protótipo jogável ao produto profissional. Ordenado por dependência, não por data.
Escopo fixado: **single-player vs CPU** (sem multiplayer/online); publicar em **Web, Desktop/Steam
e Mobile** a partir do mesmo código web.

Estado atual: **v1.1.0** jogável e corrigida. **Design 2.0 aprovado** em
[`2026-07-12-pro-volei-2-0-design.md`](superpowers/specs/2026-07-12-pro-volei-2-0-design.md).
A execução segue subfases publicáveis: Fase 1A políticas/docs; 1B gates; 1C deploy Actions; 1D
remoção de `gh-pages`; depois controles, IA, arte/render, mobile/áudio, Copa e release 2.0.0.

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

- [ ] **Web:** pipeline de deploy contínuo (Pages/itch.io), `<meta>` de PWA, tela de carregamento
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
- **Um código, três lojas:** evitar divergência de plataforma; isolar o específico nos wrappers.

> Este roadmap é vivo. Ajuste as caixas conforme a prioridade real. O histórico de como o
> protótipo foi construído está em [docs/history/PROTOTYPE-PLAN.md](history/PROTOTYPE-PLAN.md).
