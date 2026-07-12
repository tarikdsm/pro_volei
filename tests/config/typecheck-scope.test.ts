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
