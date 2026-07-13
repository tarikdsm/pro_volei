# Fase 3B — TeamBrain, formações e cobertura coletiva

> **Execução:** TDD, planner puro antes da integração, um único writer tático por atleta,
> commits atômicos em `main`, revisão independente e publicação comprovada no GitHub Pages.

**Objetivo:** fazer as doze atletas participarem da jogada como equipes de vôlei 6×6. Um mesmo
`TeamBrain`, determinístico e espelhado, coordena recepção, transição, ataque, cobertura, defesa por
corredores, bloqueio simples/duplo e recomposição sem retirar do usuário o controle da atleta ativa.

**Não objetivos:** leitura estratégica do adversário, memória de padrões e escolha inteligente de
saque/levantamento/alvo (3C); tuning estatístico de 1.000 rallies (3D); novas animações, modelos,
arte, áudio, HUD ou alteração da gramática setas + Espaço/toque.

## Decisões canônicas

- `TeamBrain` é domínio puro: sem Three.js, DOM, hooks, relógio ou RNG. Recebe snapshots numéricos
  e devolve um `TeamPlan` imutável com exatamente seis responsabilidades.
- HOME e AWAY usam o mesmo algoritmo em coordenadas locais. Conversões explícitas local↔mundo
  garantem espelhamento por `(x,z) -> (-x,-z)` e testes metamórficos.
- A identidade dos papéis fica estável por `planId`/revisão, exceto `active`/`block-primary`: uma
  troca confirmada pelo AutoSelector incrementa a revisão, transfere o papel e reconcilia no mesmo
  tick os targets da atleta liberada e da recém-controlada. Empates usam índice da atleta.
- `TeamTacticsSystem` é o único aplicador coletivo de `moveTo`. Ele nunca usa `warpTo` durante o
  rally e nunca sobrescreve a atleta ativa, a controlada pelo usuário, a sacadora ou uma rota de
  contato/bloqueio de prioridade superior.
- O AutoSelector é a fonte de verdade da atleta humana ativa. Sua revisão de seleção participa da
  chave do plano tático: uma troca preserva o `planId`, reserva imediatamente a nova controlada e
  devolve a anterior à cobertura. No bloqueio, a primária humana é sempre a escolhida pelo controle;
  o TeamBrain escolhe somente sua assistente.
- `TouchPlan` continua autoridade sobre quem toca na bola; mechanics continua autoridade sobre
  contato, trajetória, qualidade e regras. O TeamBrain coordena as outras cinco atletas.
- A dificuldade não muda geometria, alcance, aceleração, velocidade máxima ou formação. Somente a
  atleta manual usa `PLAYER.speed`; todas as atletas automáticas usam a mesma velocidade física
  base. Probabilidade, percepção e atraso de execução continuam nas políticas explícitas.
- `TEAM_TACTICS` concentra offsets, margens, separação e limites. Targets ficam no próprio lado e
  dentro da largura da quadra, salvo a posição legal da sacadora na preparação do saque.
- O journal v1 não recebe amostras por tick. Um trace tático readonly separado alimenta testes e
  métricas headless sem alterar hash, ordem de RNG ou custo do runtime de produção.

## Arquitetura

```text
Match/RallyState + snapshots das 6 atletas
                    │
            TeamTacticsSystem
            ┌───────┴────────┐
            ▼                ▼
      TeamBrain HOME    TeamBrain AWAY
            │                │
            └──── TeamPlan ──┘
                    │
          ownership/reservas
                    │
          moveTo somente off-ball
                    │
        mechanics mantém bola/contato
```

## Contratos de domínio

- Fases: `base`, `serve-formation`, `reception`, `offense-transition`, `attack-coverage`,
  `defense-read`, `block-defense` e `recompose`.
- Papéis mínimos: `active`, `server`, `setter`, `attacker`, `cover-short-left`,
  `cover-short-right`, `cover-deep`, `defend-line`, `defend-cross`, `defend-seam`,
  `block-primary`, `block-assist` e `base`.
- `TeamBrainFrame`: lado, revisão/tick lógico, estado da partida, saque/posse/toques, rotação,
  próximo contato normalizado e seis snapshots `{id, slot, row, pos, velocity, airborne}`.
- `TeamPlan`: fase, revisão, `planId` e exatamente um assignment por cada atleta, sem IDs duplicados
  nem targets coincidentes abaixo da separação mínima. Papéis podem repetir quando permitido
  (`base`); papéis exclusivos aparecem no máximo uma vez. Quando aplicável, há `BlockPlan` com
  primária, assistente opcional, corredor e tempo até o contato.
