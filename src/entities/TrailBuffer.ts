import * as THREE from 'three';

/**
 * Ring buffer de tamanho fixo sobre THREE.Vector3 pré-alocados, usado pelo
 * rastro luminoso da bola. Evita a alocação (this.pos.clone()) e o shift() de
 * array a cada frame de voo: os vetores internos são reaproveitados via .copy().
 *
 * Ordem lógica: at(0) = ponto mais antigo, at(length-1) = mais recente
 * (próximo da cabeça da bola). Ao encher, o mais antigo é sobrescrito (FIFO).
 */
export class TrailBuffer {
  private buf: THREE.Vector3[];
  private start = 0; // índice físico do ponto mais antigo
  private len = 0; // quantidade de pontos válidos

  constructor(capacity: number) {
    this.buf = Array.from({ length: capacity }, () => new THREE.Vector3());
  }

  get length(): number {
    return this.len;
  }

  get capacity(): number {
    return this.buf.length;
  }

  /** Anexa um ponto ao fim (copiando o valor, sem guardar a referência). */
  push(p: THREE.Vector3): void {
    const cap = this.buf.length;
    const idx = (this.start + this.len) % cap;
    this.buf[idx].copy(p);
    if (this.len < cap) {
      this.len++;
    } else {
      // cheio: o novo ponto ocupou o slot do mais antigo; avança o início.
      this.start = (this.start + 1) % cap;
    }
  }

  /** Remove o ponto mais antigo (fade-out gradual quando a bola desacelera). */
  shift(): void {
    if (this.len > 0) {
      this.start = (this.start + 1) % this.buf.length;
      this.len--;
    }
  }

  /** Retorna o vetor no índice lógico i (0 = mais antigo), sem alocar. */
  at(i: number): THREE.Vector3 {
    return this.buf[(this.start + i) % this.buf.length];
  }

  clear(): void {
    this.start = 0;
    this.len = 0;
  }
}
