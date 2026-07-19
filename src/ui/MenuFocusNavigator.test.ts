import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from './MenuFocusNavigator';

describe('nextFocusIndex', () => {
  it('move em ordem visual e limita nas extremidades', () => {
    expect(nextFocusIndex(4, 1, 'ArrowRight')).toBe(2);
    expect(nextFocusIndex(4, 1, 'ArrowDown')).toBe(2);
    expect(nextFocusIndex(4, 1, 'ArrowLeft')).toBe(0);
    expect(nextFocusIndex(4, 1, 'ArrowUp')).toBe(0);
    expect(nextFocusIndex(4, 0, 'ArrowLeft')).toBe(0);
    expect(nextFocusIndex(4, -1, 'ArrowRight')).toBe(0);
  });

  it('Home/End vão aos extremos e teclas alheias não capturam foco', () => {
    expect(nextFocusIndex(5, 2, 'Home')).toBe(0);
    expect(nextFocusIndex(5, 2, 'End')).toBe(4);
    expect(nextFocusIndex(5, 2, 'Tab')).toBeNull();
    expect(nextFocusIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
