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