- `TeamTacticsSnapshot`: cópia readonly e primitiva do último plano por lado; nenhuma referência a
  Athlete/Vector3 pode escapar.

## Revisões e transições

| Evento | Revisão/fase | Aplicação |
| --- | --- | --- |
| preparação de saque/rotação | nova revisão `serve-formation` | seis atletas; sacadora reservada |
| novo `TouchPlan` | nova revisão conforme contato/posse | seis assignments; writers reservados ignorados |
| troca do AutoSelector | mesma `planId`, nova revisão | nova controlada reservada; anterior reassumida |
| compromisso de bloco humano | mesma revisão, evento one-shot | assistente válida recebe salto sincronizado |
| contato/mudança de posse | nova revisão na mesma tick lógica | transição/cobertura ou defesa |
| entrada em `point` | revisão `hold` transitória | cada atleta fixa target na posição atual |
| próximo `servePrep` | nova revisão de recomposição | volta gradual às bases da rotação atual |

O tick lógico é dado de diagnóstico, nunca causa de recomputação. Uma revisão só muda pelos eventos
acima; isso impede jitter e torna o trace independente da frequência externa.

## Tarefa 1 — planner puro, coordenadas e formações-base

1. Criar tipos em `src/game/team/TeamTactics.ts`, constantes em `core/constants.ts` e helpers de
   coordenadas em `src/game/team/CourtFrame.ts`.
2. Criar `TeamBrain.ts` puro com validação defensiva e assignments completos/imutáveis.
3. Implementar base/recomposição e recepção em três corredores, incluindo liberação da levantadora
   e proteção da atleta do próximo contato.
4. Testar as seis rotações, bounds, valores finitos, IDs únicos, separação mínima, desempate estável
   e espelhamento exato HOME/AWAY.
5. Garantir por teste estático que o diretório do planner não importa Three, browser, hooks ou RNG.

## Tarefa 2 — ownership, revisão e integração mínima

1. Criar `TeamTacticsSystem.ts` para montar frames, manter uma instância por lado e aplicar planos.
2. Definir reservas explícitas: atleta do `TouchPlan`, humana atualmente controlada, sacadora e
   bloqueadoras comprometidas; assignments reservados permanecem observáveis mas não são aplicados.
3. Expor no `HumanController` um snapshot readonly `{athleteId, selectionRevision, mode}`. Toda troca
   incrementa a revisão; o sistema replaneja sem trocar `planId`, reserva a nova atleta e reaplica
   cobertura à liberada no mesmo tick. Testar as duas trocas permitidas antes do lock e estabilidade
   depois do lock, tanto em recepção quanto em bloqueio.
4. Inventariar callbacks agendados que escrevem `moveTo`, `jump` ou responsabilidade tática em
   `AiController`, `Match`, bloqueio e novos helpers. Cada callback captura
   `{planId, tacticalRevision, athleteId}` e só executa se os três ainda forem atuais, ou seu owner
   cancela explicitamente o evento. Testar obsolescência após N→N+1 e após troca do AutoSelector.
5. Integrar `Match` na preparação de saque e em cada novo `TouchPlan`; na entrada em `point`, aplicar
   `hold current` para cancelar targets antigos; somente o próximo `servePrep` inicia recomposição.
   A integração adiciona orquestração, não regras táticas.
6. Separar velocidade por atleta: a controlada usa `PLAYER.speed`; companheiras e CPU usam
   `PLAYER.aiSpeed` sem `Difficulty.moveSpeed`. Manter o campo legado sem efeito ou removê-lo com os
   testes/documentação correspondentes, sem criar física diferente por dificuldade.

## Tarefa 3 — transição e cobertura de ataque

1. Na transição ofensiva, reservar levantadora e atacante previstas e distribuir as demais em
   aproximação, cobertura curta esquerda/direita e fundo.
2. Em `attack-coverage`, formar triângulo atrás da atacante sem invadir o ponto de contato, com uma
   atleta profunda preparada para rebote/bola desviada.
3. Após contato ou mudança de posse, trocar a fase em no máximo uma revisão e remover comandos
   obsoletos sem teleportes ou jitter de papéis.
4. Testar que pelo menos quatro atletas recebem papel não-base em cada sequência completa
   passe→levantamento→ataque e que a cobertura de um stuff oferece duas opções alcançáveis.

## Tarefa 4 — defesa por corredores e bloqueio simples/duplo

1. Distribuir `line`, `cross` e `seam` em alvos distintos; a linha de frente faz staging sem deixar
   as defensoras de fundo paradas na base.
