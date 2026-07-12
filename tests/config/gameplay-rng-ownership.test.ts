import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const gameRoot = resolve(repoRoot, 'src/game');

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    if (extname(path) !== '.ts' || /\.(test|spec)\.ts$/.test(path)) return [];
    return [path];
  });
}

describe('ownership do RNG de gameplay', () => {
  it('proíbe Math.random e helpers ambientais em src/game', () => {
    const violations: string[] = [];
    for (const path of productionFiles(gameRoot)) {
      const source = readFileSync(path, 'utf8');
      const label = relative(repoRoot, path).replaceAll('\\', '/');
      if (/Math\.random\s*\(/.test(source)) violations.push(`${label}: Math.random`);

      for (const declaration of source.matchAll(
        /import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]*core\/math3d['"]/g,
      )) {
        const imported = declaration[1] ?? '';
        for (const helper of ['rand', 'chance', 'randPick']) {
          if (new RegExp(`\\b${helper}\\b`).test(imported)) {
            violations.push(`${label}: ${helper}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
