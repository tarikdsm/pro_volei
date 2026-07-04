// Entrada de teclado com detecção de borda (pressed nesta frame) e estado contínuo.
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = normalize(e.code);
      this.down.add(k);
      this.pressed.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = normalize(e.code);
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(key: string): boolean { return this.down.has(key); }
  wasPressed(key: string): boolean { return this.pressed.has(key); }
  wasReleased(key: string): boolean { return this.released.has(key); }

  // Vetor de movimento WASD/setas: x = frente(+)/trás(-) em direção à rede p/ HOME, z = direita/esquerda
  moveAxis(): { x: number; z: number } {
    let x = 0, z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) x += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) z -= 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }
}

function normalize(code: string): string {
  return code;
}
