import { describe, expect, it, vi } from 'vitest';
import { detectMotionProfile } from './MotionProfile';

describe('detectMotionProfile', () => {
  it('respeita prefers-reduced-motion', () => {
    const source = vi.fn().mockReturnValue({ matches: true });
    expect(detectMotionProfile(source)).toBe('reduced');
    expect(source).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('usa movimento completo quando indisponível ou não solicitado', () => {
    expect(detectMotionProfile(vi.fn().mockReturnValue({ matches: false }))).toBe('full');
    expect(detectMotionProfile(null)).toBe('full');
  });
});
