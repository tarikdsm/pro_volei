# Fase 5 — Mobile, áudio e PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concluir 5B–5E com controles multitouch no layout dos polegares, HUD compacto,
mixer/haptics configuráveis e PWA inteiramente jogável offline.

**Architecture:** UI e plataforma continuam fora de `game/`. Layout e hit-testing ficam em
`ui/`, preferências de áudio entram por um contrato puro, e o service worker trata somente o app
shell versionado produzido pelo Vite. O `main.ts` permanece coordenador e recebe módulos pequenos
em vez de novas regras de domínio.

**Tech Stack:** TypeScript strict, DOM/CSS, Web Audio API, Vite 8, Vitest 4, Playwright 1.61.

**Status:** Concluído em 19/07/2026. Evidências finais: `npm run check` com 1.017 testes,
21 E2E de desenvolvimento, smoke do build, jornada de instalação/reload/partida offline e
playtest real desktop + 844×390 sem erros de console. Bundle principal: 212,52 kB gzip.

## Global Constraints

- Runtime 100% offline e zero URLs remotas.
- Joystick no terço direito; zona de ação no terço esquerdo; centro, rede, bola e placar livres.
- Sem botão de pausa em touch landscape; portrait é o único gate de pausa mobile.
- Viewports obrigatórios: 568×320, 667×375, 844×390 e tablet.
- Um mesmo evento de gameplay alimenta feedback visual, áudio e haptics.
- Cache PWA nunca mistura assets de duas versões.
- Não aumentar `Match.ts`; `game/` não importa DOM, storage, áudio ou service worker.
- Cada tarefa termina verde e jogável antes da próxima.

---

### Task 1: 5B — zonas multitouch e joystick flutuante

**Files:**
- Create: `src/ui/TouchLayout.ts`
- Create: `src/ui/TouchLayout.test.ts`
- Modify: `src/ui/TouchControls.ts`
- Modify: `src/ui/TouchControls.a11y.spec.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Modify: `tests/e2e/touch.spec.ts`

**Interfaces:**
- Produces: `solveTouchLayout(viewport, insets): TouchLayout` com retângulos readonly de ação e
  movimento; `TouchControls` usa zonas full-height nas bordas e move a base visual do joystick para
  o primeiro toque do ponteiro de movimento.
- Consumes: `InputSink.setMove`, `InputSink.setAction` e cancelamentos existentes.

- [ ] **Step 1: escrever os testes puros vermelhos de layout**

```ts
expect(solveTouchLayout({ width: 568, height: 320 }, ZERO_INSETS)).toMatchObject({
  action: { x: 0, width: 189 },
  movement: { x: 379, width: 189 },
});
expect(overlapsCenter(result, { x: 189, y: 0, width: 190, height: 320 })).toBe(false);
```

- [ ] **Step 2: executar o teste e confirmar `solveTouchLayout` inexistente**

Run: `npx vitest run src/ui/TouchLayout.test.ts`
Expected: FAIL por módulo/export inexistente.

- [ ] **Step 3: implementar o solver puro**

```ts
export interface TouchLayout {
  readonly action: Readonly<ScreenRect>;
  readonly movement: Readonly<ScreenRect>;
  readonly stickRadius: number;
}

export function solveTouchLayout(viewport: ViewportSize, insets: SafeInsets): TouchLayout {
  const third = Math.floor(viewport.width / 3);
  return Object.freeze({
    action: Object.freeze({ x: insets.left, y: insets.top, width: third - insets.left, height: viewport.height - insets.top - insets.bottom }),
    movement: Object.freeze({ x: viewport.width - third, y: insets.top, width: third - insets.right, height: viewport.height - insets.top - insets.bottom }),
    stickRadius: Math.max(36, Math.min(52, viewport.height * 0.14)),
  });
}
```

- [ ] **Step 4: trocar o DOM por duas zonas independentes e remover `tc-pause`**

```html
<div id="tc-action-zone"><div id="tc-action" role="button">🏐</div></div>
<div id="tc-move-zone"><div id="tc-stick"><div id="tc-knob"></div></div></div>
```

No `pointerdown` de movimento, posicionar `#tc-stick` no ponto inicial limitado à zona segura;
o ponteiro de ação pertence somente à zona esquerda. `pointercancel`, `lostpointercapture`, blur,
portrait e ocultação continuam zerando ambos os canais atomicamente.

- [ ] **Step 5: atualizar CSS e safe frame**

Aplicar `pointer-events:auto` somente às zonas laterais, manter o centro sem overlay, inverter as
posições visuais e remover `#tc-pause` de `cameraOverlaySelectors`.

- [ ] **Step 6: provar hit-testing e dois ponteiros nos quatro viewports**

Run: `npx playwright test tests/e2e/touch.spec.ts`
Expected: PASS com ação à esquerda, movimento à direita, centro retornando `document.body`/canvas,
dois ponteiros simultâneos e cancelamento sem edge fantasma.

