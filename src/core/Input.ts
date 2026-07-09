import { KeyState } from './KeyState';

// Entrada de teclado: liga os listeners de window e delega o estado a um KeyState puro (testável
// em Node). A superfície pública (isDown/wasPressed/wasReleased/moveAxis/endFrame) permanece
// idêntica — HumanController.update e o loop em main.ts a consomem.
export class Input {
  private keys = new KeyState();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.keyDown(e.code, e.repeat);
      // não bloqueia o auto-repeat: só a primeira pressão precisa cancelar o scroll/rolagem
      if (
        !e.repeat &&
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.keyUp(e.code));
    window.addEventListener('blur', () => this.keys.blur());
  }

  isDown(key: string): boolean {
    return this.keys.isDown(key);
  }
  wasPressed(key: string): boolean {
    return this.keys.wasPressed(key);
  }
  wasReleased(key: string): boolean {
    return this.keys.wasReleased(key);
  }

  moveAxis(): { x: number; z: number } {
    return this.keys.moveAxis();
  }

  endFrame(): void {
    this.keys.endFrame();
  }
}
