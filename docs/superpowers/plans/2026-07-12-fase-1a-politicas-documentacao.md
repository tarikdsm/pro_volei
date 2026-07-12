# Fase 1A — Políticas e Documentação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar as instruções canônicas do repositório coerentes com o design 2.0 aprovado: assets locais offline, fluxo main-only e roadmap sem informações obsoletas.

**Architecture:** Um teste-guarda puro lê as fontes de política e impede a volta das duas contradições encontradas na auditoria: “tudo deve ser procedural” e “use branch/PR”. As mudanças são documentais e de CI, sem alterar runtime, gameplay ou o deploy legado nesta subfase.

**Tech Stack:** TypeScript 6, Vitest 4, Markdown, GitHub Actions YAML, Node.js 22.

## Global Constraints

- `CLAUDE.md` é a fonte única de instruções do projeto e deve ser lido antes de cada tarefa.
- Single-player contra CPU; não adicionar multiplayer, backend ou netcode.
- Runtime offline-first: zero assets remotos; assets locais originais/licenciados são permitidos e devem respeitar orçamento.
- Somente `main` recebe código; sem branches de feature, PR, amend, force-push ou reescrita de histórico.
- O deploy `gh-pages` atual é uma exceção operacional temporária e só será removido na Fase 1D.
- Cada commit deve deixar `npm run check` verde.
- Esta subfase não altera `src/`, `package.json`, o script `npm run deploy` nem a configuração Pages remota.

## File Map

- Create `tests/docs/project-policy.test.ts`: guarda executável das políticas de assets e Git.
- Modify `CLAUDE.md`: fonte canônica das novas regras 2.0.
- Modify `CONTRIBUTING.md`: fluxo main-only e política de assets para contribuidores/agentes.
- Modify `.github/workflows/ci.yml`: remover o gatilho e a terminologia de PR.
- Modify `README.md`: distinguir o runtime procedural atual da política permitida para a 2.0.
- Modify `docs/ARCHITECTURE.md`: remover contagem obsoleta e registrar o pipeline local de assets.
- Modify `docs/ROADMAP.md`: marcar o design 2.0 aprovado e apontar para as sete fases/subfases.
- Modify `CHANGELOG.md`: registrar a aprovação do design e a mudança de política sem afirmar implementação.

---

### Task 1: Política canônica de assets locais offline

**Files:**

- Create: `tests/docs/project-policy.test.ts`
- Modify: `CLAUDE.md` (seções “O que é” e “Convenções”)
- Modify: `CONTRIBUTING.md` (seção “Estilo de código”)
- Modify: `README.md` (parágrafo “Funciona 100% offline”)

**Interfaces:**

- Consumes: design aprovado em `docs/superpowers/specs/2026-07-12-pro-volei-2-0-design.md`, seção 2.
- Produces: teste `política de assets locais` e a frase canônica `Assets de runtime devem ser locais`.

- [ ] **Step 1: Escrever o teste que expõe a política obsoleta**

Criar `tests/docs/project-policy.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const readRepo = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

describe('políticas canônicas do projeto', () => {
  it('permite assets locais sem relaxar a regra offline', () => {
    const claude = readRepo('CLAUDE.md');
    const contributing = readRepo('CONTRIBUTING.md');

    expect(claude).toContain('Assets de runtime devem ser locais');
    expect(claude).toContain('zero URLs remotas em runtime');
    expect(claude).toContain('autoria ou licença registrada');
    expect(contributing).toContain('Assets locais');
    expect(contributing).not.toContain('Tudo é gerado em runtime');
  });
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha correta**

Run:

```bash
npx vitest run tests/docs/project-policy.test.ts
```

Expected: FAIL em `toContain('Assets de runtime devem ser locais')`; a política ainda não foi atualizada.

- [ ] **Step 3: Atualizar a fonte canônica e os guias**

Em `CLAUDE.md`, substituir a descrição procedural absoluta por:

```markdown
Roda 100% offline. A v1.1 usa geometria procedural, texturas em canvas e áudio sintetizado;
a versão 2.0 também pode usar assets locais otimizados e versionados.
```

Substituir o bullet “Nada de assets remotos” por:

```markdown
- **Assets de runtime devem ser locais.** É proibido carregar CDN, fonte, imagem, modelo,
  áudio, vídeo ou API por URL: **zero URLs remotas em runtime**. Assets locais são permitidos
  quando forem originais ou tiverem autoria ou licença registrada, manifesto, orçamento e
  fallback. A geometria procedural existente continua válida; não é mais uma obrigação para
  toda arte nova.
```

Em `CONTRIBUTING.md`, substituir o bullet offline-first por:

```markdown
- **Offline-first:** nunca carregue asset por URL remota. Assets locais originais/licenciados
  podem ser adicionados com manifesto de autoria/licença, compressão, orçamento e fallback.
  Toda mudança de asset deve passar pelo teste `tests/docs/no-remote-assets.test.ts` e pelos
  gates de performance aplicáveis.
