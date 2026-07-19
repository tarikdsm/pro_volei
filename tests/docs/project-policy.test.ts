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
    const readme = readRepo('README.md');
    const changelog = readRepo('CHANGELOG.md');
    const triggerBlock = ci.match(/^on:\r?\n(?:^[ \t]+.*(?:\r?\n|$))+/m)?.[0];

    expect(claude).toContain('Fluxo main-only');
    expect(contributing).toContain('commits diretamente em `main`');
    expect(contributing).not.toContain('git checkout -b');
    expect(contributing).not.toContain('Abra PR');
    expect(triggerBlock?.trim()).toBe('on:\n  push:\n    branches: [main]');
    expect(ci).not.toMatch(/^\s*pull_request:/m);
    expect(ci).not.toContain('branch/PR');
    expect(readme).not.toContain('push/PR');
    expect(changelog).not.toContain('push/PR');
    expect(readme).toContain('push em main');
    expect(changelog).toContain('push em main');
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

  it('mantém as fontes canônicas alinhadas ao marco 2.0.0', () => {
    const claude = readRepo('CLAUDE.md');
    const planIndex = readRepo('docs/superpowers/plans/README.md');
    const packageJson = JSON.parse(readRepo('package.json')) as { version: string };

    expect(packageJson.version).toBe('2.0.0');
    expect(claude).toContain('**Marco atual:** Fases 1–7 concluídas');
    expect(claude).not.toContain('Próxima na fila: **Fase 6**');
    expect(planIndex).toContain('Fases 1–7 entregues localmente');
    expect(planIndex).toContain('| concluído localmente (7D) |');
  });
});
