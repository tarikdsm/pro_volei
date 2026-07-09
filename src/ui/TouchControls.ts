// Controles de toque para celular: joystick virtual (esq.), botão de ação (dir.) e pausa.
// Estratégia: sintetizar eventos de teclado (WASD/Espaço/Esc) — a lógica do jogo
// continua lendo o mesmo Input, sem nenhuma mudança no Match.
// O mapeamento do joystick é relativo à TELA e depende da câmera atual:
//  - câmera de saque (atrás da sacadora): cima = mais fundo, direita = direita
//  - câmera broadcast (lateral): direita = em direção à rede adversária, cima = afastar

import { stickKeys } from './touchMapping';

export type CamModeGetter = () => string;

// Rótulos de acessibilidade (role + aria-label, pt-BR) dos controles de toque.
// Mapa exportado para permitir teste puro sem DOM (ver TouchControls.a11y.spec.ts) e manter
// uma única fonte de verdade. É só semântica/rotulagem para leitores de tela em telas de toque:
// os elementos continuam <div> — sem tabindex e sem handler de teclado — porque o Input já lê
// as teclas globalmente e os toques as sintetizam no window (tornar o botão de ação focável
// dispararia Space nativo + handler global = disparo duplo).
export const TOUCH_A11Y = {
  'tc-stick': { role: 'application', ariaLabel: 'Direcional de movimento' },
  'tc-action': { role: 'button', ariaLabel: 'Sacar, passar, pular ou bloquear' },
  'tc-pause': { role: 'button', ariaLabel: 'Pausar' },
} as const;

export class TouchControls {
  private root: HTMLElement;
  private knob: HTMLElement;
  private stickBase: HTMLElement;
  private activeKeys = new Set<string>();
  private stickPointer: number | null = null;
  private baseCx = 0;
  private baseCy = 0;

  constructor(
    parent: HTMLElement,
    private camMode: CamModeGetter,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.innerHTML = `
      <div id="tc-stick"><div id="tc-knob"></div></div>
      <div id="tc-action">🏐</div>
      <div id="tc-pause">⏸</div>
    `;
    parent.appendChild(this.root);
    this.stickBase = this.root.querySelector('#tc-stick')!;
    this.knob = this.root.querySelector('#tc-knob')!;

    // rotula os controles para leitores de tela (não altera comportamento nem layout)
    for (const [id, a11y] of Object.entries(TOUCH_A11Y)) {
      const el = this.root.querySelector(`#${id}`);
      if (el) {
        el.setAttribute('role', a11y.role);
        el.setAttribute('aria-label', a11y.ariaLabel);
      }
    }
    this.knob.setAttribute('aria-hidden', 'true'); // knob é puramente visual

    this.bindStick();
    this.bindButton(this.root.querySelector('#tc-action')!, 'Space');
    this.bindPause(this.root.querySelector('#tc-pause')!);
    this.show(false);
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.releaseAll();
  }

  private key(code: string, down: boolean): void {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  }

  private releaseAll(): void {
    for (const k of this.activeKeys) this.key(k, false);
    this.activeKeys.clear();
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private bindStick(): void {
    const el = this.stickBase;
    el.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      const r = el.getBoundingClientRect();
      this.baseCx = r.left + r.width / 2;
      this.baseCy = r.top + r.height / 2;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* eventos sintéticos não capturam */
      }
      this.updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.releaseAll();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private updateStick(px: number, py: number): void {
    const R = 52;
    let dx = px - this.baseCx;
    let dy = py - this.baseCy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // eixos de tela → teclas conforme a câmera (lógica pura em touchMapping.stickKeys)
    const serveCam = this.camMode() === 'serveHome';
    const want = stickKeys(dx, dy, R, serveCam);
    for (const k of this.activeKeys)
      if (!want.has(k)) {
        this.key(k, false);
        this.activeKeys.delete(k);
      }
    for (const k of want)
      if (!this.activeKeys.has(k)) {
        this.key(k, true);
        this.activeKeys.add(k);
      }
  }

  private bindButton(el: HTMLElement, code: string): void {
    el.addEventListener('pointerdown', (e) => {
      el.classList.add('pressed');
      this.key(code, true);
      e.preventDefault();
    });
    const up = () => {
      el.classList.remove('pressed');
      this.key(code, false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  private bindPause(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      this.key('Escape', true);
      this.key('Escape', false);
      e.preventDefault();
    });
  }
}
