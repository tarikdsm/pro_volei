# Fase 3C — OpponentBrain e escolhas táticas da CPU

> **Execução:** TDD, domínio puro antes da integração, observação atrasada sem informação futura,
> orçamento fixo de RNG, commits atômicos em `main`, revisão independente e publicação comprovada.

**Objetivo:** substituir os sorteios atuais de saque, corredor de levantamento e alvo de ataque por
decisões inteligentes, variadas, legíveis e contestáveis. A CPU deve explorar espaço, costura,
bloqueio e padrões recentes porque observou o jogo — nunca porque leu input, target ou futuro.

**Não objetivos:** tuning final de win rate/faixas de 1.000 rallies (3D), atributos persistentes,
aprendizado entre partidas, árvore extensa de jogadas, assets/animação avançada (4), HUD ou novos
controles. Cues procedurais mínimos que tornam a decisão jogável pertencem à 3C.

## Decisões canônicas

- `TeamBrain` continua dono de formação e rotas coletivas. `OpponentBrain` decide **o que** jogar;
  mechanics continua dona de contato, erro técnico, trajetória, bloqueio e regras.
- Um `OpponentBrain` puro e espelhado recebe somente DTOs primitivos permitidos e devolve candidatos
  pontuados e decisão imutável. Não importa Three.js, `MechanicsCtx`, `TouchPlan`, `RallyState`, DOM,
  hooks, relógio global ou RNG.
- Um `OpponentStrategySystem` por partida mantém dois lados, buffer circular de percepção, memória
  curta, compromissos e IDs. No browser humano × CPU, somente a CPU escolhe; no headless AI × AI,
  os dois lados usam o mesmo algoritmo.
- Observações contêm tick, placar, fase/posse pública, saque e bola visível
  `{position, velocity, inFlight, lastVisibleContactTick}`, além de seis atletas por lado com
  `{id, slot, row, position, velocity, airborne}`. Candidatos são gerados dentro do domínio a partir
  desse DTO. Não entram input humano, `Athlete.target`, `TeamPlan.target`, `ctx.aim`, `chosenZone`,
  `plan.point`, `contactIn`, landing futuro, draw futuro ou intenção ainda não executada.
- Cada dificuldade consulta um snapshot já armazenado em `decisionTick - perceptionDelayTicks`.
  Se não existir snapshot com tick menor ou igual ao cutoff, o resultado é `not-ready`; jamais se
  usa um frame mais novo como fallback. Latência de percepção e atraso de execução são políticas
  distintas; nenhuma altera velocidade, aceleração, alcance ou física.
- A seleção usa componentes normalizados em `[0,1]`, shortlist competitiva e distribuição limitada.
  Espaço atual vale mais que memória; o peso de memória nunca excede `0,20`. Opção dominante é
  escolhida; variedade atua somente entre alternativas competitivas.
- Cada lado possui stream independente `strategy.home`/`strategy.away`. Cada decisão aceita consome
  um `StrategyDrawTicket` de exatamente dois `uint32`: um para seleção e outro para variação
  espacial estratégica. O pipeline é transacional: valida owner/opções sem draw, salva o stream,
  adquire dois valores, cria/valida proposal e faz commit atômico; falha restaura o stream. Alterar
  HOME não desloca AWAY; erro, potência realizada e dispersão física continuam em `contact`, e
  execução temporal continua em `ai`. Compromisso depois revogado mantém seus dois draws, mas sua
  execução stale consome zero draw adicional.
- Saque, levantamento e ataque são comprometidos antes de sua execução e não retargeteiam. O
  usuário pode fechar o espaço depois de observar a preparação; esse contrajogo é intencional.
- Memória é limitada a seis observações relevantes por categoria, usa pesos de recência
  `[1, 0.72, 0.52, 0.37, 0.27, 0.19]`, vive somente durante a partida e atualiza apenas após evento
  resolvido/observável.
- Outcomes estratégicos são eventos internos síncronos identificados por decision/plan ID e estado
  `pending | resolved | revoked`; não dependem do port opcional/falível de telemetria e recebem
  exatamente um terminal (`resolved` ou `revoked`).
- Cada compromisso produz `StrategyCue` sem alvo exato: família/corredor, commit/execute tick e lead.
  Toss/preparação do saque, orientação do set e windup do ataque usam parâmetros procedurais já
  existentes por novo port visual. Leads mínimos: saque 24 ticks, set 24 e ataque alto/acelerado 19;
  rápida central usa o cue antecipado do set como contrajogo. A decisão não muda durante o cue.
