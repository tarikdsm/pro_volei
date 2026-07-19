import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZONE_LABELS } from './HUD';

describe('HUD — feedback de direção do levantamento', () => {
  it('expõe esquerda, automático e direita sem códigos de teclado', () => {
    expect(ZONE_LABELS).toEqual(['← ESQUERDA', 'AUTO', 'DIREITA →']);
    expect(ZONE_LABELS.join(' ')).not.toMatch(/Key[AWSD]|\bWASD\b/);
  });
});

describe('HUD — legendas de áudio', () => {
  it('expõe uma região live separada das dicas de gameplay', () => {
    const source = readFileSync(new URL('./HUD.ts', import.meta.url), 'utf8');

    expect(source).toContain('id="caption" role="status" aria-live="polite"');
    expect(source).toContain('caption(text: string, durationMs: number)');
  });
});
