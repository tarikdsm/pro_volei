# Pró Vôlei 2.0 — Design

**Data:** 2026-07-12

**Status:** aprovado pelo proprietário para execução autônoma

**Alvo:** GitHub Pages em desktop e celular

**Estratégia:** evolução em fatias jogáveis sobre a base Three.js existente

## 1. Intenção

Transformar o protótipo v1.1 em um arcade esportivo 2.0 com apresentação premium,
controles de setas mais um botão, seleção automática inteligente, IA coletiva,
personagens e animações humanas, experiência mobile landscape sem interrupções e uma
Copa curta, mantendo single-player, offline-first, GitHub Pages e uma única branch de código
(`main`).

## 2. Decisões de produto

- Sensção central: **arcade esportivo** — fácil de entender, difícil de dominar.
- Assistência: seleção automática forte e magnetismo leve; timing e direção continuam
  relevantes.
- Partida principal: 8–12 minutos, em melhor de três sets curtos.
- Modos: partida rápida e Copa Pró Vôlei curta.
- Input: setas e espaço durante o jogo; `Escape` continua reservado a pausa/sistema no PC.
- Direções: sempre relativas à tela/câmera, no teclado e no touch.
- Ação: toque seguro; segurar e soltar troca segurança por alcance, velocidade ou potência.
- Identidade: vôlei feminino, com equipes e atletas fictícias.
- Arte: transmissão esportiva premium, com realismo estilizado.
- Assets: arquivos locais originais e otimizados são permitidos; assets remotos continuam
  proibidos.
- Mobile: portrait é pausa/menu; landscape é sempre jogo em tela cheia.
- Git: desenvolvimento e histórico em `main`; deploy por GitHub Actions sem branch `gh-pages`.
- Fora de escopo: multiplayer, backend, monetização, times ou marcas licenciadas, carreira
  de gestão e wrappers nativos nesta release web.

A permissão de assets locais altera deliberadamente a regra procedural da v1.1, após autorização
explícita do proprietário nesta entrevista. Antes do primeiro asset de mídia, a Fase 1 atualiza
`CLAUDE.md`, `docs/ARCHITECTURE.md` e `docs/ROADMAP.md` para tornar a nova regra a fonte canônica:
runtime offline, zero URLs remotas, assets locais originais/licenciados e orçamento obrigatório.
Essa mesma entrega reconcilia `CONTRIBUTING.md` e os workflows com o fluxo `main`-only; nenhuma
instrução antiga de branch/PR ou deploy manual pode permanecer como caminho recomendado.

## 3. Experiência principal

### 3.1 Loop

1. O usuário abre partida rápida ou continua a Copa.
2. O time entra em formação e a partida começa sem tutorial modal.
3. Durante o rally, o jogo seleciona a atleta humana com melhor intercepção viável.
4. O usuário posiciona com as setas/joystick e executa a ação com espaço/toque.
5. Direção, duração e timing formam uma intenção; o contexto escolhe a técnica.
6. Feedback visual, sonoro e háptico explica contato perfeito, aceitável ou ruim.
7. Entre pontos há comemoração curta e não bloqueante; o próximo saque começa rápido.
8. A Copa registra resultado, estatísticas e recompensas localmente.

### 3.2 Formato da partida

A partida 2.0 é melhor de três: os dois primeiros sets vão a 11 pontos e o terceiro a 7. Todos
exigem diferença de dois, com cap em 15 nos sets iniciais e 11 no desempate; ao atingir o cap,
vence quem marcar o ponto. A duração exclui loading e pausa. O aceite usa 30 partidas completas
na dificuldade Normal, distribuídas por pelo menos dez seeds: mediana entre 8 e 12 minutos e p90
de até 15 minutos. O tuning pode mudar ritmo e erro para cumprir a faixa, mas não muda o formato.

### 3.3 Seleção automática

Um `AutoSelector` pontua candidatas por:

- tempo estimado de chegada ao ponto de contato;
- caminho e velocidade disponíveis;
- função tática e posição na rotação;
- direção de aproximação;
- atleta do toque anterior, quando a regra impede novo contato;
- custo de abandonar cobertura ou bloqueio.

