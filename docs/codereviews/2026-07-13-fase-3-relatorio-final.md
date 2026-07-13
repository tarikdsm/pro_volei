# Relatório final — marco 3A–3C de IA coletiva

**Data:** 13/07/2026  
**Escopo:** Fases 3A, 3B e 3C  
**Resultado:** entregue, funcional e publicada; desenvolvimento pausado antes da 3D

## Resultado de produto

- Simulação CPU×CPU reproduzível, com fixed step, streams RNG independentes, journal físico e
  traces tático/estratégico separados.
- Equipes 6×6 formam recepção, transição, cobertura de ataque, defesa por corredores e bloqueio
  simples/duplo sem tomar autoridade da atleta humana.
- A CPU observa somente estado público permitido e atrasado por dificuldade, mantém memória curta
  e compromete saque, set e ataque sem retarget.
- Famílias executadas na física: saque float curto/profundo e power; set alto, rápido e acelerado;
  ataque power, placed e tip, com fallbacks seguros quando a jogada não é fisicamente viável.
- No mobile web, portrait pausa e exibe a orientação; landscape retoma a partida em layout de jogo.

## Integridade e determinismo

`StrategyTrace` registra candidatas canônicas, escolha, ticket, dois draws e outcome terminal sem
alterar o `RallyJournal` v1. O runner falha se uma decisão comprometida desaparecer, ficar pendente,
escolher candidata ilegal ou divergir do budget real dos streams.

`HeadlessStochasticCheckpoint` combina RNG e estratégia somente na fronteira de ponto. O
fingerprint inclui epoch/tick, ponto, placar, sets, saque e rotação; por isso um snapshot antigo não
rebobina o estado físico do `Match`. Restore inválido preserva RNG e estratégia por rollback
transacional, inclusive quando a falha acontece depois de mutação parcial do core estratégico.

## Evidências

- Gate local final: 92 arquivos e 911 testes verdes.
- Cobertura: 77,94% statements, 80,25% branches, 85,30% functions e 79,13% lines.
- `npm run build`: Vite transformou 84 módulos; bundle JS de 772,37 kB/202,15 kB gzip.
- `npm run test:e2e:smoke:prod`: 1/1 Chromium verde contra `vite preview`.
- Bateria de 100 rallies: 522 decisões, ambos os lados, mais de seis opções distintas, zero
  candidata ilegal e zero outcome pendente.
- Matriz informativa de 1.000 rallies/20 seeds: 497–503 e zero violação tática.
- Determinismo comprovado para mesma seed, 30/60/120 Hz, batch contínuo e runs fatiados.
- Playtest CPU×CPU: 30 contatos com saque/set/ataque dos dois lados e variedade entre
  alto/rápido/acelerado e power/placed/tip.
- Mobile: portrait 390×844 pausou; landscape 844×390 retomou com controles visíveis.
- Commit funcional final: `e33ab54`.
- GitHub Actions/Pages: run `29244051320` verde, incluindo qualidade, build, smoke e deploy.
- Git remoto: apenas `refs/heads/main`, sem branch de feature, deploy ou PR.

## Revisões independentes

Foram feitas revisões separadas de arquitetura, gameplay/IA, visual/mobile, lifecycle ofensivo,
integridade transacional do checkpoint e determinismo/completude do trace. Findings encontrados
durante o trabalho foram corrigidos e reavaliados. Parecer final: **zero HIGH e zero MEDIUM**.

## Risco residual aceito

O console mantém apenas o aviso de depreciação de `PCFSoftShadowMap` emitido pelo Three r185. Não é
erro funcional e sua migração pertence à futura fase de render, atualmente pausada. Tuning de win
rate, percentis de fallback, balanceamento estatístico fino e remoção do multiplicador legado
`DIFFICULTIES.servePower` pertencem à 3D e não foram iniciados. A estratégia não concede física
nova por dificuldade, mas a execução herdada da v1.1 ainda varia a potência do saque.

## Encerramento

O marco 3A–3C termina em estado buildável, testado e publicado. Nenhuma tarefa da 3D ou das Fases 4–7
foi iniciada. A retomada exige nova autorização do proprietário e novo plano antes de alterar
código de produção.
