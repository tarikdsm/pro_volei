import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractJobSteps } from './support/workflowContract';

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(resolve(here, '../../package.json'), 'utf8'),
) as PackageJson;
const workflow = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('remoção do deploy legado', () => {
  it('não oferece mais o script npm deploy', () => {
    expect(packageJson.scripts).not.toHaveProperty('deploy');
  });

  it('não instala mais o pacote gh-pages', () => {
    expect(packageJson.dependencies).not.toHaveProperty('gh-pages');
    expect(packageJson.devDependencies).not.toHaveProperty('gh-pages');
  });

  it('preserva o deploy Actions e a validação do workflow', () => {
    expect(packageJson.scripts?.['workflow:check']).toBe(
      'action-validator .github/workflows/ci.yml',
    );
    expect(packageJson.scripts?.check?.split(' && ')).toContain('npm run workflow:check');
    expect(extractJobSteps(workflow, 'check')).toContain('uses:actions/upload-pages-artifact@v5');
    expect(extractJobSteps(workflow, 'deploy')).toEqual([
      'uses:actions/configure-pages@v6',
      'uses:actions/deploy-pages@v5',
    ]);
  });
});