- [ ] **Step 7: rodar gates da fatia**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test`
Expected: PASS.

- [ ] **Step 8: commit atômico**

```powershell
git add src/ui/TouchLayout.ts src/ui/TouchLayout.test.ts src/ui/TouchControls.ts src/ui/TouchControls.a11y.spec.ts src/style.css src/main.ts tests/e2e/touch.spec.ts
git commit -m "feat(ui): conclui layout multitouch da fase 5b"
```

### Task 2: 5C — placar esportivo compacto e dicas transitórias

**Files:**
- Create: `src/ui/HudPreferences.ts`
- Create: `src/ui/HudPreferences.test.ts`
- Modify: `src/ui/HUD.ts`
- Modify: `src/ui/HUD.a11y.spec.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Modify: `tests/e2e/camera.spec.ts`

**Interfaces:**
- Produces: `HUD.setScale(scale: 0.85 | 1 | 1.15): void` e dicas com expiração; o placar mantém
  `score-main`, `score-sets`, `serve-home` e `serve-away` para compatibilidade dos hooks.
- Consumes: os hooks `setScore`, `hint`, `serveMeter`, `zoneHint` existentes.

- [ ] **Step 1: escrever teste vermelho da política de dica**

```ts
const state = reduceHint({ text: '', remaining: 0 }, { type: 'show', text: 'Receba', seconds: 2.5 });
expect(reduceHint(state, { type: 'tick', dt: 2.6 })).toEqual({ text: '', remaining: 0 });
```

- [ ] **Step 2: implementar reducer puro e integrar ao HUD**

```ts
export type HudScale = 0.85 | 1 | 1.15;
export interface HintState { readonly text: string; readonly remaining: number }
export type HintEvent =
  | { readonly type: 'show'; readonly text: string; readonly seconds: number }
  | { readonly type: 'tick'; readonly dt: number };
export function reduceHint(state: HintState, event: HintEvent): HintState {
  if (event.type === 'show') {
    return { text: event.text, remaining: event.text ? Math.max(0, event.seconds) : 0 };
  }
  const remaining = Math.max(0, state.remaining - Math.max(0, event.dt));
  return remaining === 0 ? { text: '', remaining: 0 } : { ...state, remaining };
}
```

`HUD.hint()` passa a mostrar copy curta por 2,5 s; `HUD.update()` a remove. Não existe instrução
permanente durante rally.

- [ ] **Step 3: compactar placar e elementos transitórios**

Usar faixa única com nomes, sets, pontos e posse; altura máxima de 54 px em 568×320; medidor e
zonas ficam abaixo do placar/área central sem encobrir controles.

- [ ] **Step 4: validar acessibilidade, safe frame e viewports**

Run: `npx vitest run src/ui/HudPreferences.test.ts src/ui/HUD.a11y.spec.ts src/ui/SafeFrameLayout.test.ts`
Expected: PASS.

Run: `npx playwright test tests/e2e/camera.spec.ts tests/e2e/touch.spec.ts`
Expected: PASS e nenhum overlay intersecta a região central protegida.

- [ ] **Step 5: commit atômico**

```powershell
git add src/ui/HudPreferences.ts src/ui/HudPreferences.test.ts src/ui/HUD.ts src/ui/HUD.a11y.spec.ts src/style.css src/main.ts tests/e2e/camera.spec.ts
git commit -m "feat(ui): conclui hud compacto da fase 5c"
```

### Task 3: 5D — mixer, scheduler e haptics opcionais

