# Fase 2D — máquina contextual de um botão

> **Execução:** TDD, núcleo puro antes da integração, commits atômicos em `main`, revisão
> independente, playtest teclado/touch e publicação comprovada no Pages.

**Objetivo:** transformar Espaço/toque em uma gramática única, previsível e divertida para saque,
recepção, levantamento, ataque, bloqueio e bola quebrada. Tap oferece a opção segura/rápida; hold
oferece potência ou alcance progressivo com risco de timing. O contexto escolhe a técnica, mas a
direção, a duração e o instante continuam sob controle do usuário.

**Não objetivos:** refazer animações/arte (Fase 3), IA coletiva (Fase 4), gate portrait completo
(Fase 5A) ou formato 11/11/7 (fase de balanceamento). Esta fase deixa os contratos prontos para
essas entregas sem expandir `Match.ts` com outra máquina ad hoc.

## Contrato canônico

- Simulação a 60 Hz; limiares pertencem ao relógio simulado, não a `performance.now()`.
- `tapTicks = 12`: release antes do tick 12 é tap; a partir do tick 12 é hold.
- `bufferTicks = 9`: press até 150 ms antes da janela legal é consumido no primeiro tick legal.
- `fullChargeTicks = 30`: após entrar em `charging`, a carga chega linearmente a 1 em 500 ms.
- Direção deliberada exige magnitude 0,35; a última direção deliberada vem do tick de resolução e
  direção neutra escolhe o alvo seguro recomendado.
- Rally usa `planId` como token. Saque usa token monotônico próprio. Troca de atleta dentro do mesmo
  plano preserva a ação; troca de token cancela sem executar.
- Cancelamentos `pause`, `blur`, `portrait`, `point-end`, `plan-changed`, `stall` e
  `pointer-cancel` limpam press/carga/buffer sem fabricar release.
- Release resolve uma intenção uma única vez. Contato compatível durante hold resolve com a carga
  atual e ignora o release posterior.
- Existe no máximo um gesto consumido por token. Release e contato no mesmo tick resolvem input
  primeiro. Cancelamento do `InputHub` invalida o ownership atual; somente um novo edge de press
  rearma (teclado/touch exigem release físico antes de conseguirem gerar esse novo press).
- `locked-illegal` cancela explicitamente; não transfere intenção nem produz defesa milagrosa.

## Matriz semântica

| Contexto | Tap | Hold | Risco/agência |
|---|---|---|---|
| Saque | `float-serve` seguro | `power-serve` progressivo | força aumenta erro e reduz folga |
| Recepção | `platform-pass` estável | `emergency-dive` | mais alcance, menor precisão |
| Levantamento | `high-set` seguro | `quick-set` | mais rápido e exigente |
| Ataque | neutro `tip`; direcionado `placed-shot` | `power-spike` | potência cresce; timing ruim amplia erro |
| Bloqueio | `quick-block` | `penetrating-block` | mais penetração, mas salto mais tardio |
| Bola quebrada | `safe-save` | `reaching-freeball` | mais alcance e chance de mandar à rival |

## Arquitetura

```text
InputFrame + simulationTick + contexto legal
                    │
                    ▼
          ActionButtonMachine (pura)
          idle / pressed / charging / buffered
                    │ gesto one-shot
                    ▼
             ActionResolver (puro)
       técnica + carga + direção + token + causa
                    │
                    ▼
 HumanController (adaptação) ── contato analítico
                    │
                    ▼
 serve/touch/block mechanics (física e feedback)
```

## Tarefa 1 — tipos, tuning e máquina temporal pura

1. Criar `ActionIntent.ts` com `ActionContext`, `ActionGesture`, `ActionTechnique`, direção plana,
   token e causa de resolução.
2. Adicionar `ACTION_BUTTON` aos constants com os três limiares canônicos.
3. Criar `ActionButtonMachine.ts` sem Three.js, DOM, RNG ou efeitos.
4. Reordenar edges/cancelamentos por `(atMs, sequence)` antes de processar o tick.
5. TDD das fronteiras 11/12 e 9/10 ticks, press/release no mesmo tick, carga monotônica,
   resolução no contato, token novo e todos os cancelamentos.

## Tarefa 2 — resolvedor contextual puro