- `RallyJournal` v1 não muda. Um trace estratégico separado registra decisões em headless; o
  runtime de produção não armazena histórico de diagnóstico.

## Arquitetura

```text
Match tick ── snapshots públicos ──> PerceptionRing (48 ticks)
                                          │ snapshot atrasado
eventos concluídos ──> StrategyMemory ────┤
                                          ▼
                                  OpponentBrain puro
                                  candidatos + scores
                                          │ 2 draws fixos
                                          ▼
                                OpponentStrategySystem
                            compromisso por decisionId/planId
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
                    aiServe            doSet              doSpike
                       └──── mechanics aplica erro/bola/regras ────┘
```

## Contratos de domínio

- Zonas de saque/ataque: curta e profunda × esquerda, centro e direita, sempre em coordenadas locais
  do lado-alvo e convertidas explicitamente ao mundo.
- Corredores de levantamento: esquerda, centro e direita; tempos: alto, rápido e acelerado.
- Famílias de ataque: potência profunda, colocado na linha/diagonal/costura e largada curta.
- Matriz canônica: saque `float-short|float-deep|power-deep` × corredor; set `high-left/right`,
  `quick-center` e `accelerated-left/right`; ataque `power-line/cross-deep`,
  `placed-line/cross/seam` e `tip-short-left/center/right`. Combinações artificiais não existem.
- `StrategyObservation`: tick observado, placar, fase/posse/saque públicos, bola visível e snapshots
  físicos dos 12 atletas. O frame é capturado uma vez no início do tick fixo, antes de input,
  `HumanController.update` e timeline; representa somente estado concluído do tick anterior.
- `StrategyMemorySnapshot`: revisão, até seis resultados por categoria e últimas três escolhas.
- `VisibleBallRead`: classificação pura derivada de posição/velocidade visíveis — ETA, altura e
  distância prevista à janela da levantadora. Nunca reutiliza o escalar interno `quality`.
- `OwnContactRead`: DTO síncrono criado **depois** de a própria equipe lançar a bola, com bola já
  executada e elenco próprio atual. É propriocepção, não passa pelo delay rival e não contém target
  ou `q`; combina-se somente com o snapshot adversário atrasado.
- `StrategyProposal`: saída pura do brain, sem ID: escolha, candidatos/scores e ticket fornecido.
- `CommittedStrategyDecision`: side + sequence, kind, decisionTick, observationTick, memoryRevision,
  ownership e proposal. IDs são monotônicos e independentes por lado.
- `AttackDecisionDraft`: nasce no set ligado a `originSetPlanId`; depois que `planNext('spike')`
  aloca o plano, recebe bind atômico de `spikePlanId`, tacticalRevision e athleteId sem reler defesa
  ou consumir draws. Falha/troca de posse revoga o draft.
- `StrategyCue`: decision ID, família/corredor, commitTick, executeTick e lead; nunca expõe target.
- `AthleteStrategyCue`: port visual opcional com variante/corredor/expiração; parametriza a pose
  procedural e nunca chama `moveTo`, `jump` ou altera physics. Headless implementa o mesmo contrato.
- `OpponentStrategySnapshot`: versão, próximo ID, buffers, memórias e compromissos. É congelado,
  serializável, profundamente validado e restaurado transacionalmente. Não promete rebobinar Match.

## Perfis de dificuldade

| Política | Fácil | Normal | Difícil |
| --- | ---: | ---: | ---: |
| atraso de percepção | 30 ticks | 15 ticks | 6 ticks |
| eventos de memória lidos | 2 | 5 | 6 |
| exploração/variedade | 25% | 12% | 6% |
| temperatura do softmax | 1,15 | 0,80 | 0,55 |
| teto da melhor candidata | 50% | 60% | 70% |

`reactionDelay`, qualidade de passe, erro técnico, chance de bloqueio e defesa permanecem políticas
de execução existentes. A 3D fará tuning estatístico; a 3C entrega decisões corretas e observáveis.

## Utilidade e distribuição

- Saque: espaço `0,30`, costura/ETA `0,25`, memória `0,20`, adequação técnica `0,15` e variedade
  recente `0,10`. Shortlist: `score >= best - 0,22`.
- Set: pressão do bloqueio `0,30`, viabilidade/ETA `0,30`, leitura visível do passe `0,20`, memória
  `0,15` e variedade `0,05`. Shortlist: `score >= best - 0,18`.