A troca usa histerese e exige vantagem clara da nova candidata. Uma janela de compromisso
trava a atleta antes do contato. A assistência pode corrigir a aproximação final, mas nunca
teleporta, atravessa a rede ou executa uma jogada difícil sem input.

Uma candidata é alcançável quando o solver cinemático, usando posição, velocidade, aceleração e
velocidade máximas reais, chega ao raio técnico do contato antes do instante previsto. O raio de
assistência padrão é no máximo 0,65 m e apenas suaviza a rota. Uma troca exige score pelo menos
15% melhor, admite no máximo duas trocas por plano e é proibida nos 350 ms finais. Se a atleta
travada se tornar ilegal, o plano falha de modo explícito; não há troca milagrosa tardia.

### 3.4 Gramática de um botão

| Contexto | Toque | Segurar e soltar | Influência da direção |
|---|---|---|---|
| Saque | flutuante seguro | saque viagem/potente | alvo e profundidade |
| Recepção | manchete estável | mergulho/defesa de emergência | orienta o passe |
| Levantamento | bola alta segura | tempo rápido, mais exigente | escolhe atacante/zona |
| Ataque | largada ou ataque colocado | cortada progressivamente forte | alvo na quadra rival |
| Bloqueio | salto rápido | prepara e penetra mais, com risco de atraso | deslocamento na rede |
| Bola quebrada | toque conservador | tentativa de maior alcance | melhor opção legal |

O `ActionResolver` recebe contexto, vetor de direção, instante de pressão, duração e
instante de soltura. Ele devolve uma intenção semântica; as mecânicas executam a jogada. Isso
mantém teclado e touch equivalentes e evita eventos de DOM dentro de `game/`.

O botão segue uma máquina de estados testável:

- `idle → pressed`: registra tick, vetor e token do plano;
- soltar antes de 200 ms: resolve `tap` no tick da soltura;
- permanecer pressionado por 200 ms: entra em `charging` e normaliza carga até 1,0;
- soltar em `charging`: resolve `hold` no tick da soltura;
- pressionar até 150 ms antes de uma janela legal cria buffer consumido pelo primeiro tick legal;
- pausa, blur, portrait, fim de ponto ou troca do token do plano cancelam sem executar;
- mudança de técnica dentro do mesmo plano usa o contexto do tick de resolução; mudança de plano
  cancela a carga;
- se o contato físico chegar enquanto uma ação compatível está carregada, a ação resolve no
  contato com a carga acumulada, evitando depender de um `keyup` posterior.

Direção e tempos são amostrados por tick da simulação. A UI antecipa `tap`, `charging`, zona legal
e cancelamento por forma/cor, sem mostrar texto instrucional durante landscape.

### 3.5 Assistência e falha

- Bola simples sem espaço: contato defensivo fraco pode ocorrer, mas não produz passe ideal.
- Bola disputada sem espaço: a atleta não salva automaticamente.
- Input cedo ou tarde: a animação mostra a causa do erro e a bola reage continuamente, sem
  sorte binária escondida.
- Direção ruim: gera alvo impreciso coerente, não um erro aleatório sem leitura.
- Dificuldade acessível pode ampliar janelas, mas não muda regras ou física.

## 4. IA e comportamento coletivo

### 4.1 Team Brain

Um `TeamBrain` comum aos dois lados coordena formação base, cobertura de ataque, transição,
defesa por corredor, aproximações, bloqueio simples/duplo e recomposição. A atleta do próximo
contato recebe um plano de intercepção; as outras recebem responsabilidades táticas, evitando a
sensação atual de cinco jogadoras estáticas.

### 4.2 Opponent Brain

A CPU observa apenas estado permitido: trajetória visível, formação, histórico da partida e
tempo de reação. Ela escolhe saque, levantadora, atacante, tempo e alvo considerando espaços da
defesa. Não conhece input futuro nem altera velocidade máxima para trapacear.

As dificuldades variam principalmente em latência de percepção, qualidade de previsão,
consistência técnica, variedade tática e memória de padrões. Erros usam ruído contínuo e
determinístico por seed.

### 4.3 Balanceamento mensurável

