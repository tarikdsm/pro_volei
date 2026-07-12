# Fase 1B — Gates de Produção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o gate local e o CI cobrirem toda a superfície TypeScript, cobertura mínima de todo `src` e um smoke real do artefato `dist/` servido por `vite preview`.

**Architecture:** Configuração e testes recebem contratos executáveis em `tests/config/`. Playwright passa a compartilhar uma factory tipada entre servidor dev e preview, enquanto o smoke de produção evita costuras DEV. O CI usa o mesmo `npm run check`, constrói uma vez e testa o `dist/` em Chromium.

**Tech Stack:** TypeScript 6, Vitest 4.1.10, V8 coverage, Playwright 1.61.1, Vite 8.1.3, Node 22, GitHub Actions.

## Global Constraints

- `CLAUDE.md` é a fonte única e deve ser lido antes de cada tarefa.
- Fluxo main-only: commits diretamente em `main`, sem branch, PR, amend ou force-push.
- Single-player offline; não alterar gameplay, UI, regras, assets ou deploy nesta subfase.
- Zero URLs remotas em runtime.
- `@types/node` deve permanecer na linha 22: `^22.20.1`.
- `@vitest/coverage-v8` deve acompanhar Vitest: `^4.1.10`.
- Cobertura inclui todo `src/**/*.ts`, exclui testes/specs e `vite-env.d.ts`; threshold inicial exato de 30% para statements, branches, functions e lines.
- Smoke de produção usa `vite preview` na porta dedicada 5199 e Chromium; não usa `window.__match` nem `?debug`.
- CI oficial usa `actions/checkout@v5` e `actions/setup-node@v6` para runtime Node 24 das actions, mantendo Node 22 do projeto via `.nvmrc`.
- Cada commit roda `npm run check`; tasks de E2E também rodam build e smoke de produção.

## Baseline Medido

Em 2026-07-12, com provider V8 4.1.10 e `include: ['src/**/*.ts']`:

- Statements: 34,63% (836/2414)
- Branches: 39,62% (342/863)
- Functions: 35,08% (120/342)
- Lines: 34,46% (782/2269)

O threshold 30% mede arquivos ainda não importados pelos testes e deixa margem inicial sem
permitir regressão silenciosa. A Fase 2 elevará os números ao testar control spine e Match.

## File Map

- Create `tests/config/typecheck-scope.test.ts`: contrato de escopo e tipos Node.
- Modify `tsconfig.json`: incluir `tests` e configs raiz; declarar tipos Node/Vite.
- Modify `package.json`, `package-lock.json`: adicionar tipos Node, coverage e scripts.
- Create `tests/config/coverage-gate.test.ts`: contrato de provider/include/thresholds.
- Modify `vitest.config.ts`: cobertura V8 de toda produção.
- Create `tests/e2e/playwrightConfig.ts`: factory única de configuração dev/preview.
- Modify `playwright.config.ts`: delegar à factory em modo dev.
- Create `playwright.preview.config.ts`: delegar à factory em modo preview.
- Create `tests/config/playwright-server.test.ts`: contrato dos dois comandos de servidor.
- Modify `tests/e2e/gameHarness.ts`: remover dependência DEV do helper de abertura comum.
- Modify `.github/workflows/ci.yml`: actions Node 24, browser e smoke do dist.
- Create `tests/config/ci-production-gate.test.ts`: ordem executável do CI.
- Modify `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`: documentar gates realmente ativos.

---

### Task 1: Typecheck de produção, testes e configurações

**Files:**

- Create: `tests/config/typecheck-scope.test.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `npm run typecheck` existente.
- Produces: `tsconfig.include = ['src', 'tests', '*.config.ts']` e tipos globais `node`/`vite/client`.

- [ ] **Step 1: Escrever o guarda que falha no escopo atual**

Criar `tests/config/typecheck-scope.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

