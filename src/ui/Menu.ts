import { DIFFICULTIES, MATCH_FORMATS } from '../core/constants';
import { MatchStats } from '../game/Match';

// Telas: título (com seleção de dificuldade/formato), pausa, fim de partida e, no touch,
// a pausa de portrait (§7.1) e a vitória compacta com contagem de revanche.
export class Menu {
  private root: HTMLElement;
  difficulty: 0 | 1 | 2 = 1;
  format: 0 | 1 | 2 = 0;
  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onSelectionChange: ((difficulty: 0 | 1 | 2, format: 0 | 1 | 2) => void) | null = null;
  private countdownId: ReturnType<typeof setInterval> | null = null;

  constructor(
    parent: HTMLElement,
    private touchMode = false,
    initial: { readonly difficulty?: number; readonly format?: number } = {},
  ) {
    this.difficulty = validIndex(initial.difficulty, DIFFICULTIES.length, 1);
    this.format = validIndex(initial.format, MATCH_FORMATS.length, 0);
    this.root = document.createElement('div');
    this.root.id = 'menu';
    parent.appendChild(this.root);
    this.showTitle();
  }

  showTitle(): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel title-panel">
        <h1 class="logo">🏐 PRÓ <span>VOLEI</span></h1>
        <p class="tagline">6×6 · quadra oficial · você contra a máquina</p>
        <div class="opt-group">
          <label>DIFICULDADE</label>
          <div class="opts" id="opt-diff">
            ${DIFFICULTIES.map((d, i) => `<button data-i="${i}" class="${i === this.difficulty ? 'sel' : ''}">${d.name}</button>`).join('')}
          </div>
        </div>
        <div class="opt-group">
          <label>PARTIDA</label>
          <div class="opts" id="opt-fmt">
            ${MATCH_FORMATS.map((f, i) => `<button data-i="${i}" class="${i === this.format ? 'sel' : ''}">${f.name}</button>`).join('')}
          </div>
        </div>
        <button id="btn-start" class="big-btn">JOGAR</button>
        <div class="controls-help">
          ${
            this.touchMode
              ? `
          <div><b>🏐 botão</b> sacar / passar / pular / bloquear (segure para carregar o saque)</div>
          <div><b>direcional</b> mover, mirar e escolher o ataque</div>
          <div>📱 jogue na horizontal para a melhor experiência</div>
          `
              : `
          <div><b>ESPAÇO</b> sacar / passar / pular / bloquear</div>
          <div><b>SETAS</b> mover, mirar e escolher o ataque</div>
          <div><b>ESC</b> pausa</div>
          `
          }
        </div>
      </div>`;
    this.bindOpts();
    this.root.querySelector('#btn-start')!.addEventListener('click', () => {
      this.hide();
      this.onStart?.();
    });
  }

  private bindOpts(): void {
    this.root.querySelectorAll('#opt-diff button').forEach((b) => {
      b.addEventListener('click', () => {
        this.difficulty = validIndex(Number((b as HTMLElement).dataset.i), DIFFICULTIES.length, 1);
        this.root.querySelectorAll('#opt-diff button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        this.onSelectionChange?.(this.difficulty, this.format);
      });
    });
    this.root.querySelectorAll('#opt-fmt button').forEach((b) => {
      b.addEventListener('click', () => {
        this.format = validIndex(Number((b as HTMLElement).dataset.i), MATCH_FORMATS.length, 0);
        this.root.querySelectorAll('#opt-fmt button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        this.onSelectionChange?.(this.difficulty, this.format);
      });
    });
  }

  /** Pausa de portrait (§7.1): instrução de girar + meta (novo jogo/sair) — só no touch. */
  showPortraitBreak(): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel" id="portrait-break">
        <h2>↻ Gire o celular</h2>
        <p class="tagline">a partida continua na horizontal</p>
        <div class="opt-group">
          <label>DIFICULDADE</label>
          <div class="opts" id="opt-diff">
            ${DIFFICULTIES.map((d, i) => `<button data-i="${i}" class="${i === this.difficulty ? 'sel' : ''}">${d.name}</button>`).join('')}
          </div>
        </div>
        <div class="opt-group">
          <label>PARTIDA</label>
          <div class="opts" id="opt-fmt">
            ${MATCH_FORMATS.map((f, i) => `<button data-i="${i}" class="${i === this.format ? 'sel' : ''}">${f.name}</button>`).join('')}
          </div>
        </div>
        <button id="btn-new" class="big-btn">NOVO JOGO</button>
        <button id="btn-quit-portrait" class="ghost-btn">SAIR</button>
      </div>`;
    this.bindOpts();
    this.root.querySelector('#btn-new')!.addEventListener('click', () => {
      this.hide();
      this.onStart?.();
    });
    this.root.querySelector('#btn-quit-portrait')!.addEventListener('click', () => {
      location.reload();
    });
  }

  /** Vitória compacta em landscape: contagem regressiva de revanche automática (§7.1). */
  showVictoryCompact(
    homeWon: boolean,
    scoreline: string,
    seconds: number,
    onExpire: () => void,
  ): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    let remaining = Math.max(1, Math.round(seconds));
    this.root.innerHTML = `
      <div class="panel compact-victory" id="compact-victory">
        <h2 class="endtitle ${homeWon ? 'win' : 'lose'}">${homeWon ? '🏆 VITÓRIA' : 'DERROTA'} · Sets ${scoreline}</h2>
        <p class="tagline">Revanche em <span id="rematch-count">${remaining}</span> s · gire para o menu</p>
      </div>`;
    const label = this.root.querySelector('#rematch-count')!;
    this.countdownId = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        label.textContent = String(remaining);
        return;
      }
      this.clearCountdown();
      this.hide();
      onExpire();
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownId !== null) {
      clearInterval(this.countdownId);
      this.countdownId = null;
    }
  }

  showPause(): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel">
        <h2>PAUSA</h2>
        <button id="btn-resume" class="big-btn">CONTINUAR</button>
        <button id="btn-quit" class="ghost-btn">SAIR PARA O MENU</button>
      </div>`;
    this.root.querySelector('#btn-resume')!.addEventListener('click', () => {
      this.hide();
      this.onResume?.();
    });
    this.root.querySelector('#btn-quit')!.addEventListener('click', () => location.reload());
  }

  showVictory(homeWon: boolean, stats: MatchStats, scoreline: string): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel">
        <h1 class="endtitle ${homeWon ? 'win' : 'lose'}">${homeWon ? '🏆 VITÓRIA!' : 'DERROTA'}</h1>
        <p class="tagline">Sets ${scoreline}</p>
        <div class="stats">
          <div><span>${stats.points[0]}</span>seus pontos</div>
          <div><span>${stats.aces}</span>aces</div>
          <div><span>${stats.blocks}</span>bloqueios</div>
          <div><span>${stats.longestRally}</span>maior rally</div>
        </div>
        <button id="btn-again" class="big-btn">JOGAR DE NOVO</button>
      </div>`;
    // Revanche in-place (5A): preserva dificuldade/formato escolhidos, sem recarregar a página.
    this.root.querySelector('#btn-again')!.addEventListener('click', () => {
      this.hide();
      this.onStart?.();
    });
  }

  hide(): void {
    this.clearCountdown();
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }
}

function validIndex(value: number | undefined, length: number, fallback: 0 | 1 | 2): 0 | 1 | 2 {
  return Number.isInteger(value) && value !== undefined && value >= 0 && value < length
    ? (value as 0 | 1 | 2)
    : fallback;
}
