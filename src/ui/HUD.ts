import { TeamSide } from '../core/constants';
import { normalizeHudScale, reduceHint, type HintState, type HudScale } from './HudPreferences';

// Feedback visual da escolha transitória de levantamento. A direção agora vem do InputFrame;
// estes elementos não são botões e nunca sintetizam teclado.
export const ZONE_LABELS = ['← ESQUERDA', 'AUTO', 'DIREITA →'] as const;

// HUD em HTML/CSS sobre o canvas: placar, medidor de saque, banners, dicas, zonas.
export class HUD {
  private root: HTMLElement;
  private scoreEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerSub!: HTMLElement;
  private hintEl!: HTMLElement;
  private captionEl!: HTMLElement;
  private meterWrap!: HTMLElement;
  private meterFill!: HTMLElement;
  private zonesEl!: HTMLElement;
  private bannerTimer = 0;
  private hintState: HintState = { text: '', remaining: 0 };
  private captionState: HintState = { text: '', remaining: 0 };

  constructor(
    parent: HTMLElement,
    private touchMode = false,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="scoreboard">
        <div class="team home"><span class="name">VOCÊ</span><span class="serve-dot" id="serve-home">●</span></div>
        <div class="score-block"><div class="score" id="score-main">0 : 0</div><div class="sets" id="score-sets">SET 1 · 0 — 0</div></div>
        <div class="team away"><span class="serve-dot" id="serve-away">●</span><span class="name">CPU</span></div>
      </div>
      <div id="banner"><div id="banner-text"></div><div id="banner-sub"></div></div>
      <div id="hint"></div>
      <div id="caption" role="status" aria-live="polite"></div>
      <div id="meter"><div id="meter-perfect"></div><div id="meter-fill"></div></div>
      <div id="zones" aria-label="Direção do levantamento">
        ${ZONE_LABELS.map((label, zone) => `<span data-z="${zone}">${label}</span>`).join('')}
      </div>
    `;
    parent.appendChild(this.root);
    this.scoreEl = this.root.querySelector('#score-main')!;
    this.bannerEl = this.root.querySelector('#banner-text')!;
    this.bannerSub = this.root.querySelector('#banner-sub')!;
    this.hintEl = this.root.querySelector('#hint')!;
    this.captionEl = this.root.querySelector('#caption')!;
    this.meterWrap = this.root.querySelector('#meter')!;
    this.meterFill = this.root.querySelector('#meter-fill')!;
    this.zonesEl = this.root.querySelector('#zones')!;
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setScale(scale: HudScale): void {
    this.root.style.setProperty('--hud-scale', String(normalizeHudScale(scale)));
  }

  setScore(h: number, a: number, hs: number, as: number, setNum: number, serving: TeamSide): void {
    this.scoreEl.textContent = `${h} : ${a}`;
    this.root.querySelector('#score-sets')!.textContent = `SET ${setNum} · ${hs} — ${as}`;
    (this.root.querySelector('#serve-home') as HTMLElement).style.opacity =
      serving === TeamSide.HOME ? '1' : '0.12';
    (this.root.querySelector('#serve-away') as HTMLElement).style.opacity =
      serving === TeamSide.AWAY ? '1' : '0.12';
    this.scoreEl.classList.remove('pop');
    void (this.scoreEl as HTMLElement).offsetWidth;
    this.scoreEl.classList.add('pop');
  }

  banner(text: string, sub = ''): void {
    if (!text && !sub) {
      this.bannerEl.parentElement!.classList.remove('show');
      return;
    }
    this.bannerEl.textContent = text;
    this.bannerSub.textContent = sub;
    const el = this.bannerEl.parentElement!;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.bannerTimer = 2.2;
  }

  hint(text: string): void {
    if (this.touchMode && text) {
      // traduz as dicas de teclado para os controles de toque
      text = text
        .replace(/setas/gi, 'direcional')
        .replace('SEGURE ESPAÇO', 'SEGURE 🏐')
        .replace('ESPAÇO pula', '🏐 pula')
        .replace('ESPAÇO no momento do toque', '🏐 no momento do toque')
        .replace('ESPAÇO pula!', '🏐 pula!')
        .replace('ESPAÇO', '🏐')
        .replace('A/D desliza na rede', 'direcional desliza na rede');
    }
    this.hintState = reduceHint(this.hintState, { type: 'show', text, seconds: 2.5 });
    this.renderHint();
  }

  caption(text: string, durationMs: number): void {
    this.captionState = reduceHint(this.captionState, {
      type: 'show',
      text,
      seconds: Math.max(0, durationMs) / 1000,
    });
    this.renderCaption();
  }

  serveMeter(visible: boolean, value = 0): void {
    this.meterWrap.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.meterFill.style.width = `${value * 100}%`;
      const inPerfect = value >= 0.72 && value <= 0.92;
      this.meterFill.style.background = inPerfect
        ? 'linear-gradient(90deg,#43e97b,#38f9d7)'
        : value > 0.92
          ? 'linear-gradient(90deg,#f5576c,#f093fb)'
          : 'linear-gradient(90deg,#4facfe,#00f2fe)';
    }
  }

  zoneHint(zone: number | null): void {
    this.zonesEl.style.display = zone === null ? 'none' : 'flex';
    this.zonesEl.querySelectorAll('span').forEach((s) => {
      s.classList.toggle('active', s.dataset.z === String(zone));
    });
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEl.parentElement!.classList.remove('show');
      }
    }
    const nextHint = reduceHint(this.hintState, { type: 'tick', dt });
    if (nextHint.text !== this.hintState.text) {
      this.hintState = nextHint;
      this.renderHint();
    } else {
      this.hintState = nextHint;
    }
    const nextCaption = reduceHint(this.captionState, { type: 'tick', dt });
    if (nextCaption.text !== this.captionState.text) {
      this.captionState = nextCaption;
      this.renderCaption();
    } else {
      this.captionState = nextCaption;
    }
  }

  private renderHint(): void {
    this.hintEl.textContent = this.hintState.text;
    this.hintEl.style.opacity = this.hintState.text ? '1' : '0';
  }

  private renderCaption(): void {
    this.captionEl.textContent = this.captionState.text;
    this.captionEl.style.opacity = this.captionState.text ? '1' : '0';
  }
}
