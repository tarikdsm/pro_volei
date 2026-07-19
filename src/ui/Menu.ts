import { DIFFICULTIES, MATCH_FORMATS } from '../core/constants';
import { MatchStats } from '../game/Match';
import type { CosmeticCategory } from '../platform/save/SaveSchema';
import type { Preferences } from '../platform/save/SaveSchema';
import type { AudioSettings } from '../core/audio/AudioSettings';
import { bindMenuFocusNavigation } from './MenuFocusNavigator';

export type PreferencePatch = Partial<Omit<Preferences, 'audio'>> & {
  readonly audio?: Partial<AudioSettings>;
};

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
  onPreferencesChange: ((patch: PreferencePatch) => void) | null = null;
  onResetProgress: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onSelectionChange: ((difficulty: 0 | 1 | 2, format: 0 | 1 | 2) => void) | null = null;
  private countdownId: ReturnType<typeof setInterval> | null = null;
  private cupState: CupMenuState = { completed: false, rounds: [] };
  private cosmetics: readonly CosmeticMenuEntry[] = [];
  private preferences: Readonly<Preferences> | null = null;
  private escapeAction: () => void = () => {};

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
    bindMenuFocusNavigation(this.root, () => this.escapeAction());
    this.showTitle();
  }

  showTitle(): void {
    this.clearCountdown();
    this.escapeAction = () => {};
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
          <button id="btn-options" class="big-btn options-btn">OPÇÕES</button>
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
    this.root.querySelector('#btn-options')!.addEventListener('click', () => this.showOptions());
  }

  setCupState(state: CupMenuState): void {
    this.cupState = state;
  }

  setCosmeticsState(entries: readonly CosmeticMenuEntry[]): void {
    this.cosmetics = entries;
  }

  setPreferencesState(preferences: Readonly<Preferences>): void {
    this.preferences = preferences;
  }

  showCosmetics(
    back: 'title' | 'portrait' = 'title',
    mode: 'quick' | 'cup' = 'quick',
    focusId?: string,
  ): void {
    this.clearCountdown();
    this.escapeAction = () => {
      if (back === 'portrait') {
        this.showPortraitBreak(mode);
        this.restoreFocus('#btn-visual-portrait');
      } else {
        this.showTitle();
        this.restoreFocus('#btn-cosmetics');
      }
    };
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
                          data-unlocked="${entry.unlocked}"
                          aria-label="${escapeHtml(
                            entry.unlocked
                              ? `${entry.name}${entry.selected ? ', selecionado' : ''}`
                              : `${entry.name}, bloqueado: ${entry.requirement}`,
                          )}"
                          aria-disabled="${!entry.unlocked}"
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
    this.root.querySelectorAll<HTMLButtonElement>('.cosmetic-option').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.unlocked !== 'true') return;
        this.onCosmeticSelect?.(
          button.dataset.category as CosmeticCategory,
          button.dataset.id ?? '',
        );
        this.showCosmetics(back, mode, button.dataset.id);
      });
    });
    this.root.querySelector('#btn-cosmetics-back')!.addEventListener('click', () => {
      this.escapeAction();
    });
    if (focusId) this.restoreFocus(`cosmetic:${focusId}`);
  }

  showCup(): void {
    this.clearCountdown();
    this.escapeAction = () => this.showTitle();
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

  showOptions(
    back: 'title' | 'portrait' | 'pause' = 'title',
    mode: 'quick' | 'cup' = 'quick',
    confirmReset = false,
    focusTarget?: string,
  ): void {
    this.clearCountdown();
    const preferences = this.preferences;
    if (!preferences) return;
    const goBack = (): void => {
      if (back === 'portrait') {
        this.showPortraitBreak(mode);
        this.restoreFocus('#btn-options-portrait');
      } else if (back === 'pause') {
        this.showPause();
        this.restoreFocus('#btn-options-pause');
      } else {
        this.showTitle();
        this.restoreFocus('#btn-options');
      }
    };
    this.escapeAction = goBack;
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel options-panel">
        <h1 class="endtitle">OPÇÕES</h1>
        <p class="tagline">preferências aplicadas e salvas imediatamente</p>
        <div class="options-grid">
          ${preferenceChoices('COR', 'colorPreset', preferences.colorPreset, [
            ['default', 'Padrão'],
            ['protan-deutan', 'Protan/Deutan'],
            ['tritan', 'Tritan'],
          ])}
          ${preferenceChoices('CONTRASTE', 'highContrast', String(preferences.highContrast), [
            ['false', 'Padrão'],
            ['true', 'Alto'],
          ])}
          ${preferenceChoices('HUD', 'hudScale', String(preferences.hudScale), [
            ['0.85', '85%'],
            ['1', '100%'],
            ['1.15', '115%'],
          ])}
          ${preferenceChoices('TIMING HUMANO', 'timingAssist', preferences.timingAssist, [
            ['normal', 'Normal'],
            ['wide', 'Amplo'],
          ])}
          <section class="option-section toggles-section">
            <h2>ACESSIBILIDADE</h2>
            ${togglePreference('Movimento reduzido', 'reducedMotion', preferences.reducedMotion)}
            ${togglePreference('Shake e câmera dinâmica', 'shakeEnabled', preferences.shakeEnabled)}
            ${togglePreference('Slow-motion / replay', 'replayEnabled', preferences.replayEnabled)}
            ${togglePreference('Legendas de áudio', 'captionsEnabled', preferences.captionsEnabled)}
            ${togglePreference('Vibração', 'hapticsEnabled', preferences.hapticsEnabled)}
          </section>
          <section class="option-section audio-section">
            <h2>ÁUDIO</h2>
            ${audioSlider('Master', 'master', preferences.audio.master)}
            ${audioSlider('Efeitos', 'effects', preferences.audio.effects)}
            ${audioSlider('Torcida', 'crowd', preferences.audio.crowd)}
            ${audioSlider('Música', 'music', preferences.audio.music)}
          </section>
        </div>
        <div class="reset-progress">
          ${
            confirmReset
              ? `<p role="alert">Apagar Copa, estatísticas e recompensas? Suas opções serão preservadas.</p>
                 <div class="inline-confirm"><button id="btn-reset-confirm" class="danger-btn">CONFIRMAR RESET</button><button id="btn-reset-cancel" class="ghost-btn">CANCELAR</button></div>`
              : '<button id="btn-reset" class="danger-btn">RESETAR PROGRESSO</button>'
          }
        </div>
        <button id="btn-options-back" class="ghost-btn">VOLTAR</button>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.pref as keyof Omit<Preferences, 'audio'>;
        const raw = button.dataset.value ?? '';
        const value: string | number | boolean =
          raw === 'true'
            ? true
            : raw === 'false'
              ? false
              : Number.isNaN(Number(raw))
                ? raw
                : Number(raw);
        this.onPreferencesChange?.({ [key]: value } as PreferencePatch);
        this.showOptions(back, mode, false, `preference:${key}`);
      });
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-audio]').forEach((input) => {
      input.addEventListener('input', () => {
        const channel = input.dataset.audio as keyof AudioSettings;
        const value = Math.max(0, Math.min(1, Number(input.value) / 100));
        input.parentElement
          ?.querySelector('output')
          ?.replaceChildren(`${Math.round(value * 100)}%`);
        this.onPreferencesChange?.({ audio: { [channel]: value } });
      });
    });
    this.root
      .querySelector('#btn-reset')
      ?.addEventListener('click', () => this.showOptions(back, mode, true, '#btn-reset-confirm'));
    this.root.querySelector('#btn-reset-confirm')?.addEventListener('click', () => {
      this.onResetProgress?.();
    });
    this.root
      .querySelector('#btn-reset-cancel')
      ?.addEventListener('click', () => this.showOptions(back, mode, false, '#btn-reset'));
    this.root.querySelector('#btn-options-back')!.addEventListener('click', goBack);
    if (focusTarget) this.restoreFocus(focusTarget);
  }

  /** Pausa de portrait (§7.1): instrução de girar + meta (novo jogo/sair) — só no touch. */
  showPortraitBreak(mode: 'quick' | 'cup' = 'quick'): void {
    this.clearCountdown();
    this.escapeAction = () => {};
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
        <button id="btn-options-portrait" class="ghost-btn">OPÇÕES</button>
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
    this.root
      .querySelector('#btn-options-portrait')!
      .addEventListener('click', () => this.showOptions('portrait', mode));
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

  /** Resultado compacto da Copa em landscape; a chave completa fica no portrait. */
  showCupResultCompact(view: CupResultView, seconds: number, onContinue: () => void): void {
    this.clearCountdown();
    this.root.style.display = 'flex';
    const champion = view.status === 'champion';
    const action = champion
      ? 'VER CHAVE'
      : view.status === 'retry'
        ? 'REPETIR CONFRONTO'
        : 'PRÓXIMA PARTIDA';
    let remaining = Math.max(1, Math.round(seconds));
    this.root.innerHTML = `
      <div class="panel compact-victory compact-cup-result" id="compact-cup-result">
        <h2 class="endtitle ${view.homeWon ? 'win' : 'lose'}">${champion ? '🏆 CAMPEÃ DA COPA!' : view.homeWon ? 'VITÓRIA NA COPA' : 'DERROTA NA COPA'} · Sets ${escapeHtml(view.scoreline)}</h2>
        <p class="tagline">${escapeHtml(view.opponentName)}${champion ? ' · gire ou toque para ver a chave' : ` · ${action} em <span id="cup-count">${remaining}</span> s · gire para a chave`}</p>
        ${view.rewardId ? `<p class="cup-reward">Recompensa: ${escapeHtml(rewardLabel(view.rewardId))}</p>` : ''}
        <button id="btn-cup-compact" class="big-btn">${action}</button>
      </div>`;

    const continueFlow = (): void => {
      this.clearCountdown();
      if (champion) {
        this.showCup();
        return;
      }
      this.hide();
      onContinue();
    };
    this.root.querySelector('#btn-cup-compact')!.addEventListener('click', continueFlow);
    if (champion) return;

    const label = this.root.querySelector('#cup-count')!;
    this.countdownId = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        label.textContent = String(remaining);
        return;
      }
      continueFlow();
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
    this.escapeAction = () => {
      this.hide();
      this.onResume?.();
    };
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="panel">
        <h2>PAUSA</h2>
        <button id="btn-resume" class="big-btn">CONTINUAR</button>
        <button id="btn-options-pause" class="ghost-btn">OPÇÕES</button>
        <button id="btn-quit" class="ghost-btn">SAIR PARA O MENU</button>
      </div>`;
    this.root.querySelector('#btn-resume')!.addEventListener('click', () => {
      this.hide();
      this.onResume?.();
    });
    this.root
      .querySelector('#btn-options-pause')!
      .addEventListener('click', () => this.showOptions('pause'));
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
    if (
      document.activeElement instanceof HTMLElement &&
      this.root.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    this.root.style.display = 'none';
  }

  private restoreFocus(target: string): void {
    queueMicrotask(() => {
      let element: HTMLElement | undefined | null;
      if (target.startsWith('preference:')) {
        const key = target.slice('preference:'.length);
        const controls = Array.from(
          this.root.querySelectorAll<HTMLElement>(`[data-pref="${key}"]`),
        );
        element = controls.find((control) => control.getAttribute('aria-pressed') === 'true');
        element ??= controls[0];
      } else if (target.startsWith('cosmetic:')) {
        const id = target.slice('cosmetic:'.length);
        element = Array.from(this.root.querySelectorAll<HTMLElement>('[data-id]')).find(
          (control) => control.dataset.id === id,
        );
      } else {
        element = this.root.querySelector<HTMLElement>(target);
      }
      element?.focus();
    });
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }
}

function preferenceChoices(
  label: string,
  key: string,
  selected: string,
  values: readonly (readonly [string, string])[],
): string {
  return `<section class="option-section">
    <h2>${escapeHtml(label)}</h2>
    <div class="option-buttons">
      ${values
        .map(
          ([value, name]) =>
            `<button data-pref="${key}" data-value="${value}" class="${value === selected ? 'sel' : ''}" aria-pressed="${value === selected}">${escapeHtml(name)}</button>`,
        )
        .join('')}
    </div>
  </section>`;
}

function togglePreference(label: string, key: string, enabled: boolean): string {
  return `<button class="toggle-option ${enabled ? 'sel' : ''}" data-pref="${key}" data-value="${!enabled}" aria-pressed="${enabled}"><span>${escapeHtml(label)}</span><strong>${enabled ? 'LIGADO' : 'DESLIGADO'}</strong></button>`;
}

function audioSlider(label: string, channel: keyof AudioSettings, value: number): string {
  const percentage = Math.round(value * 100);
  return `<label class="audio-slider"><span>${escapeHtml(label)}</span><input type="range" min="0" max="100" step="1" value="${percentage}" data-audio="${channel}" aria-label="Volume ${escapeHtml(label)}"><output>${percentage}%</output></label>`;
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
