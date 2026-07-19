import { DIFFICULTIES, MATCH_FORMATS } from '../core/constants';
import { MatchStats } from '../game/Match';
import type { CosmeticCategory } from '../platform/save/SaveSchema';

export interface CupMenuRound {
  readonly name: string;
  readonly round: string;
  readonly identity: string;
  readonly rewardId: string;
  readonly losses: number;
  readonly status: 'won' | 'current' | 'locked';
}

export interface CupMenuState {
  readonly completed: boolean;
  readonly rounds: readonly CupMenuRound[];
}

export interface CupResultView {
  readonly homeWon: boolean;
  readonly stats: MatchStats;
  readonly scoreline: string;
  readonly status: 'retry' | 'next' | 'champion';
  readonly opponentName: string;
  readonly rewardId?: string;
}

export interface CosmeticMenuEntry {
  readonly id: string;
  readonly category: CosmeticCategory;
  readonly name: string;
  readonly requirement: string;
  readonly unlocked: boolean;
  readonly selected: boolean;
}

// Telas: título (com seleção de dificuldade/formato), pausa, fim de partida e, no touch,
// a pausa de portrait (§7.1) e a vitória compacta com contagem de revanche.
export class Menu {
  private root: HTMLElement;
  difficulty: 0 | 1 | 2 = 1;
  format: 0 | 1 | 2 = 0;
  onStart: (() => void) | null = null;
  onCupStart: (() => void) | null = null;
  onCupRestart: (() => void) | null = null;
  onCosmeticSelect: ((category: CosmeticCategory, id: string) => void) | null = null;
  onResume: (() => void) | null = null;
  onSelectionChange: ((difficulty: 0 | 1 | 2, format: 0 | 1 | 2) => void) | null = null;
  private countdownId: ReturnType<typeof setInterval> | null = null;
  private cupState: CupMenuState = { completed: false, rounds: [] };
  private cosmetics: readonly CosmeticMenuEntry[] = [];

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
        <div class="menu-actions">
          <button id="btn-start" class="big-btn">JOGAR</button>
          <button id="btn-cup" class="big-btn cup-btn">COPA</button>
          <button id="btn-cosmetics" class="big-btn cosmetics-btn">VISUAL</button>
        </div>
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
    this.root.querySelector('#btn-cup')!.addEventListener('click', () => this.showCup());
    this.root
      .querySelector('#btn-cosmetics')!
      .addEventListener('click', () => this.showCosmetics());
  }

  setCupState(state: CupMenuState): void {
    this.cupState = state;
  }

  setCosmeticsState(entries: readonly CosmeticMenuEntry[]): void {
    this.cosmetics = entries;
  }

  showCosmetics(back: 'title' | 'portrait' = 'title', mode: 'quick' | 'cup' = 'quick'): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    const categories = ['uniform', 'palette', 'court', 'effect'] as const;
    this.root.innerHTML = `
      <div class="panel cosmetics-panel">
        <h1 class="endtitle">VISUAL</h1>
        <p class="tagline">recompensas da Copa · apresentação sem vantagem</p>
        <div class="cosmetics-grid">
          ${categories
            .map(
              (category) => `
                <section class="cosmetic-category">
                  <h2>${categoryLabel(category)}</h2>
                  ${this.cosmetics
                    .filter((entry) => entry.category === category)
                    .map(
                      (entry) => `
                        <button
                          class="cosmetic-option ${entry.selected ? 'sel' : ''}"
                          data-category="${entry.category}"
                          data-id="${entry.id}"
                          aria-label="${escapeHtml(
                            entry.unlocked
                              ? `${entry.name}${entry.selected ? ', selecionado' : ''}`
                              : `${entry.name}, bloqueado: ${entry.requirement}`,
                          )}"
                          ${entry.unlocked ? '' : 'disabled'}
                        >
                          <strong>${escapeHtml(entry.name)}</strong>
                          <span>${escapeHtml(entry.unlocked ? (entry.selected ? 'SELECIONADO' : 'LIBERADO') : entry.requirement)}</span>
                        </button>`,
                    )
                    .join('')}
                </section>`,
            )
            .join('')}
        </div>
        <button id="btn-cosmetics-back" class="ghost-btn">VOLTAR</button>
      </div>`;
    this.root
      .querySelectorAll<HTMLButtonElement>('.cosmetic-option:not(:disabled)')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.onCosmeticSelect?.(
            button.dataset.category as CosmeticCategory,
            button.dataset.id ?? '',
          );
          this.showCosmetics(back, mode);
        });
      });
    this.root.querySelector('#btn-cosmetics-back')!.addEventListener('click', () => {
      if (back === 'portrait') this.showPortraitBreak(mode);
      else this.showTitle();
    });
  }

  showCup(): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    const champion = this.cupState.completed;
    this.root.innerHTML = `
      <div class="panel cup-panel">
        <h1 class="endtitle ${champion ? 'win' : ''}">${champion ? '🏆 CAMPEÃ DA COPA' : 'COPA PRÓ VOLEI'}</h1>
        <p class="tagline">quatro confrontos · formato Oficial 2.0</p>
        <div class="cup-bracket">
          ${this.cupState.rounds
            .map(
              (entry) => `
                <article class="cup-round ${entry.status}" data-status="${entry.status}">
                  <span class="cup-round-name">${escapeHtml(entry.round)}</span>
                  <strong>${escapeHtml(entry.name)}</strong>
                  <span>Identidade: ${escapeHtml(entry.identity)}</span>
                  <span>Recompensa: ${escapeHtml(rewardLabel(entry.rewardId))}</span>
                  ${entry.losses > 0 ? `<span>${entry.losses} tentativa${entry.losses === 1 ? '' : 's'} extra${entry.losses === 1 ? '' : 's'}</span>` : ''}
                </article>`,
            )
            .join('')}
        </div>
        <button id="btn-cup-play" class="big-btn">${champion ? 'REINICIAR COPA' : 'CONTINUAR COPA'}</button>
        <button id="btn-cup-back" class="ghost-btn">VOLTAR</button>
      </div>`;
    this.root.querySelector('#btn-cup-play')!.addEventListener('click', () => {
      if (champion) {
        this.onCupRestart?.();
        this.showCup();
        return;
      }
      this.hide();
      this.onCupStart?.();
    });
    this.root.querySelector('#btn-cup-back')!.addEventListener('click', () => this.showTitle());
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
  showPortraitBreak(mode: 'quick' | 'cup' = 'quick'): void {
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
        <button id="btn-visual-portrait" class="ghost-btn">VISUAL</button>
        <button id="btn-quit-portrait" class="ghost-btn">SAIR</button>
      </div>`;
    this.bindOpts();
    this.root.querySelector('#btn-new')!.addEventListener('click', () => {
      this.hide();
      if (mode === 'cup') this.onCupStart?.();
      else this.onStart?.();
    });
    this.root
      .querySelector('#btn-visual-portrait')!
      .addEventListener('click', () => this.showCosmetics('portrait', mode));
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

  showCupResult(view: CupResultView): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    const champion = view.status === 'champion';
    const action = champion
      ? 'VER CHAVE'
      : view.status === 'retry'
        ? 'REPETIR CONFRONTO'
        : 'PRÓXIMA PARTIDA';
    this.root.innerHTML = `
      <div class="panel cup-result-panel">
        <h1 class="endtitle ${view.homeWon ? 'win' : 'lose'}">${champion ? '🏆 CAMPEÃ DA COPA!' : view.homeWon ? 'VITÓRIA NA COPA' : 'DERROTA NA COPA'}</h1>
        <p class="tagline">${escapeHtml(view.opponentName)} · Sets ${escapeHtml(view.scoreline)}</p>
        <div class="stats">
          <div><span>${view.stats.points[0]}</span>seus pontos</div>
          <div><span>${view.stats.aces}</span>aces</div>
          <div><span>${view.stats.blocks}</span>bloqueios</div>
          <div><span>${view.stats.longestRally}</span>maior rally</div>
        </div>
        ${view.rewardId ? `<p class="cup-reward">Recompensa liberada: ${escapeHtml(rewardLabel(view.rewardId))}</p>` : ''}
        <button id="btn-cup-result" class="big-btn">${action}</button>
        <button id="btn-cup-result-back" class="ghost-btn">VOLTAR AO MENU</button>
      </div>`;
    this.root.querySelector('#btn-cup-result')!.addEventListener('click', () => {
      if (champion) this.showCup();
      else {
        this.hide();
        this.onCupStart?.();
      }
    });
    this.root
      .querySelector('#btn-cup-result-back')!
      .addEventListener('click', () => this.showTitle());
  }

  hide(): void {
    this.clearCountdown();
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }
}

function rewardLabel(rewardId: string): string {
  return rewardId.split('.').slice(1).join(' ').replaceAll('-', ' ');
}

function categoryLabel(category: CosmeticCategory): string {
  return {
    uniform: 'UNIFORME',
    palette: 'ARENA',
    court: 'QUADRA',
    effect: 'EFEITO',
  }[category];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return entities[character];
  });
}

function validIndex(value: number | undefined, length: number, fallback: 0 | 1 | 2): 0 | 1 | 2 {
  return Number.isInteger(value) && value !== undefined && value >= 0 && value < length
    ? (value as 0 | 1 | 2)
    : fallback;
}