describe('escopo do typecheck', () => {
  it('inclui produção, testes, configs e tipos do Node/Vite', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(repoRoot, 'tsconfig.json'), 'utf8')) as {
      include?: string[];
      compilerOptions?: { types?: string[] };
    };
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };

    expect(tsconfig.include).toEqual(['src', 'tests', '*.config.ts']);
    expect(tsconfig.compilerOptions?.types).toEqual(['node', 'vite/client']);
    expect(pkg.devDependencies?.['@types/node']).toBe('^22.20.1');
  });
});
```

- [ ] **Step 2: Rodar RED**

Run:

```bash
npx vitest run tests/config/typecheck-scope.test.ts
```

Expected: FAIL porque `include` ainda é apenas `['src']`.

- [ ] **Step 3: Instalar tipos Node e ampliar tsconfig**

Run:

```bash
npm install --save-dev "@types/node@^22.20.1"
```

Em `tsconfig.json`, manter as opções existentes e adicionar/substituir:

```json
{
  "compilerOptions": {
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

- [ ] **Step 4: Rodar GREEN e o typecheck ampliado**

Run:

```bash
npx vitest run tests/config/typecheck-scope.test.ts
npm run typecheck
```

Expected: 1/1 teste passa e `tsc --noEmit` termina sem erros em src, testes e configs.

- [ ] **Step 5: Gate, revisão e commit**

Run:

```bash
npm run check
git diff --check
git add tsconfig.json package.json package-lock.json tests/config/typecheck-scope.test.ts
git commit -m "test(types): inclui testes e configs no typecheck"
```

Expected: 34 arquivos, 271 testes, commit restrito aos quatro arquivos.

---

### Task 2: Cobertura V8 de todo o código de produção

**Files:**

- Create: `tests/config/coverage-gate.test.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**

- Consumes: Vitest 4.1.10 e `npm run check` da Task 1.
- Produces: script `test:coverage` e thresholds 30/30/30/30 sobre todo `src`.

- [ ] **Step 1: Escrever o teste do contrato de cobertura**

Criar `tests/config/coverage-gate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

describe('gate de cobertura', () => {
  it('usa V8 compatível e inclui todo src com threshold 30', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const config = read('vitest.config.ts');

    expect(pkg.devDependencies?.['@vitest/coverage-v8']).toBe('^4.1.10');
    expect(pkg.scripts?.['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts?.check).toContain('npm run test:coverage');
    expect(config).toContain("provider: 'v8'");
    expect(config).toContain("include: ['src/**/*.ts']");
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      expect(config).toContain(`${metric}: 30`);
    }
  });
});
```

- [ ] **Step 2: Rodar RED**

Run:

```bash
npx vitest run tests/config/coverage-gate.test.ts
```

Expected: FAIL porque a dependência e o script ainda não existem.

- [ ] **Step 3: Instalar provider e configurar cobertura**

Run:

```bash
npm install --save-dev "@vitest/coverage-v8@^4.1.10"
```

Em `vitest.config.ts`, adicionar sob `test`:

```ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/vite-env.d.ts'],
  reporter: ['text', 'json-summary'],
  reportsDirectory: '.playwright-mcp/coverage',
  thresholds: {
    statements: 30,
    branches: 30,
    functions: 30,
    lines: 30,
  },
},
```

Em `package.json`:

```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm run test:coverage"
  }
}
```

Acrescentar `npm run test:coverage` às listas de scripts em README e CONTRIBUTING, descrevendo
threshold inicial de 30% sobre todo `src`.

- [ ] **Step 4: Rodar GREEN e confirmar o baseline acima do gate**

Run:

```bash
npx vitest run tests/config/coverage-gate.test.ts
npm run test:coverage
```

Expected: 1/1 guarda passa; 35 arquivos/272 testes passam; as quatro métricas ficam acima de 30%.

- [ ] **Step 5: Gate completo e commit**

Run:

```bash
npm run check
git diff --check
git add vitest.config.ts package.json package-lock.json README.md CONTRIBUTING.md tests/config/coverage-gate.test.ts
git commit -m "test(coverage): cria gate V8 para todo o código"
```

Expected: 35 arquivos, 272 testes, coverage verde e commit somente nos seis arquivos.

---

### Task 3: Smoke E2E do build servido por preview

**Files:**

- Create: `tests/e2e/playwrightConfig.ts`
- Create: `playwright.preview.config.ts`
- Create: `tests/config/playwright-server.test.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/gameHarness.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: porta 5199, projetos `chromium`/`mobile` e `smoke.spec.ts` existentes.
- Produces: `makePlaywrightConfig(mode: 'dev' | 'preview')` e script `test:e2e:smoke:prod`.

- [ ] **Step 1: Escrever testes dos dois servidores antes da factory**

