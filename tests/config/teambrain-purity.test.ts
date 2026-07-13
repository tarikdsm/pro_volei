import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const tacticsRoot = resolve(repoRoot, 'src/game/team');

describe('pureza do TeamBrain', () => {
  it('não depende de apresentação, browser, relógio ou aleatoriedade', () => {
    const violations: string[] = [];
    const files = readdirSync(tacticsRoot)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => resolve(tacticsRoot, name));

    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      const label = relative(repoRoot, path).replaceAll('\\', '/');
      const forbidden: [RegExp, string][] = [
        [/from\s+['"]three['"]/, 'Three.js'],
        [/from\s+['"][^'"]*(entities|systems|ports|random)[^'"]*['"]/, 'adapter/runtime'],
        [/\b(window|document|performance)\b/, 'browser/clock'],
        [
          /\b(Date\.now|new\s+Date|setTimeout|setInterval|requestAnimationFrame)\s*\(/,
          'wall clock',
        ],
        [/\bMath\.random\s*\(/, 'ambient RNG'],
        [/\bcrypto\.getRandomValues\s*\(/, 'ambient RNG'],
        [/\bimport\s*\(/, 'dynamic import'],
      ];
      for (const [pattern, reason] of forbidden) {
        if (pattern.test(source)) violations.push(`${label}: ${reason}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
