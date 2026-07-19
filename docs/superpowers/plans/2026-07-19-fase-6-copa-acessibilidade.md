# Fase 6 — Copa, persistência, cosméticos e acessibilidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma Copa de quatro partidas retomável, save local versionado, recompensas
exclusivamente cosméticas e opções/acessibilidade completas, preservando partida rápida e a
física única do jogo.

**Architecture:** Estado de produto fica em `meta/`; persistência e migrações em `platform/save/`;
UI apenas edita DTOs validados. A Copa fornece dificuldade e um perfil tático neutro à física.
Cosméticos são aplicados por portas de apresentação. Preferências humanas podem ampliar a leitura
de timing, mas nunca alteram regras, bola, CPU ou constantes físicas.

**Tech Stack:** TypeScript strict, localStorage injetável, Three.js r185, DOM/CSS, Vitest 4,
Playwright 1.61.

## Global Constraints

- Save inválido, ausente, antigo, bloqueado ou cheio nunca impede bootstrap/partida rápida.
- Vitória da Copa é persistida antes de qualquer tela, contagem ou próxima partida.
- Derrota mantém o confronto atual; Copa completa permanece concluída e pode ser reiniciada.
- Os quatro adversários têm vieses de escolhas táticas, não multiplicadores de física.
- Recompensas não importam `game/`, não contêm atributos de gameplay e sempre têm fallback base.
- Opções em portrait e desktop; landscape touch continua sem overlay bloqueante.
- Menus navegáveis por touch, Tab/setas e Espaço/Enter, sem armadilha de foco.
- `Match.ts` recebe apenas contratos/delegações mínimos e não absorve regras de meta/UI/storage.
- O gate offline final completa partida rápida **e Copa completa** sem rede.

---

## Task 1: 6A — schema, migrações e SaveRepository resiliente

**Files:**
- Create: `src/platform/save/SaveSchema.ts`
- Create: `src/platform/save/SaveSchema.test.ts`
- Create: `src/platform/save/SaveMigrations.ts`
- Create: `src/platform/save/SaveMigrations.test.ts`
- Create: `src/platform/save/SaveRepository.ts`
- Create: `src/platform/save/SaveRepository.test.ts`
- Modify: `src/core/audio/AudioSettings.ts`
- Modify: `src/main.ts`

**Public model:**

```ts
export interface ProVoleiSaveV1 {
  readonly version: 1;
  readonly preferences: Preferences;
  readonly cup: CupProgress;
  readonly stats: CareerStats;
  readonly unlocks: UnlockState;
}

export interface SaveRepository {
  snapshot(): Readonly<ProVoleiSaveV1>;
  update(recipe: (current: Readonly<ProVoleiSaveV1>) => ProVoleiSaveV1): Readonly<ProVoleiSaveV1>;
  resetProgress(): Readonly<ProVoleiSaveV1>; // preserva preferências
}
```

- [ ] **Step 1: escrever testes vermelhos do schema/defaults**

Cobrir defaults imutáveis: Normal, formato Oficial 2.0, áudio atual, HUD 100%, movimento do
sistema, captions/haptics ligados, timing normal, Copa no estágio 0, estatísticas zeradas e apenas
cosméticos base liberados/selecionados.

Run: `npx vitest run src/platform/save/SaveSchema.test.ts`
Expected: FAIL por módulo inexistente.

- [ ] **Step 2: implementar normalização total do schema**

Cada enum/ID/número é validado; arrays são deduplicados; seleção bloqueada cai no cosmético base;
objetos/arrays inesperados e `NaN` usam defaults. Retornos são cópias congeladas.

- [ ] **Step 3: escrever e implementar migrações puras**

Cobrir documento sem versão/versão 0, documento v1, versão futura, JSON corrompido e idempotência.
Versão futura incompatível é isolada e cai em defaults — nunca parcialmente interpretada.

Run: `npx vitest run src/platform/save/SaveMigrations.test.ts`
Expected: PASS.

- [ ] **Step 4: escrever testes vermelhos do repositório**

Usar storage fake para provar: load/save; falha no getter; `getItem`/`setItem` lançando; quota;
registro corrompido; update atômico; cópia imutável; `resetProgress` preserva preferências; e
migração única de `pro-volei.audio.v1` quando o save canônico ainda não existe.

- [ ] **Step 5: implementar SaveRepository com fallback em memória**

