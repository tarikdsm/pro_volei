import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Teste-guarda de config (Node): o script `deploy` precisa rodar `npm run check`
// (typecheck + lint + format:check + test) ANTES de gerar o build e publicar na
// gh-pages. Assim nenhum deploy manual sai de uma árvore vermelha — é o gate
// reprodutível local (B7). Sem a correção (deploy começando em `vite build`) estes
// casos falham, o que impede regressão do gate.
const here = dirname(fileURLToPath(import.meta.url));
const packageFile = resolve(here, '../../package.json');

interface PackageJson {
  scripts?: Record<string, string>;
}

function readDeployScript(): string {
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as PackageJson;
  return pkg.scripts?.deploy ?? '';
}

describe('gate reprodutível do deploy', () => {
  it('o script deploy roda `npm run check`', () => {
    expect(readDeployScript()).toContain('npm run check');
  });

  it('o check vem ANTES do build e do publish', () => {
    const deploy = readDeployScript();
    const idxCheck = deploy.indexOf('npm run check');
    const idxBuild = deploy.indexOf('vite build');
    const idxPublish = deploy.indexOf('gh-pages');
    expect(idxCheck).toBeGreaterThanOrEqual(0);
    expect(idxBuild).toBeGreaterThan(idxCheck);
    expect(idxPublish).toBeGreaterThan(idxCheck);
  });

  it('os passos são encadeados com `&&` (falha aborta o deploy)', () => {
    const deploy = readDeployScript();
    expect(deploy).toMatch(/npm run check\s*&&/);
  });
});