Um simulador headless executa centenas de rallies por seed e dificuldade. Ele registra duração,
quantidade de toques, erros não forçados, side-outs, aces, bloqueios e distribuição de ataques.
As faixas iniciais da dificuldade Normal são:

- mediana de 4–8 contatos por rally;
- pelo menos 65% dos pontos decididos por ataque, bloqueio ou defesa forçada, não por erro gratuito;
- nenhuma zona recebe mais de 45% dos ataques em amostra longa;
- vantagem da CPU decorrente de decisão melhor, não de física diferente.

A amostra longa é uma bateria de no mínimo 1.000 rallies em pelo menos 20 seeds. Essas faixas são
metas de tuning, não regras de runtime.

## 5. Arte e animação

### 5.1 Pipeline de assets

- Fontes reproduzíveis em `tools/blender/` e `assets-src/` quando o tamanho permitir.
- Exportações de runtime em `public/assets/`, com manifesto e hash.
- GLB com esqueleto compartilhado, poucos submeshes e animações comprimidas.
- Texturas atlas, tamanhos por tier e compressão adequada ao browser.
- Uniformes, cabelos, tons de pele e detalhes reutilizam materiais parametrizados.
- Licença, autoria e processo de geração registrados em um manifesto.
- Nenhum carregamento por CDN, fonte web, URL de mídia ou API externa no runtime.

### 5.2 Personagens

Elisa, Heloisa e Isabela permanecem e recebem modelos reconhecíveis. Novas atletas completam
equipes fictícias com silhuetas, alturas, funções e estilos de jogo distintos. O realismo é
estilizado para preservar leitura em tela pequena e limitar custo de render.

### 5.3 Sistema de animação

Um `AthleteAnimator` separado do estado lógico usa:

- blend tree de parado, ajuste, corrida frontal/lateral e freada;
- antecipação, contato, follow-through, aterrissagem e recuperação;
- IK de dois ossos para mãos/plataforma e foot planting;
- variações de manchete, toque, mergulho, rolamento, saque, cortada, largada e bloqueio;
- animações aditivas de olhar, respiração, equilíbrio e reação;
- tempo derivado do relógio da simulação, respeitando pausa e câmera lenta.

A simulação determina o instante e o ponto de contato. IK e animação aproximam o corpo do
contato sem mover a bola para salvar uma pose.

O aceite visual usa uma galeria determinística nos viewports 568×320, 844×390 e 1920×1080. As 12
atletas devem manter silhueta/uniforme distinguíveis na câmera de rally; frames plantados não podem
deslizar o pé mais de 0,15 m; mãos ou plataforma ficam a até 0,12 m da bola nos contatos padrão;
bola, atleta selecionada e placar permanecem legíveis sem sobreposição do retângulo central de
jogo. Duas revisões visuais independentes aplicam o mesmo checklist e nenhum item alto pode ficar
aberto para a subfase ser concluída.

## 6. Direção visual, câmera e áudio

### 6.1 Transmissão premium

- Paleta principal azul-marinho, teal e coral, com contraste alto na bola e nas equipes.
- Arena com iluminação de TV, materiais PBR leves e fundo menos contrastado que a quadra.
- HUD compacto, inspirado em placar esportivo, sem instruções permanentes.
- Anel/realce da atleta controlada integrado ao piso e legível para daltonismo.
- Feedback de timing por cor, forma, som e haptics, sem depender apenas de texto.
- Partículas, shake e pós-processamento proporcionais ao tier e à importância da jogada.

### 6.2 Câmera

Durante o rally, a câmera prioriza bola, atleta controlada e espaço de destino. Mudanças de
lado preservam a correspondência tela→input. Safe framing considera HUD, controles, aspect ratio
e salto. Spike cam e FOV punch são curtos; replay só ocorre no PC e pode ser desativado. O modo
reduzir movimento limita shake, zoom e cortes.

### 6.3 Áudio

O `AudioMixer` separa master, efeitos, torcida e música; persiste volumes e aplica limitador.
Impactos recebem panorama/atenuação leves, torcida reage ao contexto e sequências musicais usam
um scheduler do Web Audio, sem dezenas de `setTimeout`. Som, flash e vibração compartilham o mesmo
evento de gameplay para permanecer sincronizados.

