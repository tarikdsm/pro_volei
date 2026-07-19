// Medidor de FPS de apresentação: acumula frames numa janela curta e reporta a média
// arredondada ao fechá-la. Puro e determinístico — avança somente pelo dt recebido.
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  private smoothed: number | null = null;

  constructor(private readonly windowSeconds = 0.5) {}

  get value(): number | null {
    return this.smoothed;
  }

  /** Registra um frame; devolve o fps vigente (null antes da primeira janela fechar). */
  sample(dtSeconds: number): number | null {
    if (!(dtSeconds > 0)) return this.smoothed;
    this.frames += 1;
    this.elapsed += dtSeconds;
    // Tolerância de ponto flutuante: somar N passos iguais pode fechar um epsilon abaixo da
    // janela (ex.: 30×(1/60) = 0,49999999999999994), o que atrasaria o fechamento um frame.
    if (this.elapsed >= this.windowSeconds - 1e-9) {
      this.smoothed = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
    }
    return this.smoothed;
  }

  reset(): void {
    this.frames = 0;
    this.elapsed = 0;
    this.smoothed = null;
  }
}
