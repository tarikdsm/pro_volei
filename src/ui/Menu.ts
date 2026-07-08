import { DIFFICULTIES, MATCH_FORMATS } from '../core/constants';
import { MatchStats } from '../game/Match';

// Telas: título (com seleção de dificuldade/formato), pausa e fim de partida.
export class Menu {
  private root: HTMLElement;
  difficulty = 1;
  format = 0;
  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private touchMode = false,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    parent.appendChild(this.root);
    this.showTitle();
  }

  showTitle(): void {
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
          <div><b>direcional</b> mover e mirar · <b>toque na zona</b> para escolher o ataque</div>
          <div>📱 jogue na horizontal para a melhor experiência</div>
          `
              : `
          <div><b>ESPAÇO</b> sacar / passar / pular / bloquear</div>
          <div><b>WASD</b> mover e mirar · <b>A/W/D</b> escolher zona de ataque</div>
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
        this.difficulty = Number((b as HTMLElement).dataset.i);
        this.root.querySelectorAll('#opt-diff button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
    this.root.querySelectorAll('#opt-fmt button').forEach((b) => {
      b.addEventListener('click', () => {
        this.format = Number((b as HTMLElement).dataset.i);
        this.root.querySelectorAll('#opt-fmt button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
  }

  showPause(): void {
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
    this.root.querySelector('#btn-again')!.addEventListener('click', () => location.reload());
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }
}
