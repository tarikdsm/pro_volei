# Fase 2C — AutoSelector, compromisso e assistência limitada

> **Execução:** TDD, módulos puros antes da integração, commits atômicos em `main`, revisão
> independente, playtest desktop/mobile e publicação comprovada no Pages.

**Objetivo:** escolher automaticamente a atleta humana com a melhor interceptação viável sem
retirar o controle do usuário. A escolha deve ser determinística, explicável e estável: no máximo
duas trocas por plano, vantagem mínima de 15% e lock nos 350 ms finais. A assistência altera
somente o alvo de deslocamento em até 0,65 m; não teleporta nem executa a ação.

**Escopo:** recepção/defesa e bloqueio usam seleção dinâmica. Saque tem atleta regulamentar,
levantamento permanece automático e ataque continua obedecendo à zona/atacante planejado; essas
situações não devem ser reescritas pelo seletor.

## Arquitetura

```text
Rally plan + Team/Athlete snapshots
               │
               ▼
      AutoSelector (puro/stateful)
      ├─ ETA cinemático compatível com Athlete.update
      ├─ legalidade + função tática + cobertura + direção
      ├─ histerese 15% / max 2 / lock 350 ms
      └─ SelectionDecision explicável
               │
               ▼
 ControlAssignment(planId) + HumanController.rebind trocam atleta/marker
               │
               └─ assistedTarget(max 0,65 m)
               │
               ▼
         Athlete.moveTo (sem warp)
```

## Tuning canônico

Adicionar `AUTO_SELECTOR` em `core/constants.ts`:

- `switchAdvantage = 0.15`;
- `lockWindow = 0.350 s`;
- `maxSwitches = 2`;
- `assistanceRadius = 0.65 m`;
- aceleração/deceleração planar compartilhada entre solver e `Athlete.update`;
- raio técnico vem de `CONTACT.reach`;
- penalidades de função/cobertura/direção pequenas e expressas em segundos equivalentes;
- candidato inviável recebe uma penalidade dominante, sem ser apresentado como viável.

O solver e `Athlete.update` usam o mesmo helper cinemático. A Fase 2C introduz velocidade planar e
aceleração explícitas para que a previsão nunca prometa uma bola que o movimento real não alcança;
o tuning deve continuar arcade e responsivo.

## Tarefa 1 — Cinemática compartilhada

**Arquivos:**

- Criar `src/game/control/kinematics.ts` e teste
- Modificar `src/game/Team.ts` e testes
- Modificar `src/core/constants.ts` e teste correspondente

1. Escrever RED para aceleração desde repouso, frenagem, mudança de direção, overshoot e ETA.
2. Implementar avanço planar puro e solver analítico com posição, velocidade projetada,
   aceleração e velocidade máxima.
3. `Athlete.update` usa o helper e expõe velocidade readonly; warp zera velocidade.
4. Ajustar aceleração/deceleração para atingir velocidade máxima em cerca de 200 ms, preservando
   resposta arcade e invariância do fixed step.

## Tarefa 2 — Solver de seleção e decisão pura

**Arquivos:**

- Criar `src/game/control/AutoSelector.ts`
- Criar `src/game/control/AutoSelector.test.ts`

1. Escrever RED para ETA compartilhado, alcance técnico, inviabilidade e desempate estável por id.
2. Pontuar cada candidata por ETA + penalidades de função, cobertura e movimento contrário.
3. Preferir candidata viável; se nenhuma for viável, manter a melhor decisão marcada como falha.
4. Implementar estado por plano: `begin`, `update`, `release`, contagem de trocas e snapshot.
5. Trocar somente quando a desafiante for ao menos 15% melhor; máximo duas trocas.
6. Proibir troca em `contactIn <= 0.350`; atleta travada ilegal produz falha explícita.
7. Cobrir empates, ordem de entrada, score zero, candidata atual ausente e tempos não finitos.

## Tarefa 3 — Assistência geométrica limitada

**Arquivos:**

- Criar `src/game/control/assistance.ts`
- Criar `src/game/control/assistance.test.ts`

1. Receber alvo manual e ponto de contato; devolver alvo corrigido no mesmo lado da rede.
2. Limitar a correção euclidiana a 0,65 m e aos limites da quadra.
3. Não acumular correções entre ticks: o alvo manual é a âncora, não o resultado assistido anterior.
4. Cobrir zero distância, vetor diagonal, clamp de quadra/rede e repetição sem drift.

## Tarefa 4 — Integrar recepção/defesa e bloqueio

**Arquivos:**

- Modificar `src/game/control/HumanController.ts` e testes
- Modificar `src/game/Team.ts` e testes
- Modificar `src/game/Match.ts` somente no wiring mínimo
- Modificar `src/game/RallyState.ts` e testes (`planId`)

1. `Team` fornece slot/base da atleta para penalidade de cobertura, sem expor mutação interna.
2. Cada `TouchPlan` recebe `planId` próprio. Um `ControlAssignment` neutro adapta tanto o plano de
   recepção quanto o canal paralelo de bloqueio, sem confundir atacante AWAY com bloqueadora HOME.
3. Ao receber plano humano de passe/dig/freeball, iniciar o seletor com atletas legais e substituir
   `plan.athlete` antes de agendar o controle.
4. Reavaliar uma vez por tick antes do movimento humano; numa troca, chamar `rebindControlled`
   dedicado (sem resetar timing/aim/hints), parar o alvo anterior,
   transferir controle/marker e ancorar o alvo manual na nova atleta.
5. Remover a aproximação automática ilimitada de recepção. Setas/joystick movem o alvo manual;
   `assistedTarget` corrige no máximo 0,65 m.
6. No bloqueio, selecionar apenas a linha de frente em direção ao ponto de ataque; manter ataque,
   saque e levantamento fora do AutoSelector.
7. Lock tardio nunca faz troca milagrosa. Se a atleta travada ficar ilegal, manter o plano falho e
   permitir que a bola resolva naturalmente.

## Tarefa 5 — Diagnóstico, revisão e publicação

1. Expor em debug apenas um snapshot readonly: atleta, score, viabilidade, trocas e lock.
2. Teste de integração prova: troca vantajosa, histerese, segunda troca, terceira bloqueada, lock e
   assistência sem teleporte.
3. E2E mantém setas + Espaço, executa rally e observa no máximo duas trocas por plano.
4. Playtest desktop e touch landscape verifica marker estável, controle responsivo e ausência de
   troca nos 350 ms finais.
5. Agente independente revisa fórmula, legalidade, integração e regressões de ataque/bloqueio.
6. Rodar `npm run check`, build, E2E completo e smoke do `dist`.
7. Commit/push direto em `main`, acompanhar Actions/Pages e repetir smoke público.

## Gate final

- [ ] ETA e score são determinísticos e compatíveis com o movimento real.
- [ ] Troca exige 15%, respeita máximo 2 e lock de 350 ms.
- [ ] Atleta ilegal no lock falha sem troca tardia.
- [ ] Assistência corrige no máximo 0,65 m, sem warp ou drift acumulado.
- [ ] Ataque/saque/levantamento preservam comportamento.
- [ ] Recepção e bloqueio transferem controle/marker sem flicker.
- [ ] Testes, E2E, playtest, review, CI, Pages e smoke público estão verdes.
- [ ] Remoto continua literalmente somente `main`.