Chave: `pro-volei.save.v1`. O repositório mantém snapshot válido em memória mesmo se persistência
falhar. Migrar os quatro volumes do `AUDIO_SETTINGS_KEY`, sem apagar o legado antes de uma gravação
canônica bem-sucedida.

- [ ] **Step 6: integrar bootstrap e preferências de partida**

`main.ts` cria um repositório, inicializa `Menu.difficulty/format`, AudioEngine e HUD a partir do
snapshot e deixa de gravar o áudio numa segunda fonte após migração. Autostart touch usa as
preferências salvas.

- [ ] **Step 7: gates e commit**

Run: `npx vitest run src/platform/save src/core/audio/AudioSettings.test.ts`

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test`

```powershell
git add src/platform/save src/core/audio/AudioSettings.ts src/main.ts
git commit -m "feat(save): adiciona persistência versionada da fase 6a"
```

---

## Task 2: 6B — Copa curta e identidades táticas

**Files:**
- Create: `src/meta/cup/Cup.ts`
- Create: `src/meta/cup/Cup.test.ts`
- Create: `src/meta/cup/CupOpponents.ts`
- Create: `src/meta/cup/CupOpponents.test.ts`
- Create: `src/meta/cup/CupSession.ts`
- Create: `src/meta/cup/CupSession.test.ts`
- Modify: `src/game/strategy/StrategyTypes.ts`
- Modify: `src/game/strategy/OpponentBrain.ts`
- Modify: `src/game/strategy/OpponentBrain.test.ts`
- Modify: `src/game/strategy/MatchStrategyCoordinator.ts`
- Modify: `src/game/Match.ts`
- Modify: `src/ui/Menu.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Create: `tests/e2e/cup.spec.ts`

**Cup contract:**

```ts
export type CupRound = 'classificatoria' | 'quartas' | 'semifinal' | 'final';
export type TacticalIdentity = 'saque' | 'velocidade' | 'bloqueio' | 'leitura';
export interface CupOpponent {
  readonly id: string;
  readonly name: string;
  readonly round: CupRound;
  readonly difficulty: 0 | 1 | 2;
  readonly tactics: Readonly<StrategyBiasProfile>;
  readonly rewardId: string;
}
```

- [ ] **Step 1: testar a máquina pura da chave**

Quatro confrontos em ordem; derrota mantém índice e incrementa tentativas; vitória avança uma vez;
quarta vitória conclui; estado concluído é terminal; restart volta ao primeiro; dados inválidos
normalizam. Partida rápida não chama a máquina da Copa.

- [ ] **Step 2: definir quatro adversárias e perfis táticos**

Perfis só têm biases limitados para famílias/opções de saque, set e ataque. Progressão sugerida:
Normal/saque, Normal/velocidade, Difícil/bloqueio e Difícil/leitura. Nenhum perfil contém potência,
gravidade, velocidade de atleta, alcance, erro físico ou formato.

- [ ] **Step 3: integrar o viés na seleção estratégica por TDD**

Adicionar `tacticalProfile` opcional ao contexto. O default `balanced` reproduz exatamente os
snapshots atuais. Cada identidade muda probabilidades/escolha para uma observação fixa, mantendo
budget de RNG, opções canônicas, targets e validações. CPU continua usando a dificuldade existente.

Run: `npx vitest run src/game/strategy/OpponentBrain.test.ts src/game/strategy/MatchStrategyCoordinator.test.ts`

- [ ] **Step 4: implementar CupSession transacional**

`startCurrent()` devolve configuração do confronto; `recordResult()` persiste primeiro e só então
retorna `retry | next | champion`. Se a escrita cair para memória, a sessão ainda continua com o
snapshot válido. Repetir callback não duplica avanço/recompensa.

- [ ] **Step 5: adicionar Copa ao menu e composition root**

Título/portrait exibem `COPA`; painel mostra quatro rodadas, adversária, identidade, estado e
recompensa. `CONTINUAR COPA` inicia o confronto elegível no formato Oficial 2.0. No fim: derrota
oferece repetir; vitória touch landscape mostra resumo compacto e próxima partida; girar cancela
a contagem e abre a chave. Partida rápida permanece inalterada.

- [ ] **Step 6: E2E de progressão/reload/retry**

Em DEV, usar `forceMatchEnd` somente para validar UI e persistência: quatro vitórias avançam e
persistem após reload; derrota não avança; partida rápida não altera a Copa; champion é terminal.

Run: `npx playwright test tests/e2e/cup.spec.ts`

- [ ] **Step 7: gates, playtest e commit**