```

Em `README.md`, preservar a verdade sobre a release atual e acrescentar a direção 2.0:

```markdown
A release atual funciona **100% offline** depois do `npm install`: geometria procedural,
texturas em canvas e áudio via Web Audio API, sem downloads remotos em runtime. O design 2.0
também permite modelos, texturas e sons locais otimizados; a regra de zero assets remotos permanece.
```

- [ ] **Step 4: Formatar e executar os guardas de documentação**

Run:

```bash
npx prettier --write CLAUDE.md CONTRIBUTING.md README.md tests/docs/project-policy.test.ts
npx vitest run tests/docs/project-policy.test.ts tests/docs/no-remote-assets.test.ts
```

Expected: 2 arquivos de teste verdes; 3 testes passam.

- [ ] **Step 5: Executar o gate completo e commitar**

Run:

```bash
npm run check
git diff --check
git add CLAUDE.md CONTRIBUTING.md README.md tests/docs/project-policy.test.ts
git commit -m "docs(assets): permite mídia local offline na versão 2.0"
```

Expected: 33 arquivos Vitest verdes, 268 testes, commit somente nos quatro arquivos listados.

---

### Task 2: Fluxo main-only executável e sem instruções de PR

**Files:**

- Modify: `tests/docs/project-policy.test.ts`
- Modify: `CLAUDE.md` (nova seção “Git e entrega”)
- Modify: `CONTRIBUTING.md` (seções “Fluxo de trabalho” e “Commits”)
- Modify: `.github/workflows/ci.yml` (gatilhos e comentário de concorrência)

**Interfaces:**

- Consumes: helper `readRepo(path: string): string` criado na Task 1.
- Produces: política testada `Fluxo main-only` e CI disparado somente por push em `main`.

- [ ] **Step 1: Ampliar o teste com as invariantes de Git**

Adicionar ao mesmo `describe` em `tests/docs/project-policy.test.ts`:

```ts
  it('define main-only sem branches de feature ou PR', () => {
    const claude = readRepo('CLAUDE.md');
    const contributing = readRepo('CONTRIBUTING.md');
    const ci = readRepo('.github/workflows/ci.yml');

    expect(claude).toContain('Fluxo main-only');
    expect(contributing).toContain('commits diretamente em `main`');
    expect(contributing).not.toContain('git checkout -b');
    expect(contributing).not.toContain('Abra PR');
    expect(ci).not.toMatch(/^\s*pull_request:/m);
    expect(ci).not.toContain('branch/PR');
  });
```

- [ ] **Step 2: Executar o teste e confirmar que as instruções antigas falham**

Run:

```bash
npx vitest run tests/docs/project-policy.test.ts
```

Expected: FAIL porque `CONTRIBUTING.md` ainda contém `git checkout -b` e `Abra PR`.

- [ ] **Step 3: Tornar a política main-only explícita**

Adicionar a `CLAUDE.md`:

```markdown
## Git e entrega

- **Fluxo main-only:** código e documentação recebem commits diretamente em `main`; não crie
  branch de feature nem PR. A branch `gh-pages` é uma exceção gerada pelo deploy legado e será
  removida na Fase 1D.
- Antes de cada commit e push, rode os gates do escopo; commits devem ser pequenos e atômicos.
- Nunca use amend, force-push ou reescrita de histórico. Se o CI remoto falhar, pare trabalho novo
  e faça o próximo commit corrigir ou reverter a causa.
```

Substituir a lista “Fluxo de trabalho” de `CONTRIBUTING.md` por:

```markdown
1. Trabalhe na checkout de `main` e confirme `git status` antes de editar.
2. Desenvolva com testes e valide o comportamento real no browser quando aplicável.
3. Antes de commitar e fazer push, rode `npm run check` e os testes E2E do escopo.
4. Faça commits diretamente em `main`, pequenos e atômicos. O CI valida o SHA enviado.
5. Se o CI remoto falhar, interrompa trabalho novo e corrija ou reverta em novo commit.
```

Na seção “Commits”, acrescentar:

```markdown
- O projeto usa commits diretamente em `main`, sem PR, amend ou force-push.
```

Em `.github/workflows/ci.yml`, manter somente:

```yaml
on:
  push:
    branches: [main]

# Cancela execuções antigas de main quando um novo push chega
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 4: Formatar e executar o teste de política**

Run:

```bash
npx prettier --write CLAUDE.md CONTRIBUTING.md .github/workflows/ci.yml tests/docs/project-policy.test.ts
npx vitest run tests/docs/project-policy.test.ts
```

Expected: 2 testes passam.

- [ ] **Step 5: Executar gate completo, revisar diff e commitar**

Run:

```bash
npm run check
git diff --check
git diff -- CLAUDE.md CONTRIBUTING.md .github/workflows/ci.yml tests/docs/project-policy.test.ts
git add CLAUDE.md CONTRIBUTING.md .github/workflows/ci.yml tests/docs/project-policy.test.ts
git commit -m "docs(git): adota fluxo main-only sem PR"
```

Expected: 269 testes passam; diff não contém mudança de job/steps do CI além de gatilho/comentário.

