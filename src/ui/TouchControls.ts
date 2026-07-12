import type { InputSink } from '../core/input/InputFrame';
import { screenAxisFromStick } from './touchMapping';

// Rótulos de acessibilidade (role + aria-label, pt-BR) dos controles de toque.
export const TOUCH_A11Y = {
  'tc-stick': { role: 'application', ariaLabel: 'Direcional de movimento' },
  'tc-action': { role: 'button', ariaLabel: 'Sacar, passar, pular ou bloquear' },
  'tc-pause': { role: 'button', ariaLabel: 'Pausar' },
} as const;

/** Controles touch ligados diretamente ao vocabulário semântico do jogo. */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly actionButton: HTMLElement;
  private stickPointer: number | null = null;
  private actionPointer: number | null = null;
  private baseCx = 0;
  private baseCy = 0;

  constructor(
    parent: HTMLElement,
    private readonly input: InputSink,
    private readonly onPause: () => void,
    private readonly now: () => number = () => performance.now(),
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
    this.actionButton = this.root.querySelector('#tc-action')!;

    for (const [id, a11y] of Object.entries(TOUCH_A11Y)) {
      const element = this.root.querySelector(`#${id}`);
      if (element) {
        element.setAttribute('role', a11y.role);
        element.setAttribute('aria-label', a11y.ariaLabel);
      }
    }
    this.knob.setAttribute('aria-hidden', 'true');

    this.bindStick();
    this.bindAction();
    this.bindPause(this.root.querySelector('#tc-pause')!);
    this.show(false);
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.cancelActivePointers();
  }

  private bindStick(): void {
    const element = this.stickBase;
    element.addEventListener('pointerdown', (event) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = event.pointerId;
      const bounds = element.getBoundingClientRect();
      this.baseCx = bounds.left + bounds.width / 2;
      this.baseCy = bounds.top + bounds.height / 2;
      element.setPointerCapture(event.pointerId);
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
    });
    element.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
    });
    element.addEventListener('pointerup', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.resetStick(this.now());
      event.preventDefault();
    });
    element.addEventListener('pointercancel', (event) => this.onPointerCancelled(event));
    element.addEventListener('lostpointercapture', (event) => this.onPointerCancelled(event));
  }

  private updateStick(pointerX: number, pointerY: number): void {
    const radius = 52;
    let dx = pointerX - this.baseCx;
    let dy = pointerY - this.baseCy;
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
    }

    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.setMove('touch', screenAxisFromStick(dx, dy, radius), this.now());
  }

  private bindAction(): void {
    const element = this.actionButton;
    element.addEventListener('pointerdown', (event) => {
      if (this.actionPointer !== null) return;
      this.actionPointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      element.classList.add('pressed');
      this.input.setAction('touch', true, this.now());
      event.preventDefault();
    });
    element.addEventListener('pointerup', (event) => {
      if (event.pointerId !== this.actionPointer) return;
      this.actionPointer = null;
      element.classList.remove('pressed');
      this.input.setAction('touch', false, this.now());
      event.preventDefault();
    });
    element.addEventListener('pointercancel', (event) => this.onPointerCancelled(event));
    element.addEventListener('lostpointercapture', (event) => this.onPointerCancelled(event));
  }

  private bindPause(element: HTMLElement): void {
    element.addEventListener('pointerdown', (event) => {
      this.onPause();
      event.preventDefault();
    });
  }

  private onPointerCancelled(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer && event.pointerId !== this.actionPointer) return;
    this.stickPointer = null;
    this.actionPointer = null;
    this.resetVisuals();
    this.input.cancel('pointer-cancel', this.now());
  }

  private cancelActivePointers(): void {
    if (this.stickPointer !== null || this.actionPointer !== null) {
      this.input.cancel('point-end', this.now());
    }
    this.stickPointer = null;
    this.actionPointer = null;
    this.resetVisuals();
  }

  private resetStick(atMs: number): void {
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.input.setMove('touch', { right: 0, up: 0 }, atMs);
  }

  private resetVisuals(): void {
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.actionButton.classList.remove('pressed');
  }
}
