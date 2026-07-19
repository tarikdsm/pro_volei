import type { InputCancelReason, InputSink } from '../core/input/InputFrame';
import { screenAxisFromStick } from './touchMapping';
import { solveTouchLayout } from './TouchLayout';
import type { SafeInsets, ViewportSize } from '../systems/camera/CameraFrame';

// Rótulos de acessibilidade (role + aria-label, pt-BR) dos controles de toque.
export const TOUCH_A11Y = {
  'tc-move-zone': { role: 'application', ariaLabel: 'Direcional de movimento' },
  'tc-action-zone': { role: 'button', ariaLabel: 'Sacar, passar, pular ou bloquear' },
} as const;

const TOUCH_KNOB_RADIUS = 29;

/** Controles touch ligados diretamente ao vocabulário semântico do jogo. */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly moveZone: HTMLElement;
  private readonly actionButton: HTMLElement;
  private readonly actionZone: HTMLElement;
  private stickPointer: number | null = null;
  private actionPointer: number | null = null;
  private baseCx = 0;
  private baseCy = 0;
  private stickRadius = 52;
  private stickTravelRadius = 23;

  constructor(
    parent: HTMLElement,
    private readonly input: InputSink,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.innerHTML = `
      <div id="tc-action-zone"><div id="tc-action" aria-hidden="true">🏐</div></div>
      <div id="tc-move-zone"><div id="tc-stick" aria-hidden="true"><div id="tc-knob"></div></div></div>
    `;
    parent.appendChild(this.root);
    this.moveZone = this.root.querySelector('#tc-move-zone')!;
    this.stickBase = this.root.querySelector('#tc-stick')!;
    this.knob = this.root.querySelector('#tc-knob')!;
    this.actionZone = this.root.querySelector('#tc-action-zone')!;
    this.actionButton = this.root.querySelector('#tc-action')!;

    for (const [id, a11y] of Object.entries(TOUCH_A11Y)) {
      const element = this.root.querySelector(`#${id}`);
      if (element) {
        element.setAttribute('role', a11y.role);
        element.setAttribute('aria-label', a11y.ariaLabel);
      }
    }
    this.bindStick();
    this.bindAction();
    this.refreshLayout();
    this.show(false);
  }

  /** Recalcula hit areas e posições de repouso sem invadir o terço central. */
  refreshLayout(
    viewport: ViewportSize = { width: window.innerWidth, height: window.innerHeight },
    insets: SafeInsets = this.readSafeInsets(),
  ): void {
    const layout = solveTouchLayout(viewport, insets);
    this.stickRadius = layout.stickRadius;
    this.stickTravelRadius = Math.max(1, layout.stickRadius - TOUCH_KNOB_RADIUS);
    this.stickBase.style.setProperty('--touch-stick-diameter', `${layout.stickRadius * 2}px`);
    this.stickBase.style.setProperty('--touch-knob-diameter', `${TOUCH_KNOB_RADIUS * 2}px`);
    this.placeRect(this.actionZone, layout.action);
    this.placeRect(this.moveZone, layout.movement);
    if (this.actionPointer === null) {
      this.positionVisual(
        this.actionButton,
        layout.action.width * 0.48,
        layout.action.height * 0.72,
      );
    }
    if (this.stickPointer === null) {
      this.positionVisual(
        this.stickBase,
        layout.movement.width * 0.52,
        layout.movement.height * 0.72,
      );
    }
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible && (this.stickPointer !== null || this.actionPointer !== null)) {
      this.cancel('point-end');
    }
  }

  /** Cancela input e ownership juntos; usado pelo coordenador em pausa e lifecycle. */
  cancel(reason: InputCancelReason, atMs = this.now()): void {
    this.resetPointers();
    this.input.cancel(reason, atMs);
  }

  /** Limpa somente a superfície touch quando outro adaptador já cancelou o hub (ex.: blur). */
  resetPointers(): void {
    const stickPointer = this.stickPointer;
    const actionPointer = this.actionPointer;
    this.stickPointer = null;
    this.actionPointer = null;
    this.resetVisuals();
    this.releaseCapture(this.moveZone, stickPointer);
    this.releaseCapture(this.actionZone, actionPointer);
  }

  private bindStick(): void {
    const element = this.moveZone;
    element.addEventListener('pointerdown', (event) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = event.pointerId;
      const bounds = element.getBoundingClientRect();
      this.baseCx = Math.max(
        bounds.left + this.stickRadius,
        Math.min(bounds.right - this.stickRadius, event.clientX),
      );
      this.baseCy = Math.max(
        bounds.top + this.stickRadius,
        Math.min(bounds.bottom - this.stickRadius, event.clientY),
      );
      this.positionVisual(this.stickBase, this.baseCx - bounds.left, this.baseCy - bounds.top);
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
    const radius = this.stickTravelRadius;
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
    const element = this.actionZone;
    element.addEventListener('pointerdown', (event) => {
      if (this.actionPointer !== null) return;
      this.actionPointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      this.actionButton.classList.add('pressed');
      this.input.setAction('touch', true, this.now());
      event.preventDefault();
    });
    element.addEventListener('pointerup', (event) => {
      if (event.pointerId !== this.actionPointer) return;
      this.actionPointer = null;
      this.actionButton.classList.remove('pressed');
      this.input.setAction('touch', false, this.now());
      event.preventDefault();
    });
    element.addEventListener('pointercancel', (event) => this.onPointerCancelled(event));
    element.addEventListener('lostpointercapture', (event) => this.onPointerCancelled(event));
  }

  private onPointerCancelled(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer && event.pointerId !== this.actionPointer) return;
    this.cancel('pointer-cancel');
  }

  private resetStick(atMs: number): void {
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.input.setMove('touch', { right: 0, up: 0 }, atMs);
  }

  private resetVisuals(): void {
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.actionButton.classList.remove('pressed');
  }

  private releaseCapture(element: HTMLElement, pointerId: number | null): void {
    if (pointerId === null || !element.hasPointerCapture(pointerId)) return;
    element.releasePointerCapture(pointerId);
  }

  private placeRect(
    element: HTMLElement,
    rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): void {
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  private positionVisual(element: HTMLElement, x: number, y: number): void {
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  private readSafeInsets(): SafeInsets {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
    return {
      top: read('--safe-area-top'),
      right: read('--safe-area-right'),
      bottom: read('--safe-area-bottom'),
      left: read('--safe-area-left'),
    };
  }
}
