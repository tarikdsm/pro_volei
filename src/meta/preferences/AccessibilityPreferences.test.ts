import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../../platform/save/SaveSchema';
import { resolveAccessibilityPreferences } from './AccessibilityPreferences';

describe('resolveAccessibilityPreferences', () => {
  const defaults = createDefaultSave().preferences;

  it('mantém opções completas por padrão', () => {
    expect(resolveAccessibilityPreferences(defaults, 'full')).toMatchObject({
      motionProfile: 'full',
      shakeEnabled: true,
      replayEnabled: true,
      timingToleranceScale: 1,
    });
  });

  it('movimento reduzido do usuário ou sistema vence shake e replay', () => {
    for (const [reducedMotion, system] of [
      [true, 'full'],
      [false, 'reduced'],
    ] as const) {
      expect(resolveAccessibilityPreferences({ ...defaults, reducedMotion }, system)).toMatchObject(
        { motionProfile: 'reduced', shakeEnabled: false, replayEnabled: false },
      );
    }
  });

  it('timing amplo produz somente a escala humana documentada', () => {
    const resolved = resolveAccessibilityPreferences({ ...defaults, timingAssist: 'wide' }, 'full');
    expect(resolved.timingToleranceScale).toBe(1.35);
    expect(resolved.motionProfile).toBe('full');
    expect(resolved.shakeEnabled).toBe(true);
  });
});
