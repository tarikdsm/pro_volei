export interface AppRecoveryHandlers {
  readonly onBlock: () => void;
  readonly onRestore: () => void;
  readonly resetRenderer: () => void;
}

type ReloadPage = () => void;

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === 'string' && value.trim()) return value;
  return 'erro inesperado sem detalhes';
}

/** Boundary DOM da aplicação: concentra fallback fatal e o único retry do contexto WebGL. */
export class AppRecovery {
  private readonly root: HTMLElement;
  private readonly message: HTMLElement;
  private readonly restart: HTMLButtonElement;
  private handlers: AppRecoveryHandlers | null = null;
  private globalTarget: Window | null = null;
  private blockedValue = false;
  private fatalValue = false;
  private lossActive = false;
  private restoredOnce = false;

  constructor(
    parent: HTMLElement,
    private readonly reloadPage: ReloadPage = () => location.reload(),
  ) {
    this.root = document.createElement('section');
    this.root.id = 'app-recovery';
    this.root.setAttribute('role', 'alert');
    this.root.setAttribute('aria-live', 'assertive');
    this.root.setAttribute('aria-atomic', 'true');
    this.root.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'recovery-panel';
    const title = document.createElement('h1');
    title.textContent = 'PRÓ VOLEI';
    this.message = document.createElement('p');
    this.restart = document.createElement('button');
    this.restart.type = 'button';
    this.restart.textContent = 'REINICIAR COM SEGURANÇA';
    this.restart.addEventListener('click', () => this.reloadPage());
    panel.append(title, this.message, this.restart);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
  }

  get blocked(): boolean {
    return this.blockedValue;
  }

  showRecovery(message: string, restartable: boolean): void {
    this.message.textContent = message;
    this.restart.hidden = !restartable;
    this.root.hidden = false;
    if (restartable) this.restart.focus();
  }

  showFatal(message: string): void {
    this.block();
    this.fatalValue = true;
    this.showRecovery(message, true);
  }

  hideRecovery(): void {
    this.root.hidden = true;
    this.restart.hidden = true;
  }

  bindGlobal(target: Window): void {
    if (this.globalTarget) return;
    this.globalTarget = target;
    target.addEventListener('error', (event) => {
      event.preventDefault();
      this.showFatal(`Erro inesperado: ${errorMessage(event.error ?? event.message)}.`);
    });
    target.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      this.showFatal(`Erro inesperado: ${errorMessage(event.reason)}.`);
    });
  }

  bindRenderer(canvas: HTMLCanvasElement, handlers: AppRecoveryHandlers): void {
    this.handlers = handlers;
    if (this.blockedValue) handlers.onBlock();

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (this.fatalValue) return;
      if (this.lossActive) return;
      if (this.restoredOnce) {
        this.showFatal(
          'A conexão gráfica falhou novamente. Reinicie para continuar com segurança.',
        );
        return;
      }
      this.lossActive = true;
      this.block();
      this.showRecovery('O vídeo foi interrompido. Tentando restaurar a renderização…', false);
    });

    canvas.addEventListener('webglcontextrestored', () => {
      if (this.fatalValue || !this.lossActive || this.restoredOnce) return;
      try {
        handlers.resetRenderer();
      } catch (error) {
        this.lossActive = false;
        this.showFatal(`Não foi possível restaurar o vídeo: ${errorMessage(error)}.`);
        return;
      }
      this.lossActive = false;
      this.restoredOnce = true;
      this.blockedValue = false;
      this.hideRecovery();
      handlers.onRestore();
    });
  }

  private block(): void {
    if (this.blockedValue) return;
    this.blockedValue = true;
    this.handlers?.onBlock();
  }
}
