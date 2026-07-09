// Estado de teclado puro (sem DOM) com detecção de borda por frame. Extraído de Input para ficar
// testável em ambiente Node: o Input liga os listeners de window e delega toda a lógica de estado
// (Sets down/pressed/released + moveAxis) para cá. Mantém a mesma superfície pública do Input.
export class KeyState {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  // Borda de pressionar: ignora auto-repeat do SO (segurar tecla não deve gerar novas bordas).
  keyDown(code: string, repeat = false): void {
    if (repeat) return;
    this.down.add(code);
    this.pressed.add(code);
  }

  keyUp(code: string): void {
    this.down.delete(code);
    this.released.add(code);
  }

  // Perda de foco da janela: solta todas as teclas para não ficar "presa" ao voltar.
  blur(): void {
    this.down.clear();
  }

  isDown(key: string): boolean {
    return this.down.has(key);
  }
  wasPressed(key: string): boolean {
    return this.pressed.has(key);
  }
  wasReleased(key: string): boolean {
    return this.released.has(key);
  }

  // Vetor de movimento WASD/setas: x = frente(+)/trás(-) em direção à rede p/ HOME, z = direita/esquerda
  moveAxis(): { x: number; z: number } {
    let x = 0,
      z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) x += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) z -= 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  // Fim da frame: limpa apenas as bordas; o estado contínuo (down) persiste.
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }
}
