import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  forceMatchEnd,
  openGameAndStartMatch,
} from './gameHarness';

// O painel de fim de partida surge por um timer processado em match.update, que avança devagar no
// headless (~9 FPS, dt limitado a 0.05). Por isso esperamos por ESTADO/DOM com folga, nunca por
// tempo fixo. side: 0 = HOME (humano), 1 = AWAY (CPU) — ver TeamSide/MATCH_FORMATS em constants.
const PANEL_TIMEOUT = 20_000;

test('vitória do humano (1 set) mostra o painel de VITÓRIA e oculta o HUD', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page); // formato padrão 0 = 1 set de 15
  await forceMatchEnd(page, 0);

  await expect(page.locator('.endtitle.win')).toBeVisible({ timeout: PANEL_TIMEOUT });
  await expect(page.locator('#menu')).toContainText('VITÓRIA');
  await expect(page.getByRole('button', { name: 'JOGAR DE NOVO' })).toBeVisible();
  await expect(page.locator('#hud')).toBeHidden();

  // 5A: revanche in-place — sem recarregar a página, o jogo volta com HUD e menu escondido
  await page.getByRole('button', { name: 'JOGAR DE NOVO' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('derrota do humano (1 set) mostra o painel de DERROTA', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page);
  await forceMatchEnd(page, 1); // AWAY vence

  await expect(page.locator('.endtitle.lose')).toBeVisible({ timeout: PANEL_TIMEOUT });
  await expect(page.locator('#menu')).toContainText('DERROTA');
  await expect(page.getByRole('button', { name: 'JOGAR DE NOVO' })).toBeVisible();
  await expect(page.locator('#hud')).toBeHidden();

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('melhor de 3: vitória do humano fecha a partida em 2 sets', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  // Desde a 3D o formato 0 é o Oficial 2.0 (melhor de 3 a 11·11·7); o índice 1 virou a Rápida.
  await openGameAndStartMatch(page, { format: 0 });
  await forceMatchEnd(page, 0);

  await expect(page.locator('.endtitle.win')).toBeVisible({ timeout: PANEL_TIMEOUT });
  // dois sets a zero — prova que o laço de debugWinMatch encerrou os sets necessários do formato
  await expect(page.locator('#menu')).toContainText('2 × 0');
  await expect(page.getByRole('button', { name: 'JOGAR DE NOVO' })).toBeVisible();
  await expect(page.locator('#hud')).toBeHidden();

  await expectNoBrowserProblems(browserProblems, testInfo);
});
