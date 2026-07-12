import type {
  InputCancelReason,
  InputFrame,
  InputSink,
  InputSource,
  ScreenAxis,
} from './input/InputFrame';
import { InputHub } from './input/InputHub';
import { KeyboardInput } from './input/KeyboardInput';

/** Composition root de entrada: liga DOM, teclado e fontes touch ao hub semântico. */
export class Input implements InputSink {
  private readonly hub = new InputHub();
  private readonly keyboard = new KeyboardInput(this.hub);

  constructor(
    target: Window = window,
    private readonly now: () => number = () => performance.now(),
  ) {
    target.addEventListener('keydown', (event) => {
      if (this.keyboard.keyDown(event.code, event.repeat, this.now())) event.preventDefault();
    });
    target.addEventListener('keyup', (event) => {
      if (this.keyboard.keyUp(event.code, this.now())) event.preventDefault();
    });
    target.addEventListener('blur', () => this.cancel('blur', this.now()));
  }

  consumeUntil(atMs: number): InputFrame {
    return this.hub.consumeUntil(atMs);
  }

  setMove(source: InputSource, axis: ScreenAxis, atMs: number): void {
    this.hub.setMove(source, axis, atMs);
  }

  setAction(source: InputSource, down: boolean, atMs: number): void {
    this.hub.setAction(source, down, atMs);
  }

  cancel(reason: InputCancelReason, atMs = this.now()): void {
    this.keyboard.cancel(reason, atMs);
  }

  /** Cancela carga/ação sem apagar setas ou joystick fisicamente mantidos. */
  cancelAction(reason: InputCancelReason, atMs = this.now()): void {
    this.hub.cancelAction(reason, atMs);
  }
}