Run: `npm run check && npm run build && npm run test:e2e:smoke:prod`

Aplicar o skill `playtest` em desktop e touch 844×390, incluindo chave, um confronto e resumo.

```powershell
git add src/meta/cup src/game/strategy src/game/Match.ts src/ui/Menu.ts src/style.css src/main.ts tests/e2e/cup.spec.ts
git commit -m "feat(copa): entrega campanha curta da fase 6b"
```

---

## Task 3: 6C — recompensas e aplicação cosmética

**Files:**
- Create: `src/meta/cosmetics/CosmeticCatalog.ts`
- Create: `src/meta/cosmetics/CosmeticCatalog.test.ts`
- Create: `src/meta/cosmetics/CosmeticProgress.ts`
- Create: `src/meta/cosmetics/CosmeticProgress.test.ts`
- Modify: `src/entities/PlayerCharacter.ts`
- Modify: `src/entities/rig/RiggedCharacter.ts`
- Modify: `src/entities/rig/RiggedCharacter.test.ts`
- Modify: `src/game/Team.ts`
- Modify: `src/game/Team.test.ts`
- Modify: `src/world/Court.ts`
- Modify: `src/world/Arena.ts`
- Modify: `src/systems/Effects.ts`
- Modify: `src/ui/Menu.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Modify: `tests/e2e/cup.spec.ts`

- [ ] **Step 1: testar catálogo local e invariantes cosméticas**

Catálogo inclui bases e quatro recompensas: uniforme, paleta, quadra e efeito. IDs únicos,
fallbacks sempre presentes, nenhum URL remoto e nenhum campo/import de física, dificuldade,
timing, IA ou regras. Seleção só aceita IDs liberados.

- [ ] **Step 2: implementar unlock idempotente junto ao avanço da Copa**

Cada primeira vitória libera exatamente `rewardId`; retry/vitória repetida não duplica; reset de
progresso volta apenas aos bases; preferências gerais permanecem.

- [ ] **Step 3: criar portas de apresentação para aplicar seleção**

Adicionar `CharVisual.setUniform?`, implementado pelos personagens legado/rigado por atualização
de materiais; `Team.setUniform`; `Court.setTheme`; `Arena.setPalette`; `Effects.setTheme`.
Aplicação é visual e não recria simulação, não altera collider, movimento, salto ou bola.

- [ ] **Step 4: seletor de cosméticos no menu/portrait**

Exibir bloqueados com requisito, liberados como botões e seleção atual. Persistir imediatamente,
aplicar ao mundo e usar base se qualquer recurso falhar. Foco/aria informam bloqueio e seleção.

- [ ] **Step 5: provar ausência de vantagem e aplicação**

Testes com snapshots lógicos antes/depois preservam constantes, alcance e resultado físico.
E2E vence etapas, seleciona cada recompensa, recarrega e confirma classes/data attrs/materiais.

- [ ] **Step 6: gates, revisão visual e commit**

Run: `npx vitest run src/meta/cosmetics src/entities/rig/RiggedCharacter.test.ts src/game/Team.test.ts`

Playtest nos três tamanhos mobile e desktop; recompensas devem ser legíveis sem competir com bola.

```powershell
git add src/meta/cosmetics src/entities src/game/Team.ts src/game/Team.test.ts src/world src/systems/Effects.ts src/ui/Menu.ts src/style.css src/main.ts tests/e2e/cup.spec.ts
git commit -m "feat(cosmeticos): adiciona recompensas da copa"
```

---

## Task 4: 6D — opções e acessibilidade completas

**Files:**
- Create: `src/meta/preferences/AccessibilityPreferences.ts`
- Create: `src/meta/preferences/AccessibilityPreferences.test.ts`
- Create: `src/ui/MenuFocusNavigator.ts`
- Create: `src/ui/MenuFocusNavigator.test.ts`
- Modify: `src/game/feedback/TimingFeedback.ts`
- Modify: `src/game/feedback/TimingFeedback.test.ts`
- Modify: `src/game/control/HumanController.ts`
- Modify: `src/game/control/HumanController.test.ts`
- Modify: `src/game/Match.ts`
- Modify: `src/systems/camera/MotionProfile.ts`
- Modify: `src/systems/camera/MotionProfile.test.ts`
- Modify: `src/systems/CameraDirector.ts`
- Modify: `src/systems/CameraDirector.test.ts`
- Modify: `src/core/AudioEngine.ts`
- Modify: `src/systems/Haptics.ts`
- Modify: `src/ui/HUD.ts`
- Modify: `src/ui/Menu.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Create: `tests/e2e/options.spec.ts`
- Modify: `tests/e2e/offline.spec.ts`

