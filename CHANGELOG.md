# Changelog

Todas as mudanças notáveis do Pró Volei. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Ferramental de qualidade: ESLint 10 (flat config) + Prettier 3, `.editorconfig`,
  `.gitattributes` (LF), `.nvmrc` (Node 22).
- Testes com Vitest 4 e primeira suíte cobrindo os solvers balísticos (`math3d`).
- CI no GitHub Actions: typecheck · lint · format · test · build em push em main.
- Scripts npm: `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`,
  `test:watch`, `check`.
- Documentação: `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/deployment/*`, `docs/claude-code-setup.md`.
- Campo `engines` no `package.json` (Node ≥ 20.19).

### Alterado

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
