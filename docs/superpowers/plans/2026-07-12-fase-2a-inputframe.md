# Fase 2A — InputFrame semântico e paridade de controles

> **Execução:** TDD, commits pequenos diretamente em `main`, revisão independente e jogo
> publicável ao fim de cada tarefa.

**Objetivo:** substituir o estado de teclas por frame por uma entrada semântica determinística,
com setas + Espaço no PC e joystick + ação no touch, direções relativas à câmera, bordas
timestamped e cancelamento explícito. Esta fase preserva as mecânicas atuais; tap/hold contextual,
seleção automática e fixed timestep entram nas fases 2D, 2C e 2B.

**Arquitetura:** adaptadores de teclado e touch escrevem eventos em um `InputHub` puro. Cada tick
consome os eventos elegíveis uma única vez e recebe `InputFrame` em espaço de tela. O composition
root converte esse vetor para o plano da quadra usando um snapshot neutro da câmera e entrega
`ControlFrame` ao `Match`. Escape/pausa permanece um comando de aplicação, fora do gameplay.

```text
teclado ─┐
         ├─ InputHub.consumeUntil() ─ InputFrame ─ CameraSpaceMapper ─ ControlFrame ─ Match
touch ───┘

Escape / botão pausa ─────────────────────────────── AppCoordinator
```

## Regras invariantes

- Gameplay do teclado aceita somente `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` e `Space`.
- WASD não movimenta, não escolhe zona e não é usado internamente pelo touch.
- Press e release ocorridos entre dois ticks permanecem na fila, ordenados por timestamp/sequência.
- Cancelamento limpa fontes sem fabricar release; blur/pausa nunca executam uma carga.
- A ação composta é OR: soltar teclado não gera release se o touch continua pressionado.
- A fonte de movimento não soma com outra; vence a fonte ativa mais recentemente alterada.
- `game/` não importa DOM, eventos, `Input` concreto, `CameraDirector` ou Three.js para mapear input.
- Diagonais e base da câmera são normalizadas; saída nunca excede módulo 1.
- O botão de pausa touch permanece nesta fase; será removido atomicamente com o portrait gate na 5A.

## Tarefa 1 — Definir o contrato e a fila pura

**Arquivos:**

- Criar: `src/core/input/InputFrame.ts`
- Criar: `src/core/input/InputHub.ts`
- Criar: `src/core/input/InputHub.test.ts`

1. Escrever testes RED para múltiplas bordas no mesmo tick, ordenação, auto-repeat sem duplicação,
   arbitragem de fontes, ação composta, diagonal normalizada e consumo exatamente uma vez.
2. Testar cancelamento separado de release e limpeza de todas as fontes.
3. Implementar tipos imutáveis `ScreenAxis`, `ActionEdge`, `InputCancellation`, `InputFrame`,
   `InputSource` e a interface `InputSink`.
4. Implementar uma fila monotônica com desempate por sequência, estado consumido por fonte e
   `consumeUntil(atMs)`.
5. Rodar teste focado, typecheck, lint e format check. Esperado: GREEN.

## Tarefa 2 — Mapear direções pela câmera

**Arquivos:**

- Criar: `src/core/input/CameraSpaceMapper.ts`
- Criar: `src/core/input/CameraSpaceMapper.test.ts`
- Modificar: `src/systems/CameraDirector.ts`
- Modificar: `src/systems/CameraDirector.test.ts`

1. Escrever testes RED para bases broadcast/saque, diagonais, módulo máximo, revisão monotônica e
   fallback da última base quando a projeção horizontal for degenerada.
2. Implementar `CameraGroundBasis`, `CourtAxis` e mapper puro, sem dependência de Three.js.
3. Expor `CameraDirector.inputBasis()` como snapshot plano calculado pelos eixos locais da câmera
   projetados em XZ.
4. Confirmar que pressionar direita/cima sempre acompanha direita/cima da imagem renderizada.
5. Rodar testes focados e checks estáticos. Esperado: GREEN.

## Tarefa 3 — Migrar teclado e touch para o mesmo hub

**Arquivos:**

- Modificar: `src/core/Input.ts`
- Remover: `src/core/KeyState.ts`
- Substituir: `src/core/KeyState.test.ts` por `src/core/Input.test.ts`
- Modificar: `src/ui/TouchControls.ts`
- Modificar: `src/ui/TouchControls.a11y.spec.ts`
- Substituir: `src/ui/touchMapping.ts` e `src/ui/touchMapping.test.ts` por eixo analógico puro