- Ataque: espaço `0,30`, bloqueio `0,25`, técnica × profundidade `0,20`, ângulo `0,10`, memória
  `0,10` e variedade `0,05`. Shortlist: `score >= best - 0,18`.
- Pesos somam `1`; cada componente é finito e limitado a `[0,1]`. Repetição entra no componente de
  variedade, nunca como penalidade de escala aberta.
- Se a shortlist tem uma candidata, ela recebe 100%. Caso contrário,
  `p=(1-exploration)*softmax(score/temperature)+exploration/n`; o teto do perfil é aplicado somente
  quando a diferença top-2 está dentro do limiar e o excesso é redistribuído proporcionalmente.
- O primeiro uint32 amostra a CDF canônica. O segundo, combinado por hash versionado com optionId,
  escolhe um subtarget legal dentro da zona; não perturba score nem simula erro técnico.

## Tarefa 1 — zonas, tipos e OpponentBrain puro

1. Criar `src/game/strategy/StrategyTypes.ts`, `CourtZones.ts` e `OpponentBrain.ts`.
2. Implementar conversões locais espelhadas e geração interna de candidatos canônicos para seis
   zonas, três corredores e técnicas legais, com targets sempre dentro da quadra. Candidato
   pré-calculado por Match/mechanics é proibido.
3. Pontuar saque por espaço/costura, ETA das recebedoras, memória observável e repetição; set por
   viabilidade da atacante, leitura pura da bola lançada, densidade de bloqueio e memória; ataque
   por espaço, bloqueio visível, profundidade defensiva, ângulo e variedade.
4. Podar set rápido com passe/ETA inviável; decisão estratégica nunca cria erro de rede/fora.
5. Implementar normalização, shortlist, softmax/exploração, teto condicional e hash de subtarget
   exatamente como especificado, usando somente o ticket fornecido.
6. Testar pureza estática, imutabilidade, bounds, finitude, ordem canônica, empate estável,
   espelhamento HOME/AWAY e invariância à permutação de atletas/candidatos.
7. Teste `future-poison` também no builder/adaptador: dois Matches com DTO público idêntico e
   `aim`, input, target, plan.point/landing atual divergentes produzem candidatos, decisão e budget
   idênticos; guarda estática proíbe chaves privadas.

## Tarefa 2 — percepção atrasada, memória e snapshot

1. Criar `StrategyMemory.ts` como reducer puro e limitado: recepção por zona, corredor/resultado de
   ataque, bloqueio observado e últimas escolhas próprias.
2. Criar `OpponentStrategySystem.ts` com ring buffer fixo de 48 ticks, dois lados, revisão de memória,
   compromissos, `matchEpoch` e sequências monotônicas por lado durante a vida do Match. Nova partida
   incrementa epoch, revoga tudo e zera memória sem permitir colisão com callback antigo.
3. Capturar o frame exatamente uma vez no início do fixed tick. Separar `perceptionDelayTicks` de
   `reactionDelay`; consulta usa o snapshot mais novo cujo tick não ultrapassa o cutoff. Sem frame
   elegível, retorna `not-ready`; nunca lê presente como fallback. Gap de tick é aceito sem sintetizar
   frame; tick duplicado é idempotente e regressão é rejeitada.
4. Atualizar memória por `StrategyOutcomeEvent` interno, síncrono e identificado. Saque fecha no
   primeiro contato rival ou ponto anterior; set acompanha o ataque associado; ataque fecha como
   `blocked` no block, `dug` no primeiro contato defensivo ou `kill | error` no ponto anterior a esse
   contato. Revogado não aprende. Cada decisionId gera um único outcome de memória; telemetria apenas
   observa depois.
5. Criar snapshot/restore versionado contendo buffer, memória, IDs e compromissos. Validar finitude,
   capacidade, ticks estritamente monotônicos, ordem canônica e referências. Nova partida zera
   memória; novo set não zera; restore inválido preserva byte a byte o estado anterior.
6. Testar limite de seis eventos, pesos, `memoryWeight <= 0,20`, monotonicidade, reset, not-ready,
   atraso real, captura duplicada/ausente e que movimento posterior ao cutoff não altera decisão.
7. A transação salva stream **e todo estado do system** (sequence, draft, pending outcome, cue/trace
   outbox e compromisso) antes dos dois draws. Qualquer falha restaura ambos byte a byte. Testar
   validate→ticket→proposal→commit, rollback após proposal inválida e revogação posterior.