Criar `tests/config/playwright-server.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const readOrEmpty = (path: string): string => {
  const absolute = resolve(repoRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
};

describe('servidor do Playwright', () => {
  it('mantém Vite dev na suíte de desenvolvimento', () => {
    const shared = readOrEmpty('tests/e2e/playwrightConfig.ts');
    const dev = readOrEmpty('playwright.config.ts');

    expect(shared).toContain(
      "dev: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort'",
    );
    expect(dev).toContain("makePlaywrightConfig('dev')");
  });

  it('serve o dist com Vite preview no smoke de produção', () => {
    const shared = readOrEmpty('tests/e2e/playwrightConfig.ts');
    const preview = readOrEmpty('playwright.preview.config.ts');

    expect(shared).toContain(
      "preview: 'npm run preview -- --host 127.0.0.1 --port 5199 --strictPort'",
    );
    expect(shared).toContain("reuseExistingServer: mode === 'dev' && !process.env.CI");
    expect(preview).toContain("makePlaywrightConfig('preview')");
  });
});
```

- [ ] **Step 2: Rodar RED**

Run:

```bash
npx vitest run tests/config/playwright-server.test.ts
```

Expected: FAIL em `shared.toContain(...)`; a factory ainda não existe e `readOrEmpty` devolve vazio.

- [ ] **Step 3: Extrair factory sem mudar a suíte dev**

Criar `tests/e2e/playwrightConfig.ts` movendo o objeto atual de `playwright.config.ts` para:

```ts
import { defineConfig, devices } from '@playwright/test';

export type TestServerMode = 'dev' | 'preview';

const SERVER_COMMAND: Record<TestServerMode, string> = {
  dev: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
  preview: 'npm run preview -- --host 127.0.0.1 --port 5199 --strictPort',
};

export function makePlaywrightConfig(mode: TestServerMode) {
  return defineConfig({
    testDir: './tests/e2e',
    timeout: 45_000,
    expect: {
      timeout: 7_500,
    },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list']],
    outputDir: '.playwright-mcp/test-results',
    use: {
      baseURL: 'http://127.0.0.1:5199',
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
      video: 'off',
      viewport: { width: 1280, height: 800 },
    },
    webServer: {
      command: SERVER_COMMAND[mode],
      url: 'http://127.0.0.1:5199',
      timeout: 60_000,
      reuseExistingServer: mode === 'dev' && !process.env.CI,
    },
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
        testIgnore: /touch\.spec\.ts/,
      },
      {
        name: 'mobile',
        use: { ...devices['Pixel 5'] },
        testMatch: /touch\.spec\.ts/,
      },
    ],
  });
}
```

Não omitir ou reordenar projetos. `playwright.config.ts` passa a conter:

```ts
import { makePlaywrightConfig } from './tests/e2e/playwrightConfig';

export default makePlaywrightConfig('dev');
```

Criar `playwright.preview.config.ts`:

```ts
import { makePlaywrightConfig } from './tests/e2e/playwrightConfig';

export default makePlaywrightConfig('preview');
```

- [ ] **Step 4: Remover costura DEV do fluxo comum e adicionar script**

Em `tests/e2e/gameHarness.ts`, remover somente o `expect.poll` final de
`openGameAndStartMatch`; helpers que chamam `readMatchSnapshot` ou `forceMatchEnd` continuam
validando `__match` explicitamente nas suítes dev.

Adicionar a `package.json`:

```json
{
  "scripts": {
    "test:e2e:smoke:prod": "playwright test --config=playwright.preview.config.ts tests/e2e/smoke.spec.ts --project=chromium"
  }
}
```

- [ ] **Step 5: Rodar GREEN, regressão dev e smoke real do dist**

Run:

```bash
npx vitest run tests/config/playwright-server.test.ts
npm run build
npm run test:e2e:smoke:prod
npm run test:e2e:smoke
```

Expected: 2/2 guardas passam; build verde; 1 smoke preview passa sem `?debug`; 1 smoke dev passa.

- [ ] **Step 6: Gate completo e commit**

Run:

```bash
npm run check
git diff --check
git add tests/e2e/playwrightConfig.ts playwright.preview.config.ts tests/config/playwright-server.test.ts playwright.config.ts tests/e2e/gameHarness.ts package.json
git commit -m "test(e2e): executa smoke no build de produção"
```

