import type { Preferences } from '../../platform/save/SaveSchema';
import type { MotionProfile } from '../../systems/camera/MotionProfile';

export interface EffectiveAccessibilityPreferences {
  readonly motionProfile: MotionProfile;
  readonly shakeEnabled: boolean;
  readonly replayEnabled: boolean;
  readonly timingToleranceScale: number;
  readonly captionsEnabled: boolean;
  readonly hapticsEnabled: boolean;
}

export function resolveAccessibilityPreferences(
  preferences: Readonly<Preferences>,
  systemMotionProfile: MotionProfile,
): Readonly<EffectiveAccessibilityPreferences> {
  const reduced = preferences.reducedMotion || systemMotionProfile === 'reduced';
  return Object.freeze({
    motionProfile: reduced ? 'reduced' : 'full',
    shakeEnabled: !reduced && preferences.shakeEnabled,
    replayEnabled: !reduced && preferences.replayEnabled,
    timingToleranceScale: preferences.timingAssist === 'wide' ? 1.35 : 1,
    captionsEnabled: preferences.captionsEnabled,
    hapticsEnabled: preferences.hapticsEnabled,
  });
}