8. Proposal/commit somente enfileira cue/trace internos. Ports externos recebem depois do commit;
   sink que lança é isolado/desativado e nunca reverte nem altera gameplay.

## Tarefa 3 — saque estratégico e lifecycle seguro

1. Criar `serveEpoch` monotônico (não reinicia em `startMatch`) e endurecer o callback da CPU com
   epoch, estado, lado e sacadora. Callback obsoleto antes do commit consome zero draw estratégico;
   execução stale de compromisso existente consome zero draw adicional e não muta/telemetra.
2. Em `aiServe`, solicitar decisão antes do toss. Escolher entre flutuante curto, flutuante profundo
   e potente profundo. Ticket escolhe opção/subtarget; potência, dispersão e erro realizados vêm
   exclusivamente de `contact`.
3. Mechanics recebe target/técnica já fechados; `performServe` captura decisionId/token e valida o
   compromisso nos callbacks de toss/hit antes de mutar bola ou rally.
4. Registrar outcome somente após recepção/ace/erro observável. A recepção é classificada pelo
   `VisibleBallRead` após o lançamento, nunca pelo `q`. Duas ruins influenciam Fácil; quatro,
   Normal/Difícil, sem ultrapassar peso/teto.
5. Emitir `StrategyCue` com lead mínimo de 24 ticks; toss/preparação distinguem float/power sem
   marcador do alvo. Testar decisão imutável durante o cue.
6. Testar corredor vazio, recebedora fraca na memória, cenário dominante vs equilibrado, contrajogo
   posterior, callback N após novo saque, budget/rollback em todos os ramos e stale sem mutação.
7. Gate de ownership: cada saque/set/ataque aceito soma `+2` somente em `strategy.<side>`; zero no
   stream estratégico oposto e zero draws estratégicos no `ai`. `ai` fica temporal/bloqueio;
   `contact` fica potência/erro/dispersão.

## Tarefa 4 — levantamento e ataque comprometidos

1. Depois de `doPass` lançar a bola, criar `OwnContactRead` a partir da posição/velocidade executada
   e elenco próprio. Combiná-lo imediatamente com o snapshot adversário atrasado já elegível; não
   esperar o frame pós-passe envelhecer. Isso mantém inteligência no Fácil sem enxergar o presente
   rival.
2. Antes de `planNext('set')`, escolher levantadora legal por ETA à janela do `VisibleBallRead` (zero
   draw) e comprometer corredor/tempo. `SetDecisionDraft` usa `possessionEpoch/contactSequence` até
   bind único no planId recém-alocado. `doSet` só consome; escolha humana continua intacta.
3. Set estratégico só é aceito se o voo previsto preservar cue ≥24 ticks. Alta é segura; rápida
   exige leitura/ETA; acelerada explora bloco tardio. Sem snapshot rival elegível ou lead, usar
   `FallbackExecution` high-left/right pela ponta legal de melhor ETA, com zero ticket, motivo no
   trace e sem aprendizado. Sem ponta viável, enviar safety freeball explícita.
4. Para `quick-center`, criar também o `AttackDecisionDraft` no compromisso do set, usando o mesmo
   snapshot adversário e ticket estratégico próprio (+2 no mesmo stream). O cue revela “rápida”,
   não o alvo. Falha do levantamento revoga o draft sem aprendizado/draw adicional.
5. Para alta/acelerada, criar `AttackDecisionDraft` no levantamento. Depois de
   `planNext('spike')`, qualquer draft recebe bind atômico para spikePlanId/revision/athlete sem reler
   defesa ou consumir draw. A cortada consome essa identidade.
6. Ataque alto/acelerado exige cue ≥19 ticks; técnica/trajetória sem lead é podada. Rápida central é
   exceção deliberada: o cue do set ≥24 anuncia a opção e ainda permite input na janela ideal de
   bloqueio. Fallback é placed-seam seguro, tipado e sem memória estratégica.
7. Ataque escolhe potência profunda, colocado ou largada conforme defesa/bloqueio visíveis. Erro,
   qualidade e dispersão continuam em mechanics/`contact`.
8. Compromissos capturam `{decisionId, planId, tacticalRevision, athleteId, observationTick}`; troca
   de posse/plano/ponto os revoga. Guard falho = zero mutação e zero draws extras.
