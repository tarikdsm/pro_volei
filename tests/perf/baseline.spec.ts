import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REQUIRED_BASELINE_FIELDS, validateBaseline } from './schema';

// Teste de lógica pura (Node): garante que o artefato de baseline versionado existe
// e tem as métricas esperadas. Falha sem a correção (arquivo ausente) e não roda
// o browser — perf NUNCA vira gate de FPS no `npm run check`.
const here = dirname(fileURLToPath(import.meta.url));
const baselineFile = resolve(here, '../../docs/perf/baseline-latest.json');

describe('baseline de performance', () => {
  it('o artefato versionado existe e tem as métricas-chave', () => {
    const raw = readFileSync(baselineFile, 'utf8');
    const data = JSON.parse(raw) as unknown;

    expect(validateBaseline(data)).toEqual([]);

    // sanidade extra: os campos obrigatórios são numéricos e finitos
    for (const path of REQUIRED_BASELINE_FIELDS) {
      const value = path
        .split('.')
        .reduce<unknown>(
          (acc, key) =>
            typeof acc === 'object' && acc !== null
              ? (acc as Record<string, unknown>)[key]
              : undefined,
          data,
        );
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
