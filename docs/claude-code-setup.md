# Setup do Claude Code para o Pró Volei

Automações recomendadas para desenvolver este projeto com o Claude Code. Ordenadas por
valor para **um jogo web em Three.js/TS que vai para Web + Desktop/Steam + Mobile**.

> **Estado atual:** Playwright, skill `playtest` e hook de formatação já foram adotados. As Fases
> 1–2 e subfases 3A–3C estão concluídas; o desenvolvimento está pausado antes da 3D. Este documento registra o
> setup disponível, não autoriza iniciar automações ou fases novas.

## Perfil do projeto

- **Tipo:** app web SPA, TypeScript strict + Vite 8
- **Render:** Three.js r185 (WebGL)
- **Testes:** Vitest · **Lint/format:** ESLint + Prettier · **CI:** GitHub Actions
- **Alvos:** Web (atual), Desktop/Steam (Tauri), Mobile (Capacitor)

---

## 🔌 MCP Servers

### 1. context7 — ✅ já conectado

Documentação atualizada de bibliotecas. **Crítico aqui** porque o projeto usa versões de ponta
(Three.js r185, Vite 8, TypeScript 6) onde o conhecimento do modelo pode estar desatualizado.
Já está ativo nesta sessão — nenhuma ação necessária.

### 2. Playwright MCP — ✅ adotado no fluxo

Deixa o Claude **dirigir o jogo num browser real**: abrir, clicar em menus, jogar, tirar
screenshots e ler erros do console. O protótipo foi finalizado num loop "rodar → screenshot →
corrigir" — este MCP automatiza exatamente isso e foi usado nas verificações até a Fase 3C.

```bash
claude mcp add playwright -- npx @playwright/mcp@0.0.77
```

---

## 🎯 Skills

### Já disponíveis (usar, não criar)

- **superpowers:test-driven-development** — escrever teste antes de mover código na refatoração.
- **superpowers:systematic-debugging** — achar causa raiz de bug de gameplay antes de "consertar".
- **superpowers:brainstorming** — desenhar features novas (modos, progressão) na Fase 2.
- **/code-review** e **verify** — revisar diffs e verificar mudanças de ponta a ponta.

### Específicas do projeto

#### `playtest` — ✅ criada
Build + sobe o dev server + dirige o jogo via Playwright + captura screenshots + reporta erros
de console. Um comando para validar qualquer mudança de gameplay/visual.

- **Onde:** `.claude/skills/playtest/SKILL.md`
- **Invocação:** usuário (`/playtest`) — tem efeitos colaterais (sobe servidor)

#### `tune` — futura, não criada
Guia para ajustar os parâmetros de jogo em `core/constants.ts` (gravidade, dificuldades,
alturas de contato, velocidades) com contexto de cada "botão" e do impacto esperado.

- **Onde:** `.claude/skills/tune/SKILL.md`
- **Invocação:** ambos

---

## ⚡ Hooks

### 1. Formatar ao salvar — mais recomendado
`PostToolUse` em `Edit|Write` de `*.ts`/`*.css` roda `prettier --write` no arquivo alterado.
Mantém tudo formatado e evita que o `format:check` do CI falhe.

- **Onde:** `.claude/settings.json`
- **Efeito:** nenhuma mudança de formatação escapa; diffs sempre limpos.

### 2. Guardar arquivos gerados
`PreToolUse` que bloqueia edição manual de `package-lock.json` e `dist/` (são gerados).

> Os formatos exatos de hook variam; peça "configure o hook de format-on-save" que eu uso a
> skill **update-config** para escrever o `settings.json` correto.

---

## 🤖 Subagents

### 1. `threejs-perf-reviewer` — recomendado (mobile é alvo)
Revisa diffs procurando gargalos de WebGL: alocações dentro do game loop, `new` por quadro,
draw calls, texturas grandes, geometria não reaproveitada. Continua recomendado para a futura
fase de render/performance, atualmente pausada.

- **Onde:** `.claude/agents/threejs-perf-reviewer.md`

### 2. Revisão de código
Use revisão independente antes de cada fechamento. O projeto é main-only: revisões avaliam o diff
local antes do commit direto em `main`; não crie PR ou branch de feature.

---

## Prioridade de adoção

1. **Playwright MCP** — habilita verificação real do jogo (útil já na refatoração).
2. **Hook de format-on-save** — higiene automática, CI sempre verde.
3. **Skill `playtest`** — empacota o loop de verificação num comando.
4. **Subagent `threejs-perf-reviewer`** — quando começar o trabalho de performance/mobile.

> Não adotar itens restantes durante a pausa. Ao retomar, revalidar versões e prioridade antes de
> alterar `.claude/` ou instalar novas dependências.
