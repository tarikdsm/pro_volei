import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  exerciseServeControls,
  expectNoBrowserProblems,
  openGameAndStartMatch,
} from './gameHarness';

test('carrega o jogo e inicia uma partida sem erro de browser', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page);
  await exerciseServeControls(page);

  await expect(page.locator('#scoreboard')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await testInfo.attach('smoke-after-start', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expectNoBrowserProblems(browserProblems, testInfo);
});
