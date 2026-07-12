import { expect, type Page, type TestInfo } from '@playwright/test';

type BrowserProblem = {
  source: 'console' | 'pageerror';
  text: string;
};

// Espelho mínimo do que o e2e lê de window.__match (exposto só em DEV/`?debug`). O jogo roda
// contra `npm run dev` (DEV=true), então a costura debugWinMatch existe. Ver src/game/Match.ts.
type MatchWindow = Window &
  typeof globalThis & {
    __match?: {
      state: string;
      score: [number, number];
      sets: [number, number];
      setNumber: number;
      // 0 = HOME (humano), 1 = AWAY (CPU) — ver TeamSide em src/core/constants.ts
      debugWinMatch(side: number): void;
    };
  };

// Instantâneo do estado observável da partida — base das asserções de congelamento (pausa).
export type MatchSnapshot = {
  state: string;
  score: [number, number];
  sets: [number, number];
  setNumber: number;
};

export function readMatchSnapshot(page: Page): Promise<MatchSnapshot> {
  return page.evaluate(() => {
    const m = (window as MatchWindow).__match;
    if (!m) throw new Error('window.__match ausente (esperado em DEV)');
    return {
      state: m.state,
      score: [...m.score] as [number, number],
      sets: [...m.sets] as [number, number],
      setNumber: m.setNumber,
    };
  });
}

export function collectBrowserProblems(page: Page): BrowserProblem[] {
  const problems: BrowserProblem[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push({ source: 'console', text: message.text() });
    }
  });

  page.on('pageerror', (error) => {
    problems.push({ source: 'pageerror', text: error.message });
  });

  return problems;
}

export async function expectNoBrowserProblems(
  problems: BrowserProblem[],
  testInfo: TestInfo,
): Promise<void> {
  if (problems.length > 0) {
    await testInfo.attach('browser-problems', {
      body: JSON.stringify(problems, null, 2),
      contentType: 'application/json',
    });
  }

  expect(problems).toEqual([]);
}

export async function openGameAndStartMatch(
  page: Page,
  opts: { format?: number } = {},
): Promise<void> {
  await page.goto('/');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'JOGAR' })).toBeVisible();

  // formato opcional: 0 = 1 set de 15 (rápida), 1 = melhor de 3 a 25 (ver MATCH_FORMATS)
  if (opts.format !== undefined) {
    await page.locator(`#opt-fmt button[data-i="${opts.format}"]`).click();
  }

  await page.getByRole('button', { name: 'JOGAR' }).click();

  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#score-main')).toHaveText(/\d+\s:\s\d+/);
}

/**
 * Abre o jogo em modo toque (?touch=1 força os controles no desktop) e inicia a partida.
 * Confirma que o joystick, o botão de ação e a pausa aparecem quando o jogo começa.
 */
export async function openWithTouch(page: Page): Promise<void> {
  await page.goto('/?touch=1');

  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'JOGAR' })).toBeVisible();
  await page.getByRole('button', { name: 'JOGAR' }).click();

  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeVisible();
  await expect(page.locator('#tc-stick')).toBeVisible();
  await expect(page.locator('#tc-action')).toBeVisible();
  await expect(page.locator('#tc-pause')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __match?: unknown }).__match)))
    .toBe(true);
}

/** Pausa via Escape e espera o painel de PAUSA (fluxo Escape → appState → Menu.showPause). */
export async function pauseGame(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu')).toContainText('PAUSA');
}

/** Retoma pelo botão CONTINUAR e espera o menu sumir (jogo de volta ao ar). */
export async function resumeGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await expect(page.locator('#menu')).toBeHidden();
}

/**
 * Força o fim da partida a favor de `side` (0 = HOME/humano, 1 = AWAY/CPU) pela costura DEV
 * debugWinMatch. Não espera aqui pelo painel — o teste faz o poll pelo estado/DOM (o timer de
 * apresentação do fim é processado em match.update, que avança devagar no headless).
 */
export async function forceMatchEnd(page: Page, side: 0 | 1): Promise<void> {
  await page.evaluate((s) => {
    const m = (window as MatchWindow).__match;
    if (!m) throw new Error('window.__match ausente (esperado em DEV)');
    m.debugWinMatch(s);
  }, side);
}

export async function exerciseServeControls(page: Page): Promise<void> {
  await page.keyboard.down('Space');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');

  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
  }

  await page.waitForTimeout(1_000);
}