## 7. Experiência mobile

### 7.1 Regra de orientação

Em dispositivos de toque primário:

- `portrait`: a simulação pausa, inputs são liberados, áudio é reduzido e aparece a área de
  menu com instrução para girar, novo jogo, Copa, opções e sair;
- `landscape`: menu e overlays bloqueantes desaparecem, a partida inicia ou retoma
  automaticamente e o canvas ocupa o viewport seguro;
- primeira abertura diretamente em landscape: usa preferências salvas ou inicia partida rápida
  Normal com configuração padrão;
- fim de set/partida: resultado aparece de forma compacta e a continuidade é automática; escolhas
  de meta ficam para portrait.

Ao terminar uma partida rápida em landscape, uma contagem curta inicia a revanche com as mesmas
configurações. Na Copa, o próximo confronto elegível começa após um resumo compacto; a chave e as
recompensas detalhadas ficam disponíveis em portrait. Girar antes da contagem interrompe a
continuidade e abre o menu. No browser, “sair” encerra a partida e volta ao título — não tenta
fechar a aba; wrappers nativos poderão mapear essa intenção à navegação da plataforma no futuro.

A Screen Orientation API é usada apenas como melhoria progressiva, pois o browser não garante
lock sem fullscreen. CSS media queries e eventos de viewport são a fonte de verdade.

### 7.2 Layout dos polegares

- Direcional analógico flutuante no terço direito.
- Zona de ação grande e transparente no terço esquerdo.
- Centro, rede, bola, placar e zonas prováveis de contato ficam livres.
- Multitouch usa ponteiros independentes; perder foco, orientação ou captura libera tudo.
- Não existe botão de pausa em landscape; girar para portrait pausa.
- Safe areas e telas de 568×320 até tablets recebem layouts testados explicitamente.

## 8. Copa, persistência e acessibilidade

### 8.1 Copa Pró Vôlei

A Copa tem chave curta, adversárias com identidades táticas, progressão de dificuldade e final.
Recompensas liberam uniformes, paletas, quadras e efeitos cosméticos; nenhuma recompensa altera
física ou dá vantagem competitiva. Partida rápida permanece disponível sem progressão.

A campanha contém quatro partidas — classificatória, quartas, semifinal e final — e pode ser
concluída em sessões independentes. Perder permite repetir o confronto atual; vencer grava o
avanço antes de iniciar a próxima tela ou partida.

### 8.2 Save local

Um `SaveRepository` versionado persiste preferências, Copa, estatísticas e desbloqueios no
`localStorage`. Migrações são puras e testadas. Dados ausentes, antigos ou corrompidos voltam a
defaults seguros sem impedir o jogo; o usuário pode apagar o progresso em portrait/menu.

### 8.3 Acessibilidade

- presets de daltonismo e contraste;
- escala do HUD;
- reduzir movimento e desabilitar shake/replay;
- volumes separados, legendas curtas de apito/evento e haptics opcionais;
- janelas de timing acessíveis sem alterar a física da CPU;
- navegação de menus com setas+espaço, touch e sem armadilhas de foco.

## 9. Arquitetura

### 9.1 Fluxo de dados

```text
KeyboardInput / TouchInput
          │
          ▼
       InputFrame  ── CameraSpaceMapper ──► HumanIntent
          │                                      │
          └── ActionResolver / AutoSelector ──────┘
                              │
                              ▼
         Fixed-step Match Simulation + TeamBrain + OpponentBrain
                              │
                        Domain Events
                              │
       ┌───────────────┬───────────────┬──────────────┐
       ▼               ▼               ▼              ▼
 AthleteAnimator   CameraDirector     HUD/Effects      Audio/Haptics
```

### 9.2 Limites

- `game/` depende apenas de contratos neutros e lógica pura; não importa DOM, UI, WebGL,
  áudio ou classes concretas do mundo.
