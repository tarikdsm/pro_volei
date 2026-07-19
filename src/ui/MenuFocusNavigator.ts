const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function nextFocusIndex(length: number, current: number, key: string): number | null {
  if (!Number.isInteger(length) || length <= 0 || !NAVIGATION_KEYS.has(key)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  return Math.max(0, Math.min(length - 1, current + direction));
}

export function bindMenuFocusNavigation(root: HTMLElement, onEscape: () => void): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (getComputedStyle(root).display === 'none') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
      return;
    }
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = nextFocusIndex(controls.length, current, event.key);
    if (next === null) return;
    event.preventDefault();
    controls[next]?.focus();
  };
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}