---

### Task 3: Arquitetura, roadmap e changelog sem drift

**Files:**

- Modify: `tests/docs/project-policy.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: design 2.0 aprovado e políticas canônicas das Tasks 1–2.
- Produces: documentação de arquitetura/roadmap alinhada e teste contra contagem obsoleta.

- [ ] **Step 1: Escrever o teste contra drift conhecido**

Adicionar ao `describe` em `tests/docs/project-policy.test.ts`:

```ts
  it('aponta arquitetura e roadmap para o design 2.0 sem contagem obsoleta', () => {
    const architecture = readRepo('docs/ARCHITECTURE.md');
    const roadmap = readRepo('docs/ROADMAP.md');

    expect(architecture).not.toContain('~490 linhas');
    expect(architecture).toContain('Pipeline local de assets 2.0');
    expect(roadmap).toContain('Design 2.0 aprovado');
    expect(roadmap).toContain('2026-07-12-pro-volei-2-0-design.md');
    expect(roadmap).toContain('Fase 1A');
  });
```

- [ ] **Step 2: Executar e confirmar a falha por documentação desatualizada**

Run:

```bash
npx vitest run tests/docs/project-policy.test.ts
```

Expected: FAIL em `architecture.not.toContain('~490 linhas')` e nas novas âncoras 2.0.

- [ ] **Step 3: Atualizar arquitetura sem fixar nova contagem frágil**

Em `docs/ARCHITECTURE.md`, substituir referências a “~490 linhas” por:

```markdown
`Match` é o orquestrador de state machine/event queue. Ele está acima do tamanho-alvo e não deve
crescer; novos contratos, seletores, input e IA entram em módulos focados e testáveis.
```

Adicionar após a estrutura de camadas:

```markdown
### Pipeline local de assets 2.0

A v1.1 continua procedural. A 2.0 pode carregar GLB, texturas e áudio versionados em
`public/assets/`, sempre por caminhos locais e manifesto. Fontes reproduzíveis vivem em
`assets-src/` ou `tools/`; o runtime nunca busca CDN/API. Render/animação consomem snapshots e
eventos da simulação, sem alterar regras ou física.
```

- [ ] **Step 4: Atualizar roadmap e changelog sem afirmar features prontas**

No topo de `docs/ROADMAP.md`, substituir o estado atual por:

```markdown
Estado atual: **v1.1.0** jogável e corrigida. **Design 2.0 aprovado** em
[`2026-07-12-pro-volei-2-0-design.md`](superpowers/specs/2026-07-12-pro-volei-2-0-design.md).
A execução segue subfases publicáveis: Fase 1A políticas/docs; 1B gates; 1C deploy Actions; 1D
remoção de `gh-pages`; depois controles, IA, arte/render, mobile/áudio, Copa e release 2.0.0.
```

Na Fase 0, substituir a pendência incompatível de branch protection por:

```markdown
- [ ] Configurar proteção compatível com main-only: bloquear force-push/deleção sem exigir PR.
```

Adicionar em `CHANGELOG.md`, em `[Não lançado] > Alterado`:

```markdown
- Design da versão 2.0 aprovado: controles de setas + ação contextual, IA coletiva,
  personagens locais animados, experiência mobile landscape e Copa curta. A implementação ocorre
  em fases; esta entrada não anuncia essas features como disponíveis na v1.1.
- Política offline permite assets locais originais/licenciados e continua proibindo URLs remotas
  em runtime.
```

- [ ] **Step 5: Formatar, executar guardas e commitar**

Run:

```bash
npx prettier --write docs/ARCHITECTURE.md docs/ROADMAP.md CHANGELOG.md tests/docs/project-policy.test.ts
npx vitest run tests/docs/project-policy.test.ts tests/docs/no-remote-assets.test.ts
npm run check
git diff --check
git add docs/ARCHITECTURE.md docs/ROADMAP.md CHANGELOG.md tests/docs/project-policy.test.ts
git commit -m "docs(roadmap): alinha arquitetura ao design 2.0"
```

Expected: 270 testes passam; roadmap continua declarando v1.1.0 como release disponível e 2.0 como design em execução.

---

## Phase Completion Gate

- [ ] `rg -n "git checkout -b|Abra PR|Tudo é gerado em runtime|~490 linhas" CLAUDE.md CONTRIBUTING.md docs/ARCHITECTURE.md` não encontra política obsoleta.
- [ ] `npx vitest run tests/docs/project-policy.test.ts tests/docs/no-remote-assets.test.ts` passa 5 testes.
- [ ] `npm run check` passa 33 arquivos e 270 testes.
- [ ] `npm run build` termina com exit 0.
- [ ] `git log -3 --oneline` mostra os três commits atômicos da subfase.
- [ ] `git status --short` está vazio.
- [ ] Nenhum arquivo em `src/`, `package.json` ou `package-lock.json` mudou.
- [ ] Um revisor independente confirma aderência à spec e ausência de afirmações falsas sobre features 2.0 ainda não implementadas.