- Ports, DTOs e eventos saem de `Match.ts` para um módulo de contratos.
- `Match` permanece orquestrador; novos sistemas não aumentam o monólito.
- Tuning fica em `core/constants.ts` ou perfis tipados dedicados, nunca em números espalhados.
- RNG injetável e seed tornam IA, rallies e testes reproduzíveis.
- Render e animação consomem snapshots/eventos; não mudam regra ou física.
- Persistência e plataforma ficam atrás de interfaces para futura reutilização por
  Tauri/Capacitor.

### 9.3 Tempo de simulação

A partida usa timestep fixo de 60 Hz com acumulador, limite de recuperação e interpolação
visual. Eventos balísticos continuam resolvidos no instante analítico. Queda no piso é avaliada
no ponto exato de cruzamento, eliminando classificação dentro/fora dependente de FPS. Pausa,
blur e orientação limpam estados de input e cargas pendentes.

O acumulador aceita no máximo 250 ms de tempo real e executa no máximo cinco substeps por frame;
excesso após stall é descartado e registrado em métrica de diagnóstico. Inputs recebem timestamp
monotônico e são consumidos no primeiro tick cujo tempo de simulação os alcança. Dentro de cada
tick, a ordem é: consumir input, atualizar intenções/planos, ordenar e resolver contatos, rede,
bloqueio e chão pelo instante analítico, integrar o restante, aplicar pontuação e emitir eventos.
Câmera lenta escala o tempo acrescentado ao acumulador; o passo interno permanece 1/60 s. Pausa
acrescenta zero. Mesma seed e mesmos inputs devem produzir o mesmo resultado renderizando a 30,
60 ou 120 Hz; há teste automatizado para essa invariância.

## 10. Performance e compatibilidade

### 10.1 Tiers

| Recurso | Baixo | Médio | Alto |
|---|---|---|---|
| DPR | 1,0–1,25 | 1,5 | até 2,0 |
| Sombras | blob + seletivas | PCF seletiva | VSM/PCF de alta resolução |
| Torcida | baixa densidade, animação reduzida | instancing completo | densidade e variação maiores |
| Pós | desligado | FXAA/color grading leve | bloom/grade opcional |
| Partículas | reduzidas | padrão | completas |

O `QualityManager` escolhe tier inicial por capacidade e mede frame time. Ajustes automáticos
usam histerese e ocorrem entre pontos, nunca durante o rally.

### 10.2 Orçamentos de release

- Alvo: 60 fps em desktop e celular intermediário; piso de 30 fps estável no tier baixo.
- p95 de frame: até 16,7 ms no alvo e até 33,3 ms no piso.
- Draw calls: até 180 no mobile médio e 250 no desktop alto durante rally.
- Triângulos: até 250 mil no mobile médio e 500 mil no desktop alto durante rally.
- Memória: após cinco minutos de aquecimento, crescimento de heap de no máximo 10% nos 25
  minutos seguintes, sem tendência monotônica em três amostras consecutivas.
- Bundle JS inicial: até 250 kB gzip; assets pesados carregados por manifesto.
- Payload inicial completo: até 10 MB comprimidos, com cache offline posterior.
- Primeira interação: até 4 s em cold cache no perfil Fast 4G do Chrome (1,6 Mbps down, 750 Kbps
  up, RTT 150 ms) e até 2 s em warm cache.

As referências físicas são Galaxy A52/Snapdragon 720G no Chrome corrente para o alvo mobile médio,
iPhone 12 no Safari corrente para compatibilidade iOS e um desktop integrado Intel UHD 620 no
Chrome corrente para o piso desktop. CI headless protege regressões relativas; o gate final exige
medição física nesses aparelhos ou equivalentes documentados.

Os números são gates de regressão. Se um asset exigir excedê-los, deve haver ganho visual
demonstrável e decisão documentada.

### 10.3 Web resiliente

- loading curto com progresso real;
- fallback claro para WebGL indisponível;
- tratamento de `webglcontextlost` e restauração/reinício seguro;
- PWA com manifest e service worker versionado;
- fallback de preferências quando storage estiver bloqueado;
- suporte testado nas versões correntes de Chrome, Edge, Firefox e Safari/iOS.

