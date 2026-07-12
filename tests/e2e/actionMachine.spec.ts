import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  forceActionServeScenario,
  openGameAndStartMatch,
  readActionSnapshot,
} from './gameHarness';

test('tap, hold e pausa seguem a gramática única sem disparo fantasma', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await openGameAndStartMatch(page, { search: '?debug=1' });

  await forceActionServeScenario(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readActionSnapshot(page)).lastTechnique).toBe('float-serve');

  await forceActionServeScenario(page);
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await readActionSnapshot(page)).lastTechnique).toBe('power-serve');
  expect((await readActionSnapshot(page)).lastCharge).toBeGreaterThan(0.4);

  await forceActionServeScenario(page);
  await page.keyboard.down('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toContainText('PAUSA');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await readActionSnapshot(page)).lastCancellation).toBe('pause');
  expect(await readActionSnapshot(page)).toMatchObject({
    token: null,
    status: 'idle',
    pendingTechnique: null,
  });

  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await page.waitForTimeout(250);
  expect((await readActionSnapshot(page)).pendingTechnique).toBe(null);

  await expectNoBrowserProblems(browserProblems, testInfo);
});
