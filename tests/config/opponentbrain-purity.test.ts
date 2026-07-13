import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const strategyRoot = resolve(here, '../../src/game/strategy');
const productionFiles = ['StrategyTypes.ts', 'CourtZones.ts', 'OpponentBrain.ts'];

describe('pureza do OpponentBrain', () => {
  it('não depende de render, browser, relógio ou RNG ambiental', () => {
    const violations: string[] = [];
    const forbidden = [
      [/from\s+['"]three['"]/, 'Three.js'],
      [/\b(?:window|document|navigator|performance)\b/, 'browser/relógio'],
      [/\b(?:Date|setTimeout|setInterval)\b/, 'relógio/timer'],
      [/Math\.random\s*\(/, 'Math.random'],
      [/core\/random|RandomHub|RandomSource|Xoshiro|SequenceRandom/, 'RNG importado'],
      [/MechanicsCtx|TouchPlan|RallyState/, 'estado privado'],
    ] as const;

    for (const file of productionFiles) {
      const source = readFileSync(resolve(strategyRoot, file), 'utf8');
      for (const [pattern, label] of forbidden) {
        if (pattern.test(source)) violations.push(`${file}: ${label}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
