// QualityManager (Fase 4E, §10.1): mede frame time em janela deslizante e decide trocas de
// tier com histerese e cooldown. Puro e determinístico — a avaliação só é chamada pela
// apresentação na fronteira de ponto (nunca durante o rally); aplicar o tier é papel do main.

const WINDOW_SIZE = 180; // ~3 s de amostras a 60 fps
const MIN_SAMPLES = 90; // avaliação neutra sem meia janela preenchida
const P95_DOWN_SECONDS = 0.0182; // pior que ~55 fps sustentado ⇒ candidata a descer (alvo: 60 fps sempre)
const P95_UP_SECONDS = 0.012; // melhor que ~83 fps sustentado ⇒ candidata a subir
const DOWN_STREAK = 2; // avaliações ruins seguidas para descer
const UP_STREAK = 4; // avaliações boas seguidas para subir
const COOLDOWN_EVALUATIONS = 2; // avaliações neutras forçadas após qualquer troca

export const QUALITY_TIER_COUNT = 3;

export class QualityManager {
  private currentTier: number;
  private readonly samples = new Float32Array(WINDOW_SIZE);
  private sampleCount = 0;
  private cursor = 0;
  private downStreak = 0;
  private upStreak = 0;
  private cooldown = 0;

  constructor(
    initialTier: number,
    private readonly adaptive = true,
  ) {
    this.currentTier = Math.min(QUALITY_TIER_COUNT - 1, Math.max(0, Math.trunc(initialTier)));
  }

  get tier(): number {
    return this.currentTier;
  }

  /** Zera a janela de amostras (início/retomada de partida): frames velhos não enviesam. */
  resetWindow(): void {
    this.sampleCount = 0;
    this.cursor = 0;
    this.downStreak = 0;
    this.upStreak = 0;
  }

  /** Registra a duração de um frame de apresentação (segundos). */
  sampleFrame(dtSeconds: number): void {
    if (!this.adaptive) return;
    if (!(dtSeconds > 0)) return;
    this.samples[this.cursor] = dtSeconds;
    this.cursor = (this.cursor + 1) % WINDOW_SIZE;
    if (this.sampleCount < WINDOW_SIZE) this.sampleCount += 1;
  }

  /**
   * Avalia uma troca de tier na fronteira de ponto. Devolve o tier novo ou null.
   * A janela é consumida (zerada) a cada avaliação para medir apenas o trecho seguinte.
   */
  evaluateAtBreak(): number | null {
    if (!this.adaptive) return null;
    if (this.sampleCount < MIN_SAMPLES) return null;
    const p95 = this.percentile95();
    this.sampleCount = 0;
    this.cursor = 0;

    if (this.cooldown > 0) {
      this.cooldown -= 1;
      this.downStreak = 0;
      this.upStreak = 0;
      return null;
    }

    if (p95 > P95_DOWN_SECONDS) {
      this.downStreak += 1;
      this.upStreak = 0;
      if (this.downStreak >= DOWN_STREAK && this.currentTier > 0) {
        this.applyChange(this.currentTier - 1);
        return this.currentTier;
      }
      return null;
    }
    if (p95 < P95_UP_SECONDS) {
      this.upStreak += 1;
      this.downStreak = 0;
      if (this.upStreak >= UP_STREAK && this.currentTier < QUALITY_TIER_COUNT - 1) {
        this.applyChange(this.currentTier + 1);
        return this.currentTier;
      }
      return null;
    }
    this.downStreak = 0;
    this.upStreak = 0;
    return null;
  }

  private applyChange(tier: number): void {
    this.currentTier = tier;
    this.downStreak = 0;
    this.upStreak = 0;
    this.cooldown = COOLDOWN_EVALUATIONS;
  }

  private percentile95(): number {
    const active = Array.from(this.samples.subarray(0, this.sampleCount)).sort((a, b) => a - b);
    const rank = 0.95 * (active.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return active[lo] + (active[hi] - active[lo]) * (rank - lo);
  }
}
