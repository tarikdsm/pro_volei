import { describe, expect, it } from 'vitest';
import { ZONE_LABELS } from './HUD';

describe('HUD — feedback de direção do levantamento', () => {
  it('expõe esquerda, automático e direita sem códigos de teclado', () => {
    expect(ZONE_LABELS).toEqual(['← ESQUERDA', 'AUTO', 'DIREITA →']);
    expect(ZONE_LABELS.join(' ')).not.toMatch(/Key[AWSD]|\bWASD\b/);
  });
});
