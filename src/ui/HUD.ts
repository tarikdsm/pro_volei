import { TeamSide } from '../core/constants';

// Zonas de ataque tocáveis (celular): código de tecla sintetizada + rótulo de acessibilidade (pt-BR).
// Índices alinhados: 0 = esquerda (KeyA), 1 = centro (KeyW), 2 = direita (KeyD).
// Exportados para permitir teste puro sem DOM (ver HUD.a11y.spec.ts).
export const ZONE_CODES = ['KeyA', 'KeyW', 'KeyD'] as const;
export const ZONE_A11Y = [
  'Atacar pela esquerda',
  'Atacar pelo centro',
  'Atacar pela direita',
] as const;

// HUD em HTML/CSS sobre o canvas: placar, medidor de saque, banners, dicas, zonas.
export class HUD {
  private root: HTMLElement;
  private scoreEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerSub!: HTMLElement;
  private hintEl!: HTMLElement;
  private meterWrap!: HTMLElement;
  private meterFill!: HTMLElement;
  private zonesEl!: HTMLElement;
  private bannerTimer = 0;

  constructor(
    parent: HTMLElement,
    private touchMode = false,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="scoreboard">
        <div class="team home"><span class="name">VOCÊ</span><span class="serve-dot" id="serve-home">●</span></div>
        <div class="score" id="score-main">0 : 0</div>
        <div class="team away"><span class="serve-dot" id="serve-away">●</span><span class="name">CPU</span></div>
        <div class="sets" id="score-sets">Set 1 · 0 — 0</div>
      </div>
      <div id="banner"><div id="banner-text"></div><div id="banner-sub"></div></div>
      <div id="hint"></div>
      <div id="meter"><div id="meter-perfect"></div><div id="meter-fill"></div></div>
      <div id="zones">
        <span data-z="0">A · ESQUERDA</span><span data-z="1">W · CENTRO</span><span data-z="2">D · DIREITA</span>
      </div>
    `;
    parent.appendChild(this.root);
    this.scoreEl = this.root.querySelector('#score-main')!;
    this.bannerEl = this.root.querySelector('#banner-text')!;
    this.bannerSub = this.root.querySelector('#banner-sub')!;
    this.hintEl = this.root.querySelector('#hint')!;
    this.meterWrap = this.root.querySelector('#meter')!;
    this.meterFill = this.root.querySelector('#meter-fill')!;
    this.zonesEl = this.root.querySelector('#zones')!;

    // no celular as zonas são botões tocáveis (sintetizam A/W/D)
    if (this.touchMode) {
      this.zonesEl.classList.add('tappable');
      this.zonesEl.querySelectorAll('span').forEach((s) => {
        const z = Number((s as HTMLElement).dataset.z);
        // rotula a zona para leitores de tela (não altera comportamento nem layout)
        s.setAttribute('role', 'button');
        s.setAttribute('aria-label', ZONE_A11Y[z]);
        s.addEventListener('pointerdown', (e) => {
          const code = ZONE_CODES[z];
          window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
          e.preventDefault();
        });
      });
    }
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setScore(h: number, a: number, hs: number, as: number, setNum: number, serving: TeamSide): void {
    this.scoreEl.textContent = `${h} : ${a}`;
    this.root.querySelector('#score-sets')!.textContent = `Set ${setNum} · ${hs} — ${as}`;
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
        .replace('SEGURE ESPAÇO', 'SEGURE 🏐')
        .replace('ESPAÇO pula', '🏐 pula')
        .replace('ESPAÇO no momento do toque', '🏐 no momento do toque')
        .replace('ESPAÇO pula!', '🏐 pula!')
        .replace('ESPAÇO', '🏐')
        .replace('WASD ajusta a mira', 'direcional ajusta a mira')
        .replace('WASD move', 'direcional move')
        .replace('WASD mira a cortada', 'direcional mira')
        .replace('A esquerda · W centro · D direita', 'toque na zona de ataque')
        .replace('A/D desliza na rede', 'direcional desliza na rede');
    }
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = text ? '1' : '0';
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
  }
}