**Preferences exposed:**

- cor: padrão, protan/deutan, tritan;
- contraste: padrão/alto;
- HUD: 85%, 100%, 115%;
- movimento reduzido; shake; slow-motion/replay;
- master, efeitos, torcida, música;
- captions; haptics;
- timing humano: normal/amplo — sem alterar CPU/física.

- [ ] **Step 1: testar normalização e aplicação de preferências**

Combinações inválidas caem em defaults; movimento reduzido vence shake/replay; preferência do
sistema também força perfil reduzido; timing amplo produz somente um `toleranceScale` humano.

- [ ] **Step 2: ampliar timing humano sem mudar física**

`evaluateTiming` recebe escala de tolerância opcional (default 1 preserva snapshots). A escala
altera apenas a queda de qualidade por erro; ideal, intenção, potência, target e CPU não mudam.
`HumanController` recebe/seta a escala; `Match` apenas delega.

- [ ] **Step 3: tornar câmera/feedback configuráveis**

`CameraDirector.setMotionPreferences` zera/ignora shake/FOV/orbit quando reduzido ou shake off.
`slowMo` no composition root respeita replay/slow-motion. `HUD.setScale`, `AudioEngine.applySettings`,
caption sink e `Haptics.setEnabled` são aplicados imediatamente e persistidos.

- [ ] **Step 4: presets de cor/contraste sem semântica só por cor**

Aplicar `data-color-preset`/`data-contrast` e variáveis CSS à UI, quadra, anéis e feedback. Forma,
texto, posse e seleção continuam redundantes. Presets passam contraste e não trocam cores de bola
e times a ponto de confundi-los.

- [ ] **Step 5: construir painel OPÇÕES e reset de progresso**

Disponível no título, pausa e portrait. Sliders/botões têm labels e valores; reset exige uma
confirmação inline, chama `resetProgress`, preserva opções e atualiza chave/cosméticos. Landscape
touch não abre o painel.

- [ ] **Step 6: navegação por foco**

Setas movem foco em ordem visual entre controles habilitados, Home/End vão aos extremos,
Espaço/Enter acionam o botão, Escape volta sem capturar gameplay; Tab continua nativo e foco nunca
fica em elemento removido. Usar `:focus-visible` de alto contraste.

- [ ] **Step 7: E2E de opções, persistência e Copa offline completa**

Validar teclado/touch, reload de cada preferência, captions/haptics on/off, HUD, reduced motion,
timing amplo e reset. Estender `offline.spec.ts`: instalação limpa → offline → quatro confrontos
CPU×CPU reais → champion, sem `forceMatchEnd`, com save/recompensas persistidos.

Run: `npx playwright test tests/e2e/options.spec.ts tests/e2e/cup.spec.ts`

Run: `npm run test:e2e:offline`

- [ ] **Step 8: gates finais, review e commit**

Run: `npm run check && npm run build`

Run: `npm run test:e2e && npm run test:e2e:smoke:prod && npm run test:e2e:offline`

Aplicar `playtest`, `requesting-code-review` e corrigir todos os Critical/Important.

```powershell
git add src/meta/preferences src/platform/save src/game src/systems src/core/AudioEngine.ts src/ui src/style.css src/main.ts tests/e2e
git commit -m "feat(acessibilidade): conclui opções da fase 6d"
```

---

## Phase 6 Definition of Done

- [ ] Save versionado/migrável cobre preferências, Copa, stats e unlocks com fallback seguro.
- [ ] Copa de quatro partidas retoma entre sessões, grava vitória antes da continuidade e repete
      o estágio na derrota.
- [ ] Quatro identidades táticas alteram escolhas estratégicas, nunca física.
- [ ] Partida rápida continua disponível e não altera progressão.
- [ ] Quatro recompensas cosméticas liberam/persistem/aplicam sem vantagem.
- [ ] Todas as opções do §8.3 funcionam e persistem; timing amplo é exclusivamente humano.
- [ ] Menus funcionam por teclado, touch e foco visível.
- [ ] Reset limpa progresso e preserva preferências.
- [ ] Partida rápida e Copa completa passam offline após instalação limpa.
- [ ] `npm run check`, build, E2E dev/prod/offline, playtest e revisão independente estão verdes.
