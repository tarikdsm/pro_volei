import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  openGameAndStartMatch,
  pauseGame,
  readMatchSnapshot,
  readSimulationClock,
  resumeGame,
} from './gameHarness';

test('pausa congela a partida e retomar volta ao jogo', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page);
  await pauseGame(page);

  // com appState='paused', main.ts não chama match.update — o estado deve ficar congelado.
  const before = await readMatchSnapshot(page);
  const clockBefore = await readSimulationClock(page);
  await page.waitForTimeout(1_000);
  const after = await readMatchSnapshot(page);
  const clockAfter = await readSimulationClock(page);
  expect(after).toEqual(before);
  expect(clockAfter.tick).toBe(clockBefore.tick);
  expect(clockAfter.simulationSeconds).toBe(clockBefore.simulationSeconds);
  expect(clockAfter.alpha).toBe(0);

  await resumeGame(page);
  // de volta ao ar: HUD visível e placar ainda presente (não zerou nem quebrou)
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#score-main')).toHaveText(/\d+\s:\s\d+/);
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(clockAfter.tick);

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('Escape com auto-repeat não alterna a pausa', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page);

  // evento sintético com repeat=true simula segurar a tecla: o guard de main.ts deve ignorá-lo.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', repeat: true })),
  );
  await expect(page.locator('#menu')).toBeHidden();

  // Escape real (sem repeat) continua abrindo a pausa — prova que o guard é só do auto-repeat.
  await pauseGame(page);

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('soltar Espaço durante a pausa não quebra o jogo', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openGameAndStartMatch(page);
  await pauseGame(page);

  // pressionar e soltar Espaço pausado não deve gerar erro (regressão do endFrame limpando releases)
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(page.locator('#menu')).toContainText('PAUSA');

  await resumeGame(page);
  await expect(page.locator('#hud')).toBeVisible();

  await expectNoBrowserProblems(browserProblems, testInfo);
});