1. Criar `ActionResolver.ts` como tabela exaustiva contexto × gesto.
2. Normalizar carga e direção; neutro preserva default seguro.
3. Produzir parâmetros semânticos contínuos (`power`, `reach`, `precision`, `penetration`) sem RNG.
4. Cobrir a matriz inteira com `it.each`, incluindo contexto incompatível e DTO imutável.
5. Provar que o mesmo input semântico de teclado/touch produz intenção idêntica.

## Tarefa 3 — invariância no fixed timestep e lifecycle

1. Acrescentar `simulationTick` ao `ControlFrame` na fronteira de `main.ts`.
2. Testar `InputHub + FixedStepRunner + ActionButtonMachine` a render 30/60/120 Hz.
3. Provar que pausa não carrega, `wall-cap` cancela somente a ação e `step-cap` preserva bordas.
4. Generalizar `cancelPendingAction(reason)` em `HumanController`/`Match`.
5. Cancelar explicitamente no fim do ponto e em mudança de token; manter o contrato `portrait`
   pronto para a Fase 5A.

## Tarefa 4 — integração no HumanController e contato

1. Substituir estados paralelos de saque/timing/pulo pela máquina única, preservando AutoSelector.
2. Adicionar modo de levantamento humano; a atleta e a zona continuam definidas pelo plano.
3. Derivar janela legal por contexto e expor um snapshot readonly `__action` em DEV.
4. Usar timing canônico contínuo: recepção/set/freeball ideal 5 ticks antes do contato, ataque 16
   ticks e bloqueio 19 ticks; no ataque/bloqueio, iniciar preparação/salto no momento legal.
5. Fazer `attemptContact` consumir intenção compatível; hold ativo resolve no contato sem `keyup`.
6. Garantir consumo exatamente uma vez e que troca de atleta no mesmo `planId` não perde carga.

## Tarefa 5 — mecânicas e game feel funcional

1. `serve.ts`: float seguro e power progressivo, direção controlando alvo/profundidade.
2. `touch.ts`: plataforma/mergulho, levantamento alto/rápido, ataque colocado/potente e freeball.
3. `block.ts`: bloqueio rápido/penetrante por alcance e penetração, sem chance binária na intenção.
4. Manter variação física existente fora do resolvedor e controlar RNG nos testes das mecânicas.
5. Expor estado por forma/cor no marker/medidor existente, sem texto modal durante gameplay.

## Tarefa 6 — E2E, revisão e publicação

1. Criar cenário DEV determinístico com token conhecido para tap, hold, buffer e cancelamento.
2. E2E desktop usa tap atômico e hold de 400–500 ms; asserts exatos ficam no Vitest.
3. E2E mobile repete por pointer/touch real enquanto o outro dedo move o joystick.
4. Pausar no meio do hold e trocar token provam cancelamento sem disparo fantasma.
5. Agentes independentes revisam máquina/resolvedor, integração/mecânicas e UX touch.
6. Rodar `npm run check`, build, E2E completo, smoke do `dist` e playtest desktop/mobile.
7. Commit/push direto em `main`, acompanhar Actions/Pages e repetir smoke público.

## Gate final

- [x] Tap/hold respeitam exatamente 12 ticks e carga plena em mais 30 ticks.
- [x] Buffer aceita até 9 ticks e executa somente no primeiro tick legal.
- [x] Cada contexto produz técnicas distintas, contínuas e semanticamente testadas.
- [x] Contato consome hold compatível uma vez; release posterior não duplica.
- [x] Troca de atleta preserva; token novo e lifecycle cancelam sem ação fantasma.
- [x] Teclado e touch produzem a mesma intenção a 30/60/120 Hz de render.
- [x] Saque, recepção, levantamento, ataque, bloqueio e bola quebrada são jogáveis.
- [x] Testes, E2E, playtest, review, CI, Pages e smoke público estão verdes.
- [x] Remoto continua literalmente somente `main`.

## Evidência de fechamento

- Gate local: 55 arquivos/494 testes, 11/11 E2E, build (166,78 kB gzip) e smoke do `dist` verdes.
- Revisões independentes: lifecycle/ordenação corrigidos no núcleo; integração/mecânicas sem novos
  findings após 61 testes direcionados, typecheck e lint.
- Publicação: run `29210820681`, SHA `e1a1b10`, deployment `5416656576`, todos verdes.
- Playtest público real: planos distintos resolveram `quick-set` hold com carga `0.4667`, `tip` tap
  e `high-set` tap; partida permaneceu em rally e não houve erro de console.
- Repositório remoto: a API de branches retornou exclusivamente `main`.