**Files:**
- Create: `src/core/audio/AudioSettings.ts`
- Create: `src/core/audio/AudioSettings.test.ts`
- Create: `src/core/audio/AudioScheduler.ts`
- Create: `src/core/audio/AudioScheduler.test.ts`
- Modify: `src/core/AudioEngine.ts`
- Modify: `src/core/AudioEngine.test.ts`
- Modify: `src/systems/Haptics.ts`
- Modify: `src/systems/Haptics.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `AudioSettings { master, effects, crowd, music }`, `AudioEngine.applySettings`,
  `AudioEngine.setCaptionSink`, `Haptics.setEnabled`; scheduler usa `AudioContext.currentTime`.
- Consumes: `PresentationFeedback` síncrono e os métodos de `AudioPort` existentes.

- [ ] **Step 1: escrever testes vermelhos de normalização e agenda**

```ts
expect(normalizeAudioSettings({ master: 2, effects: -1, crowd: 0.4, music: NaN })).toEqual({
  master: 1, effects: 0, crowd: 0.4, music: DEFAULT_AUDIO_SETTINGS.music,
});
expect(scheduleSequence(10, [0, 0.1, 0.25])).toEqual([10, 10.1, 10.25]);
```

- [ ] **Step 2: implementar settings puros e scheduler sem timers DOM**

```ts
export interface AudioSettings { readonly master: number; readonly effects: number; readonly crowd: number; readonly music: number }
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = Object.freeze({ master: 0.7, effects: 1, crowd: 0.6, music: 0.55 });
export const scheduleSequence = (now: number, offsets: readonly number[]) => offsets.map((offset) => now + Math.max(0, offset));
```

- [ ] **Step 3: montar o grafo do mixer**

Criar `DynamicsCompressorNode` como limitador e gains `master`, `effects`, `crowd`, `music`.
Impactos usam `StereoPannerNode` quando disponível; crowd conecta apenas ao canal crowd; jingles
e fanfarra conectam ao music. Substituir todos os `setTimeout` por `start(when)`/automations.

- [ ] **Step 4: tornar haptics e legendas configuráveis**

```ts
class Haptics {
  setEnabled(enabled: boolean): void;
  timingCue(event: Readonly<TimingFeedbackEvent>): void;
}
```

Falhas de `navigator.vibrate` permanecem absorvidas. O caption sink recebe rótulos curtos como
`Apito`, `Defesa`, `Bloqueio` e `Ponto` no mesmo despacho que áudio/efeito.

- [ ] **Step 5: verificar áudio/haptics e ausência de timers**

Run: `npx vitest run src/core/audio src/core/AudioEngine.test.ts src/systems/Haptics.test.ts src/systems/PresentationFeedback.test.ts`
Expected: PASS.

Run: `rg -n "setTimeout" src/core/AudioEngine.ts`
Expected: nenhuma ocorrência.

- [ ] **Step 6: commit atômico**

```powershell
git add src/core/audio src/core/AudioEngine.ts src/core/AudioEngine.test.ts src/systems/Haptics.ts src/systems/Haptics.test.ts src/main.ts
git commit -m "feat(audio): conclui mixer e haptics da fase 5d"
```

### Task 4: 5E — PWA versionada, loading e aceite offline

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icons/icon.svg`
- Create: `public/sw.js`
- Create: `src/platform/PwaCoordinator.ts`
- Create: `src/platform/PwaCoordinator.test.ts`
- Create: `tests/e2e/offline.spec.ts`
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `vite.config.ts`
- Modify: `playwright.preview.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `registerPwa({ canActivate, onUpdateReady, onOfflineReady })`; SW usa prefixo
  `pro-volei-v2-` e manifesto de URLs gerado no build.
- Consumes: estado do app para ativar atualização apenas em título/portrait/fim.

- [ ] **Step 1: escrever testes vermelhos da política de ativação**

```ts
expect(canActivateUpdate({ appState: 'playing', portrait: false })).toBe(false);
expect(canActivateUpdate({ appState: 'ended', portrait: false })).toBe(true);
expect(canActivateUpdate({ appState: 'playing', portrait: true })).toBe(true);
```

- [ ] **Step 2: adicionar manifest e metadados locais**

Manifest: `name`/`short_name` Pró Volei, `display: fullscreen`, `orientation: landscape`,
`start_url: ./`, `scope: ./`, tema navy e ícone SVG local. `index.html` referencia somente URLs
relativas e mostra shell de loading com `role=status` antes do módulo.

- [ ] **Step 3: gerar service worker com lista do `dist`**

No plugin Vite `closeBundle`, enumerar os arquivos de `dist`, gravar `sw.js` com cache imutável
por `package.json.version` + hash da lista, instalar tudo antes de sinalizar offline-ready, apagar
caches antigos no activate e servir cache-first somente para requests same-origin GET.

- [ ] **Step 4: integrar registro e recuperação**

Registrar apenas em produção; update aguardando envia `SKIP_WAITING` só quando
`canActivateUpdate` for verdadeiro. Falha de registro não bloqueia bootstrap. O loading desaparece
depois do primeiro frame renderizado.

- [ ] **Step 5: provar offline com cache limpo**

```ts
test('app shell e partida rápida recarregam offline', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible();
});
```

Run: `npm run build && npx playwright test --config=playwright.preview.config.ts tests/e2e/offline.spec.ts`
Expected: PASS para bootstrap, partida rápida e assets após reload offline.

- [ ] **Step 6: auditar runtime remoto e bundle**

Run: `npx vitest run tests/docs/no-remote-assets.test.ts && npm run build`
Expected: PASS; JS inicial gzip ≤ 250 kB e payload inicial ≤ 10 MB.

- [ ] **Step 7: gate e playtest da Fase 5**

Run: `npm run check && npm run build && npm run test:e2e && npm run test:e2e:smoke:prod`
Expected: todos verdes.

Executar a skill `playtest` em desktop e touch 568×320/844×390; capturar menu, rally e offline,
com console sem erros.

- [ ] **Step 8: commit atômico e documentação**

```powershell
git add public src/platform index.html src/main.ts src/style.css vite.config.ts playwright.preview.config.ts package.json package-lock.json tests/e2e/offline.spec.ts docs/ROADMAP.md docs/superpowers/plans/README.md CHANGELOG.md CLAUDE.md
git commit -m "feat(pwa): conclui fase 5 com aceite offline"
```
