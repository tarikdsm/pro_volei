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

  it('aponta arquitetura e roadmap para o design 2.0 sem contagem obsoleta', () => {
    const architecture = readRepo('docs/ARCHITECTURE.md');
    const claude = readRepo('CLAUDE.md');
    const roadmap = readRepo('docs/ROADMAP.md');

    expect(architecture).not.toContain('~490 linhas');
    expect(claude).not.toContain('~490 linhas');
    expect(architecture).toContain('Pipeline local de assets 2.0');
    expect(roadmap).toContain('Design 2.0 aprovado');
    expect(roadmap).toContain('2026-07-12-pro-volei-2-0-design.md');
    expect(roadmap).toContain('Fase 1A');
    expect(roadmap).not.toContain('~490 linhas');
  });
});