1. Testar RED que só setas/Espaço entram no hub; WASD e Escape ficam fora do frame semântico.
2. Migrar listeners de teclado para escrever no `InputHub`, ignorar auto-repeat e cancelar no blur.
3. Migrar joystick para `ScreenAxis` analógico com deadzone radial; remover `KeyboardEvent` sintético
   e dependência do modo de câmera.
4. Migrar ação touch para `InputSink`, com ownership de `pointerId`, pointer capture e cancelamento
   seguro em `pointercancel`/`lostpointercapture`.
5. Fazer a pausa touch chamar um callback de aplicação, nunca sintetizar Escape.
6. Preservar nesta fase a posição visual atual dos controles e sua disponibilidade durante partida.
7. Rodar testes focados, typecheck, lint e format check. Esperado: GREEN.

## Tarefa 4 — Entregar ControlFrame ao gameplay

**Arquivos:**

- Criar: `src/game/control/ControlFrame.ts`
- Modificar: `src/game/control/HumanController.ts`
- Modificar: `src/game/control/HumanController.test.ts`
- Modificar: `src/game/Match.ts`
- Modificar: `src/main.ts`
- Modificar: `src/ui/HUD.ts`
- Modificar: `src/ui/HUD.a11y.spec.ts`

1. Escrever testes RED para movimento camera-relative, press+release no mesmo frame e cancelamento
   de saque sem execução.
2. Trocar consultas a códigos concretos em `HumanController` por `ControlFrame`.
3. Substituir a seleção A/W/D transitória pela direção lateral do frame; neutro preserva a escolha
   recomendada atual até a máquina contextual da 2D.
4. Atualizar hints para setas + Espaço e remover zonas tocáveis que sintetizam A/W/D.
5. Manter `Match.update` como delegação curta e mapear câmera no `main.ts`.
6. Centralizar pausa para cancelar o input e o saque carregado de forma idempotente.
7. Remover `endFrame()` e qualquer import de `Input` dentro de `game/`.
8. Rodar testes focados, suite completa e build. Esperado: GREEN.

## Tarefa 5 — Verificação real, revisão e publicação

**Arquivos:**

- Modificar: `tests/e2e/touch.spec.ts`
- Modificar: `tests/e2e/smoke.spec.ts`
- Modificar: `CHANGELOG.md`
- Modificar: `docs/ROADMAP.md`

1. Adicionar E2E de setas + Espaço e teste negativo de WASD.
2. Exercitar touch por hit-testing real, incluindo joystick + ação simultâneos e soltura fora da
   superfície; não usar eventos sintéticos como prova principal.
3. Executar playtest visual desktop e mobile landscape no build de produção; exigir zero erro de
   console e ausência de input preso.
4. Rodar agente independente de code review; corrigir findings válidos e repetir os gates.
5. Atualizar changelog/roadmap com o que foi efetivamente entregue, commit atômico, push para
   `main`, acompanhar Actions/Pages e repetir smoke público com cache-busting.

## Gate final

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run test:e2e
npm run test:e2e:smoke:prod
git status --short
```

- [x] Nenhum fluxo de gameplay depende de WASD ou `KeyboardEvent` sintético.
- [x] Teclado e touch produzem o mesmo `InputFrame` sem releases falsos.
- [x] Press+release rápido sobrevive a frames lentos e é consumido uma vez.
- [x] Blur/pausa cancela a ação sem executar saque, passe, salto ou bloqueio.
- [x] Movimento acompanha os eixos visuais da câmera atual.
- [x] Desktop e mobile landscape continuam jogáveis no build publicado.
- [x] Branch remota continua sendo somente `main`.

## Evidência local antes da publicação

- Implementação: `81f39e9`, `4e03b8d` e `b6ee1ce`.
- Revisão independente: três findings corrigidos em `ce7f092`; smoke do build corrigido em
  `d94809b` após reproduzir a diferença DEV/produção.
- `npm run check`: 41 arquivos, 310 testes; cobertura de 38,52% statements, 44,16% branches,
  40,26% functions e 38,47% lines.
- Build: 609,23 kB JavaScript, 157,53 kB gzip.
- Playwright: 9/9 cenários completos e smoke Chromium do `dist` aprovado.
- Playtest real: menu, saque, rally, setas/Espaço e mobile landscape sem erros de console; único
  warning é a depreciação já conhecida de `PCFSoftShadowMap` no Three.js.
- Publicação: run `29204014194`, SHA `2714264`, deployment `5415090698`; Actions/Pages verdes,
  HTTPS/workflow preservados e smoke público desktop + multitouch landscape aprovados.
