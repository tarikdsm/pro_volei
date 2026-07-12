import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractJobSteps } from './support/workflowContract';

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(resolve(here, '../../package.json'), 'utf8'),
) as PackageJson;
const packageLock = JSON.parse(
  readFileSync(resolve(here, '../../package-lock.json'), 'utf8'),
) as PackageLock;
const workflow = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');
const readRepo = (path: string): string => readFileSync(resolve(here, '../..', path), 'utf8');
const operationalDocPaths = [
  'CLAUDE.md',
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'docs/ROADMAP.md',
  'docs/deployment/web.md',
] as const;
const operationalDocs = operationalDocPaths.map((path) => [path, readRepo(path)] as const);

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, { devDependencies?: Record<string, string> }>;
}

describe('remoção do deploy legado', () => {
  it('não oferece mais o script npm deploy', () => {
    expect(packageJson.scripts).not.toHaveProperty('deploy');
  });

  it('não instala mais o pacote gh-pages', () => {
    expect(packageJson.dependencies).not.toHaveProperty('gh-pages');
    expect(packageJson.devDependencies).not.toHaveProperty('gh-pages');
    expect(packageLock.packages?.['']?.devDependencies).not.toHaveProperty('gh-pages');
    expect(packageLock.packages).not.toHaveProperty('node_modules/gh-pages');
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

  it('não recomenda o script legado nos documentos operacionais', () => {
    for (const [path, content] of operationalDocs) {
      expect(content, path).not.toContain('npm run deploy');
    }
  });

  it('mantém a política canônica literalmente main-only', () => {
    for (const path of ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md']) {
      expect(readRepo(path), path).not.toContain('gh-pages');
    }

    const claude = readRepo('CLAUDE.md');
    const web = readRepo('docs/deployment/web.md');
    expect(claude).toContain('literalmente main-only');
    expect(web).toContain('gh run rerun');
    expect(web).toContain('git revert');
    expect(web).not.toContain('gh-pages');
    expect(web).not.toContain('build_type=legacy');
    expect(web).not.toContain('fallback transitório');
  });
});
