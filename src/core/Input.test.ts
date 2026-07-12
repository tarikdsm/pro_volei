import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

type Listener = (event: Record<string, unknown>) => void;

class FakeWindow {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('Input — adaptador DOM', () => {
  it('encaminha setas e Espaço, mas deixa WASD e Escape fora do gameplay', () => {
    const target = new FakeWindow();
    let now = 10;
    const input = new Input(target as unknown as Window, () => now);
    const preventArrow = vi.fn();
    const preventW = vi.fn();
    const preventEscape = vi.fn();

    target.emit('keydown', { code: 'ArrowRight', repeat: false, preventDefault: preventArrow });
    now = 11;
    target.emit('keydown', { code: 'KeyW', repeat: false, preventDefault: preventW });
    target.emit('keydown', { code: 'Escape', repeat: false, preventDefault: preventEscape });
    now = 12;
    target.emit('keydown', { code: 'Space', repeat: false, preventDefault: vi.fn() });

    const frame = input.consumeUntil(12);
    expect(frame.screenAxis).toEqual({ right: 1, up: 0 });
    expect(frame.actionEdges.map((edge) => edge.kind)).toEqual(['press']);
    expect(preventArrow).toHaveBeenCalledOnce();
    expect(preventW).not.toHaveBeenCalled();
    expect(preventEscape).not.toHaveBeenCalled();
  });

  it('blur cancela o estado sem produzir release', () => {
    const target = new FakeWindow();
    let now = 1;
    const input = new Input(target as unknown as Window, () => now);

    target.emit('keydown', { code: 'Space', repeat: false, preventDefault: vi.fn() });
    input.consumeUntil(1);
    now = 2;
    target.emit('blur');

    const frame = input.consumeUntil(2);
    expect(frame.actionDown).toBe(false);
    expect(frame.actionEdges).toEqual([]);
    expect(frame.cancellations.map(({ reason }) => reason)).toEqual(['blur']);
  });
});
