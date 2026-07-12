# Fase 2E — feedback de timing, câmera e game feel

> **Execução:** TDD, contratos neutros/pure solvers antes da integração, commits atômicos em
> `main`, revisão independente, matriz real de viewports e publicação comprovada no Pages.

**Objetivo:** fazer a gramática de um botão explicar imediatamente o resultado do timing e manter
bola, atleta controlada e destino legíveis em uma câmera de transmissão responsiva. Cor, forma,
som, haptic, FOV e shake compartilham eventos semânticos; nenhuma modalidade inventa feedback
paralelo.

**Não objetivos:** modelos/rigs/animações e pós-processamento (Fase 3), layout definitivo dos
polegares/orientação (Fase 5A), AudioMixer/scheduler/persistência (Fase 5D) ou replay.

## Contratos canônicos

- `TimingFeedbackEvent` é emitido uma vez por token/tick apenas para ação humana de contato.
- A mesma qualidade contínua `[0,1]` alimenta física e feedback: `perfect >= 0.85`,
  `good >= 0.55`, abaixo disso `off`; fase é `early | on-time | late`.
- Saque continua feedback de carga/técnica, sem sweet spot temporal artificial.
- Cue visual procedural dura 240/190/150 ms; forma + cor redundantes (teal/branco, amarelo, coral).
- Áudio de timing é imediato, ganho máximo 0,08 e não usa `setTimeout`; haptic é capability-only.
- Câmera recebe DTOs neutros de bola/controlada/destino/safe frame e não acessa DOM.
- Spike anticipation abre apenas nos 350 ms finais, dura no máximo 650 ms e sai até 180 ms depois.
- FOV base 55°, punch máximo +6°, release 220–300 ms; shake máximo 300 ms e orçamento projetado
  12 px desktop/8 px touch.
- `MotionProfile = full | reduced`; reduced zera shake/FOV/cortes/órbitas decorativas, preservando
  feedback estático.

## Arquitetura

```text
ActionIntent + contato/tick
          │
          ├── evaluateTiming (puro) ──► TimingFeedbackEvent
          │                                  │
          │                                  ▼
          │                         PresentationFeedbackPort
          │                         ├─ Effects.timingCue
          │                         ├─ AudioEngine.timingCue
          │                         └─ HapticsPort
          │
Match camera snapshot + SafeFrame
          │
          ▼
 solveBroadcastFrame (puro) ──► CameraDirector envelopes full/reduced
```

## Tarefa 1 — timing único e evento semântico

1. Criar `game/feedback/TimingFeedback.ts` com contexto, tier, fase, erro em ticks e posição DTO.
2. Extrair a fórmula hoje embutida no `HumanController`; eliminar drift com `timing.ts` legado.
3. Adicionar `TIMING_FEEDBACK` centralizado e testar fronteiras 0,85/0,55, clamp, cedo/tarde.
4. Fazer `HumanController` produzir exatamente o mesmo quality para mecânica e evento.
5. Dedupe por `(token, simulationTick)`; cancelamento/token novo/IA/saque não emitem.

## Tarefa 2 — port e fan-out sincronizado

1. Introduzir `FeedbackPort.emit(event)` em `MechanicsCtx`/composition root sem expor DOM.
2. O mesmo objeto é entregue sincronicamente a Effects, Audio e Haptics uma vez.
3. `Effects.timingCue` cria glyph procedural transitório separado de partículas de impacto.
4. `AudioEngine.timingCue` usa tons/noise imediatos, seguro antes de init e quando desabilitado.
5. `HapticsPort` mapeia perfect `[20,30,20]`, good `[15]`, off `[10]`; ausência/rejeição é no-op.

## Tarefa 3 — framing puro e safe frame

1. Criar DTO `CameraFrame` com bola, controlada opcional, destino opcional, bounds/fase/contactIn.
2. Criar `SafeFrame` com viewport, insets e retângulos de overlays; leitura DOM fica em `main/ui` e
   só recalcula em resize/visibilidade/layout, nunca por frame estável.
3. Implementar `solveBroadcastFrame` puro com dead zone e prioridade bola+controlada; destino pode
   degradar quando três sujeitos não cabem.
4. Cobrir 1920×1080, 1280×800, 844×390, 667×375, 568×320 e tablet.
5. Aceite determinístico: obrigatórios dentro do safe frame em >=99%, destino >=95%, margem 12 px.

## Tarefa 4 — CameraDirector e envelopes

1. Trocar números internos por `CAMERA_FEEL` e aceitar `CameraFrame`, `SafeFrame`, `MotionProfile`.
2. Spike cam só nos últimos 350 ms; sem corte durante rally e com saída limitada após contato/erro.
3. FOV usa envelope attack/release com cap +6°; projeção só atualiza acima de epsilon 0,01°.
4. Shake usa fase avançada por `dt`, não `performance.now`, com retrigger/cap/duração testados.
5. Reduced zera shake/FOV/órbita/cortes decorativos e CSS respeita `prefers-reduced-motion`.
6. Base de input continua derivada da câmera efetivamente apresentada e nunca inverte transições.

## Tarefa 5 — integração e feedback funcional

1. Match publica controlada/destino sem expor `HumanController`; presentation snapshot é readonly.
2. Passe/set/ataque/bloqueio emitem tier no contato; impactos físicos existentes não duplicam cue.
3. Marker continua indicando buffer/carga; glyph transitório indica resultado do timing.
4. Touch recebe haptic somente quando primário/capaz; desktop mantém visual+áudio equivalentes.
5. Expor `__feedback` e `__cameraFrame` readonly em debug para E2E, nunca para mutar gameplay.

## Tarefa 6 — E2E, revisão e publicação

1. Cenários DEV determinísticos plantam perfect/good/off e spike full/reduced.
2. E2E mede sujeitos/overlays geometricamente nos seis viewports; screenshot é evidência, não gate
   de pixel WebGL.
3. Segurar direita durante transição comprova deslocamento projetado coerente.
4. Pausa/cancelamento não deixam cue, shake ou zoom fantasma; performance não adiciona draw calls.
5. Agentes independentes revisam feedback, câmera/safe frame e UX/performance.
6. Rodar `npm run check`, build, E2E completo, smoke do `dist` e playtest desktop/mobile.
7. Commit/push direto em `main`, acompanhar Actions/Pages e repetir smoke público.

## Gate final

- [ ] Física e feedback usam a mesma qualidade/tier determinística.
- [ ] Evento é emitido uma vez e fan-out não duplica impacto físico.
- [ ] Cue diferencia perfect/good/off por forma, cor, som e haptic opcional.
- [ ] Bola e controlada permanecem no safe frame; destino degrada de modo previsível.
- [ ] Spike/FOV/shake obedecem janelas, caps e `dt` determinístico.
- [ ] Reduced motion zera movimento decorativo sem ocultar feedback.
- [ ] Input relativo à tela permanece coerente durante todas as transições.
- [ ] Testes, matriz E2E, playtest, review, CI, Pages e smoke público estão verdes.
- [ ] Remoto continua literalmente somente `main`.
