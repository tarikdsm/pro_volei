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
