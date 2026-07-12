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
