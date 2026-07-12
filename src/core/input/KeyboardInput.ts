import type { InputCancelReason, InputSink, ScreenAxis } from './InputFrame';

const DIRECTION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Adaptador puro de teclado para o vocabulário de gameplay: setas + Espaço. */
export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor(private readonly sink: InputSink) {}

  keyDown(code: string, repeat: boolean, atMs: number): boolean {
    if (!this.isGameplayKey(code)) return false;
    if (repeat || this.down.has(code)) return true;

    this.down.add(code);
    if (code === 'Space') this.sink.setAction('keyboard', true, atMs);
    else this.pushMove(atMs);
    return true;
  }

  keyUp(code: string, atMs: number): boolean {
    if (!this.isGameplayKey(code)) return false;
    if (!this.down.delete(code)) return true;

    if (code === 'Space') this.sink.setAction('keyboard', false, atMs);
    else this.pushMove(atMs);
    return true;
  }

  cancel(reason: InputCancelReason, atMs: number): void {
    this.down.clear();
    this.sink.cancel(reason, atMs);
  }

  private isGameplayKey(code: string): boolean {
    return code === 'Space' || DIRECTION_KEYS.has(code);
  }

  private pushMove(atMs: number): void {
    const axis: ScreenAxis = {
      right: Number(this.down.has('ArrowRight')) - Number(this.down.has('ArrowLeft')),
      up: Number(this.down.has('ArrowUp')) - Number(this.down.has('ArrowDown')),
    };
    this.sink.setMove('keyboard', axis, atMs);
  }
}