9. Criar consumidor `AthleteStrategyCue`: float/power, corredor/quick e power/placed/tip mapeiam para
   poses existentes parametrizadas; cue nunca escreve rota. Adaptar `HeadlessCharacter` e testar
   atleta/variante/expiração corretas.
10. Testar passes de 20/30/50 ticks nas três dificuldades, fallback não dominante, passe ruim sem
   rápida, escolha da levantadora, central atrasada, linha→diagonal, defesa funda→tip, draft
   set→spike, posse inesperada, inviabilidade, leads 24/19 e input pós-cue ainda em good/perfect.

## Tarefa 5 — trace estratégico e headless

1. Criar `StrategyTrace.ts` separado: side/sequence, kind, decisionTick, observationTick,
   memoryRevision, candidatos ordenados/scores quantizados na serialização, escolha, hash/ticket e
   draws before/after de `strategy.home/away`. Documentar que o journal v1 não audita esses streams.
2. Injetar sink opcional em `MatchOptions`; browser não retém trace. Headless fatia por rally/run sem
   copiar histórico, atribui decisão de saque pré-`rally-start` ao rally seguinte e preserva o
   `RallyJournal` v1. `run(2)` equivale a `run(1)+run(1)` sem entrada perdida/duplicada.
3. Criar `HeadlessStochasticCheckpoint` (RNG + estratégia) permitido somente na fronteira de ponto e
   enquanto o estado físico não avançou. Guardar fingerprint com `matchEpoch`, `simulationTick`,
   `pointCount`, `score`, `sets`, `setNumber`, `servingSide` e slots HOME/AWAY; rejeitar divergência
   sem mutar. Ele não
   rebobina Match. Validar ambos antes, fazer rollback se strategy falhar após RandomHub e provar que
   snapshots/handles ativos continuam byte a byte; comparar dois runners naturalmente equivalentes.
4. Mesma seed/opções produz journal e trace idênticos; 30/60/120 Hz, batch contínuo e runs fatiados
   são equivalentes; watchdogs permanecem ativos.
5. Fixtures determinísticas provam cada família como melhor, dominante=100%, shortlist equilibrada
   respeitando piso/teto, memória elevando contragolpe em 15–20 p.p. e no máximo três repetições
   quando existe alternativa competitiva.
6. Medir distribuição por zona/corredor/técnica, motivos, adaptações e budget. Em 100 rallies, exigir
   zero decisão ilegal, ambos os lados estratégicos e variedade mínima na bateria fixa; famílias
   podadas legitimamente e percentuais ficam informativos.
7. Rodar matriz informativa de 1.000 rallies/20 seeds. O limite de 45% e win rate são relatório para
   a 3D, não gate da 3C salvo colapso evidente de variedade.
8. Reportar taxa de `FallbackExecution` por dificuldade/voo. Em jogadas fisicamente viáveis, fallback
   fica abaixo de 20% no Fácil e 10% no Normal/Difícil na bateria fixa; poda física legítima é
   contabilizada separadamente.

## Tarefa 6 — verificação, revisão e publicação

1. Agente independente revisa fronteira anti-cheat, snapshots, memória e lifecycle dos compromissos.
2. Agente independente revisa diversão, variedade, contrajogo e separação TeamBrain/mechanics.
3. Rodar `npm run check`, build, E2E completo, matriz headless e testes 30/60/120 Hz.
4. Playtest desktop e mobile landscape: observar ao menos saque direcionado, troca de corredor,
   potência/colocado/largada e resposta a uma formação alterada, sem retarget ou erro de console.
5. Commits/push direto em `main`; acompanhar CI/Pages e repetir smoke público desktop/mobile.

## Gate final

- [ ] OpponentBrain puro usa somente observação permitida e nunca lê futuro/input/target privado.
- [ ] Percepção atrasada e memória curta variam por dificuldade sem alterar física.
- [ ] Saque, corredor/tempo do set e alvo/técnica do ataque são inteligentes e comprometidos.
- [ ] Cada decisão aceita consome budget fixo; stale consome zero draw tardio.
- [ ] Snapshot estratégico é transacional; checkpoint estocástico não promete rebobinar Match.
- [ ] StrategyTrace é readonly, invariável a 30/60/120 Hz e separado do journal v1.
- [ ] Fixtures provam famílias/variedade; batch demonstra adaptação e zero ilegal nos dois lados.
- [ ] Testes, E2E, playtests e revisões independentes estão verdes.
- [ ] CI, Pages e smokes públicos desktop/mobile estão verdes.
- [ ] Remoto continua literalmente somente `main`.