O service worker usa caches nomeados por versão e ativação atômica: app shell, código, modelos,
animações, áudio e todo conteúdo essencial de partida rápida e Copa são precacheados antes de
mostrar “disponível offline”. Cosméticos opcionais podem ser lazy, sempre com fallback precacheado.
O gate executa: cache limpo online → service worker ativo → rede desligada → reload → partida
rápida completa e Copa completa. Um cache nunca mistura assets de duas versões.

## 11. Erros e recuperação

- Falha de asset essencial: tenta variante de tier inferior; se impossível, mostra erro em
  portrait/menu e preserva o save.
- Falha cosmética: usa material/modelo padrão e continua.
- Perda de contexto WebGL: pausa, libera input e tenta recriar recursos uma vez.
- Save inválido: migra ou isola o registro e inicia defaults; nunca trava o bootstrap.
- Áudio suspenso pelo browser: retoma na próxima interação permitida.
- PWA com versão nova: atualiza apenas em portrait/menu ou após a partida.
- Erro inesperado: boundary de app pausa a simulação e oferece reinício seguro.

## 12. Testes e verificação

### 12.1 Pirâmide

- **Vitest puro:** mapeamento tela→mundo, gramática de ação, auto-seleção, timing,
  regras, migrações, qualidade adaptativa e decisões da IA.
- **Simulação headless:** rally completo saque→recepção→levantamento→ataque→ponto,
  seeds, dificuldades, linhas, rede, bloqueio e métricas.
- **Playwright desktop:** bootstrap de produção, menus, partida, pausa, fim e recuperação.
- **Playwright mobile landscape:** viewports 568×320, 667×375, 844×390 e tablet; taps,
  drags e dois ponteiros reais; hit-testing e safe areas.
- **Orientação:** portrait pausa e mostra menu; landscape oculta bloqueios e retoma.
- **Visual:** screenshots de HUD/menu e inspeção de cena; pixel diff de WebGL só em cenas
  determinísticas e com tolerância.
- **Performance:** bundle, startup, draw calls, triângulos, frame p95 e memória longa.
- **Dispositivo físico:** pelo menos um Android intermediário e um iPhone antes do 2.0.0.

### 12.2 Gates

Cada fatia executa `typecheck`, lint, format check, Vitest, build e smoke apropriado. O CI testa
o `dist/` com `vite preview`, não apenas o dev server. Configurações e testes entram no typecheck.
Cobertura recebe thresholds graduais sem premiar asserts fracos.

Antes de cada afirmação de conclusão: diff revisado, testes relevantes verdes e playtest real.
O release exige a matriz completa, auditoria de assets remotos e comparação com o baseline.

## 13. Entrega e GitHub Pages

### 13.1 Fluxo main-only

- Somente `main` recebe código; não há branches de feature nem PRs.
- Mudanças são seriais, pequenas e atômicas; cada commit deixa o jogo verde e jogável.
- Agentes paralelos fazem auditorias independentes ou trabalham em arquivos não sobrepostos;
  integração e commits continuam seriais.
- Force-push e reescrita de histórico são proibidos.
- O push ocorre somente após gates locais; CI confirma o mesmo SHA.
- Se o CI remoto falhar após push, todo trabalho novo para; o próximo commit deve corrigir ou
  reverter atomicamente a causa, sem amend/force-push. O Pages não promove o SHA vermelho e mantém
  o último artefato verde; o incidente e o rollback ficam registrados.

### 13.2 Pages

GitHub Actions constrói e publica o artefato testado diretamente no ambiente Pages. Depois de
validar o novo pipeline e o rollback, a branch operacional `gh-pages` antiga é removida. A tela
de opções exibe versão e SHA curtos para confirmar o deploy.

### 13.3 Fases

1. **Baseline e release engineering:** 1A sincroniza regras/docs; 1B amplia typecheck e smoke de
   `dist`; 1C cria deploy Actions e valida rollback; 1D remove o caminho `gh-pages` legado.
2. **Control spine e game feel:** 2A cria `InputFrame`; 2B implementa timestep fixo; 2C adiciona
   `AutoSelector`; 2D entrega a máquina de um botão; 2E integra feedback e câmera.
3. **IA coletiva:** 3A cria simulação headless/RNG; 3B formações e cobertura; 3C escolhas táticas
   da CPU; 3D métricas e tuning das dificuldades.
