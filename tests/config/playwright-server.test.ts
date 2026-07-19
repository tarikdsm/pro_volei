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

    expect(shared).toContain("mode === 'dev' ? 'dev' : 'preview'");
    expect(shared).toContain('--host 127.0.0.1 --port ${port} --strictPort');
    expect(shared).toContain('command: serverCommand');
    expect(dev).toContain("makePlaywrightConfig('dev')");
  });

  it('serve o dist com Vite preview no smoke de produção', () => {
    const shared = readOrEmpty('tests/e2e/playwrightConfig.ts');
    const preview = readOrEmpty('playwright.preview.config.ts');

    expect(shared).toContain("mode === 'dev' ? 'dev' : 'preview'");
    expect(shared).toContain('--host 127.0.0.1 --port ${port} --strictPort');
    expect(shared).toContain("reuseExistingServer: mode === 'dev' && !process.env.CI");
    expect(shared).toContain(
      "mode === 'dev' ? [/touch\\.spec\\.ts/, /offline\\.spec\\.ts/] : /touch\\.spec\\.ts/",
    );
    expect(preview).toContain("makePlaywrightConfig('preview')");
  });
});