Expected: 36 arquivos, 274 testes, commit restrito aos seis arquivos e sem mudança observável na suíte dev.

---

### Task 4: CI oficial executa o gate completo e smoke do dist

**Files:**

- Create: `tests/config/ci-production-gate.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: `npm run check`, `npm run build` e `npm run test:e2e:smoke:prod` das Tasks 1–3.
- Produces: CI em ordem check → build → install Chromium → smoke preview.

- [ ] **Step 1: Escrever guarda da ordem e versões do CI**

Criar `tests/config/ci-production-gate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');

describe('CI de produção', () => {
  it('usa actions Node 24 e testa o dist depois do build', () => {
    expect(ci).toContain('actions/checkout@v5');
    expect(ci).toContain('actions/setup-node@v6');

    const check = ci.indexOf('run: npm run check');
    const build = ci.indexOf('run: npm run build');
    const install = ci.indexOf('run: npx playwright install --with-deps chromium');
    const smoke = ci.indexOf('run: npm run test:e2e:smoke:prod');

    expect(check).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(check);
    expect(install).toBeGreaterThan(build);
    expect(smoke).toBeGreaterThan(install);
  });
});
```

- [ ] **Step 2: Rodar RED**

Run:

```bash
npx vitest run tests/config/ci-production-gate.test.ts
```

Expected: FAIL em `actions/checkout@v5`; workflow ainda usa v4.

- [ ] **Step 3: Atualizar workflow sem duplicar build**

Em `.github/workflows/ci.yml`:

```yaml
jobs:
  check:
    name: Typecheck · Lint · Coverage · Build · Smoke
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version-file: '.nvmrc'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Quality gate
        run: npm run check

      - name: Build
        run: npm run build

      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      - name: Production smoke
        run: npm run test:e2e:smoke:prod
```

Remover os steps individuais antigos de Typecheck/Lint/Format/Test para não executar o mesmo
trabalho duas vezes; `npm run check` é a fonte única.

- [ ] **Step 4: Atualizar documentação conforme o comportamento real**

Em README e CONTRIBUTING, declarar:

```markdown
O CI roda `npm run check`, build e smoke Chromium do `dist/` servido por `vite preview` em cada
push para `main`.
```

Adicionar em `CHANGELOG.md > [Não lançado] > Alterado`:

```markdown
- CI ampliado: typecheck de produção/testes/configs, cobertura V8 de todo `src`, build e smoke
  Chromium do artefato servido por `vite preview`.
```

- [ ] **Step 5: Rodar GREEN e o gate local equivalente**

Run:

```bash
npx vitest run tests/config/ci-production-gate.test.ts
npm run check
npm run build
npm run test:e2e:smoke:prod
```

Expected: 1/1 guarda passa; 37 arquivos/275 testes verdes; build e smoke preview verdes.

- [ ] **Step 6: Revisar e commitar**

Run:

```bash
git diff --check
git diff -- .github/workflows/ci.yml README.md CONTRIBUTING.md CHANGELOG.md tests/config/ci-production-gate.test.ts
git add .github/workflows/ci.yml README.md CONTRIBUTING.md CHANGELOG.md tests/config/ci-production-gate.test.ts
git commit -m "ci(quality): valida cobertura e smoke do dist"
```

Expected: commit restrito aos cinco arquivos e sem qualquer alteração de deploy.

---

## Phase Completion Gate

- [ ] `npm run typecheck` cobre `src`, `tests`, `*.config.ts` sem erro.
- [ ] `npm run test:coverage` mede todo `src` e supera 30% nas quatro métricas.
- [ ] `npm run check` passa 37 arquivos e 275 testes.
- [ ] `npm run build` passa.
- [ ] `npm run test:e2e:smoke:prod` passa contra `vite preview`, sem servidor dev existente.
- [ ] `npm run test:e2e:smoke` continua passando contra Vite dev.
- [ ] `.github/workflows/ci.yml` usa checkout v5, setup-node v6 e ordem check→build→browser→smoke.
- [ ] `git diff --check` passa e `git status --short` está vazio.
- [ ] Diff da fase não altera `src/`, regras, UI, assets, deploy ou configuração Pages.
- [ ] Revisor independente aprova cada task e o pacote completo.
- [ ] Após push, o CI remoto do mesmo SHA conclui verde sem warning de action Node 20.