4. **Personagens e render:** 4A prova de um atleta/rig dentro do orçamento; 4B locomotion/IK; 4C
   variantes de elenco; 4D arena premium; 4E quality tiers e otimização.
5. **Mobile e áudio:** 5A orientation gate; 5B layout/hit-testing multitouch; 5C HUD compacto; 5D
   mixer/haptics; 5E PWA e aceite offline.
6. **Copa e acessibilidade:** 6A save/migrações; 6B chave e adversárias; 6C recompensas; 6D opções
   e presets de acessibilidade.
7. **Polimento e release 2.0.0:** 7A balanceamento; 7B matriz/performance física; 7C auditoria de
   release; 7D changelog/tag/deploy/smoke público.

Cada subfase é uma fatia publicável com testes, playtest e orçamento próprios; seu plano detalhado
lista arquivos e Definition of Done antes da implementação. “Playtest real” significa executar o
build no navegador, completar ao menos um rally do fluxo alterado, inspecionar console e capturar
estado/screenshot nos viewports afetados. Se uma fase revelar que o plano seguinte precisa mudar,
o plano é atualizado antes de alterar código; não se improvisa sobre arquivos quentes.

## 14. Critérios de aceitação da 2.0

1. Durante o rally no PC, todas as jogadas usam somente setas e espaço; menus também são
   navegáveis com eles.
2. Teclado e touch produzem intenções equivalentes e relativas à tela em toda câmera.
3. A atleta automática escolhida é uma interceptadora alcançável, sem troca tardia instável.
4. Toque, hold, direção e timing geram resultados distintos e previsíveis em todas as fases.
5. Companheiras e CPU cobrem, transitam, bloqueiam e atacam como equipe 6×6.
6. A dificuldade não altera a física nem concede informação futura à CPU.
7. Personagens usam rig, locomotion blend, antecipação, contato e recuperação coerentes.
8. A cena atinge identidade de transmissão premium e preserva leitura de bola/atleta.
9. No celular, portrait pausa e mostra menus; landscape joga em full-bleed sem overlay bloqueante.
10. Direcional direito e ação esquerda funcionam simultaneamente nos viewports-alvo.
11. Partida rápida e uma Copa completa funcionam e persistem localmente.
12. O jogo atende os orçamentos de performance ou registra exceção aprovada com evidência.
13. O build funciona offline após primeiro carregamento e não usa assets remotos.
14. CI verifica tipos, lint, formato, testes, build e smoke do artefato de produção.
15. O GitHub Pages publica automaticamente o SHA aprovado da `main`, sem branch de deploy.
16. `package.json`, changelog, tag e UI identificam a versão `2.0.0` final.

## 15. Riscos e respostas

- **Qualidade de personagem versus performance:** um esqueleto, poucos submeshes, atlas e tiers;
  validar silhueta e custo antes de produzir todo o elenco.
- **Um botão parecer inconsistente:** contrato semântico, feedback antecipado e matriz de ações
  testada; nenhuma combinação escondida.
- **Trocas automáticas retirarem controle:** score explicável, histerese, lock e assistência
  configurável.
- **IA complexa ficar cara:** decisões em frequência baixa e navegação analítica simples,
  sem pathfinding geral por frame.
- **Escopo 2.0 crescer indefinidamente:** seguir as sete fases e manter fora de escopo tudo que
  não serve ao single-player web.
- **Main ficar instável:** commits atômicos, gates locais, playtest por fatia e push apenas verde.
- **Pages divergir do código:** deploy por SHA, versão visível e smoke na URL publicada.
- **Browsers mobile variarem em orientação/áudio:** progressive enhancement, eventos de
  viewport como fonte de verdade e matriz real de aparelhos.

## 16. Resultado esperado

O Pró Vôlei 2.0 deve parecer um novo jogo, não apenas um skin: atletas humanas, bola e contatos
legíveis, equipes que pensam, controle simples com profundidade, arena de transmissão e uma
experiência de dois polegares que entra e permanece em jogo. A evolução preserva a base de regras
e testes que já funciona, tornando cada salto verificável e publicável.