2. No staging pré-ataque, usar somente posição visível da atacante/ponto do contato e tempo restante;
   jamais acessar alvo ou ruído futuro da cortada. Selecionar primária da CPU por ETA; no humano,
   aceitar a primária do AutoSelector. Adicionar assistente adjacente somente se o solver cinemático
   provar chegada até o contato, caso contrário formar bloco simples.
3. Fazer `prepareBlock` e `HumanController.assignBlock` consumirem o mesmo `BlockPlan`, mantendo
   chance/latência da CPU. Se a seleção humana confirmada divergir da proposta inicial, incrementar
   a revisão e recalcular primária/assistente antes de aplicar rotas. Controle, mechanics, trace e
   resolução compartilham essa identidade. A resolução usa o cruzamento real só após o lançamento.
4. Emitir do `HumanController` um evento one-shot readonly
   `HumanBlockCommitted { planId, athleteId, jumpTick }` quando o salto realmente começa. O sistema
   valida plano/revisão e aciona a assistente uma única vez; cancelamento, ausência de input, troca
   de plano ou fim do ponto revogam o evento.
5. Resolver o bloco como um único contato de equipe: ordenar candidatas comprometidas por índice,
   calcular `p` individual com a janela lateral real e combinar por `1 - Π(1 - p)`. Consumir um só
   draw de resultado, emitir um evento/toque e escolher a animação da candidata de maior `p`
   (desempate por índice). A união amplia cobertura, não duplica contatos ou draws.
6. Testar simples, duplo, assistente inviável, mesmo-ID proibido, divergência entre primária proposta
   e AutoSelector, ausência de input, ordem invertida das candidatas, exatamente um evento/draw e
   contagem legal de toques.

## Tarefa 5 — trace headless e critérios mensuráveis

1. Expor `Match.teamTacticsSnapshot(side)` readonly e opcionalmente observar mudanças de revisão no
   runner; não inserir snapshots táticos no `RallyJournal` v1.
2. Agregar por rally: fases visitadas, atletas engajadas, deslocamento da base, corredores cobertos,
   cobertura do ataque, tipo/viabilidade do bloco e tempo de recomposição.
3. Mesma seed/opções produz trace byte a byte idêntico; 30/60/120 Hz externos produzem o mesmo trace
   e journal; TeamBrain consome zero draws dos quatro streams.
4. Fixtures determinísticas exercitam passe→levantamento→ataque, stuff e troca de seleção. O solver
   cinemático mede chegada dentro da janela; targets distintos usam tolerância `1e-6` e supports
   mantêm pelo menos `0,65 m`, exceto a dupla de bloqueio parametrizada.
5. Em batch de 100 rallies, medir violações a partir de posições/tempos reais — sem confiar no flag
   de viabilidade do próprio planner — e exigir assignments completos, movimento off-ball nos dois
   lados, zero assistente inviável e preservação dos watchdogs.
6. Rodar relatório informativo de 1.000 rallies totais: 50 por cada uma de 20 seeds fixas. Metas de
   balanceamento/tuning continuam exclusivamente na 3D e não bloqueiam a 3B salvo regressão evidente.

## Tarefa 6 — verificação, revisão e publicação

1. Agente independente revisa pureza, simetria, ownership de targets e callbacks obsoletos.
2. Agente independente revisa regras de bloqueio, controle humano e ausência de vantagem física.
3. Rodar `npm run check`, build, E2E completo, batch headless e comparação 30/60/120 Hz.
4. Playtest real desktop e mobile paisagem: observar recepção, transição, cobertura, defesa e bloco
   sem perda de controle, colisões gritantes, jitter ou erro de console.
5. Registrar antes/depois visual determinístico nos viewports já adotados, respeitando os budgets.
6. Commit/push direto em `main`, acompanhar CI/Pages e repetir smoke público desktop/mobile.

## Gate final

- [ ] Planner puro, simétrico e determinístico produz seis assignments válidos por lado.
- [ ] Atleta ativa/humana/sacadora/bloqueadora não tem sua autoridade sobrescrita.
- [ ] Callback atrasado do plano N não altera a rota depois do plano N+1.
- [ ] Recepção, transição, cobertura e defesa por corredores movem coletivamente as equipes.
- [ ] Bloqueio simples/duplo respeita ETA, input humano e regras dos três toques.
- [ ] Trace headless é readonly, invariável a 30/60/120 Hz e não consome RNG.
- [ ] Batch, testes, E2E, build, playtests e revisões independentes estão verdes.
- [ ] CI, Pages e smoke público desktop/mobile estão verdes.
- [ ] Remoto continua literalmente somente `main`.
