import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  exerciseServeControls,
  expectNoBrowserProblems,
  openGameAndStartMatch,
  readScreenAxis,
} from './gameHarness';

test('carrega o jogo e inicia uma partida sem erro de browser', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  // A prova de input usa a costura de diagnóstico; no build ela exige opt-in explícito.
  await openGameAndStartMatch(page, { search: '?debug=1' });

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await readScreenAxis(page)).right).toBeGreaterThan(0.9);

  // Regressão CI: um frame >250 ms cancela cargas antigas, mas a seta fisicamente mantida deve
  // continuar ativa quando o render volta (hardware lento não pode perder movimento contínuo).
  await page.evaluate(() => {
    const until = performance.now() + 350;
    while (performance.now() < until) {
      // bloqueio intencional do main thread para forçar wall-cap no próximo rAF
    }
  });
  await expect.poll(async () => (await readScreenAxis(page)).right).toBeGreaterThan(0.9);

  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => Math.hypot(...Object.values(await readScreenAxis(page)))).toBe(0);

  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  expect(await readScreenAxis(page)).toEqual({ right: 0, up: 0 });
  await page.keyboard.up('w');

  await exerciseServeControls(page);

  await expect(page.locator('#scoreboard')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await testInfo.attach('smoke-after-start', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expectNoBrowserProblems(browserProblems, testInfo);
});
