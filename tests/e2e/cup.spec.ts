import { expect, test } from '@playwright/test';
import { collectBrowserProblems, expectNoBrowserProblems, forceMatchEnd } from './gameHarness';

const SAVE_KEY = 'pro-volei.save.v1';
const PANEL_TIMEOUT = 20_000;

test('Copa persiste avanço, retry e estado terminal após quatro vitórias', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'COPA', exact: true }).click();
  await expect(page.locator('.cup-round.current')).toContainText('Ondas do Saque');
  await page.getByRole('button', { name: 'CONTINUAR COPA' }).click();
  await forceMatchEnd(page, 0);
  await expect(page.getByText('VITÓRIA NA COPA')).toBeVisible({ timeout: PANEL_TIMEOUT });

  await page.reload();
  await page.getByRole('button', { name: 'COPA', exact: true }).click();
  await expect(page.locator('.cup-round.current')).toContainText('Raio Veloz');
  await page.getByRole('button', { name: 'CONTINUAR COPA' }).click();
  await forceMatchEnd(page, 1);
  await expect(page.getByText('DERROTA NA COPA')).toBeVisible({ timeout: PANEL_TIMEOUT });
  await page.getByRole('button', { name: 'REPETIR CONFRONTO' }).click();

  for (let round = 1; round < 4; round++) {
    await forceMatchEnd(page, 0);
    if (round < 3) {
      await expect(page.getByText('VITÓRIA NA COPA')).toBeVisible({ timeout: PANEL_TIMEOUT });
      await page.getByRole('button', { name: 'PRÓXIMA PARTIDA' }).click();
    }
  }

  await expect(page.getByText('CAMPEÃ DA COPA!')).toBeVisible({ timeout: PANEL_TIMEOUT });
  await page.getByRole('button', { name: 'VER CHAVE' }).click();
  await expect(page.locator('.cup-round.won')).toHaveCount(4);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    SAVE_KEY,
  );
  expect(saved).toMatchObject({
    cup: { currentRound: 4, completed: true, attempts: [0, 1, 0, 0] },
    stats: { matches: 5, wins: 4, losses: 1 },
  });

  await page.reload();
  await page.getByRole('button', { name: 'COPA', exact: true }).click();
  await expect(page.getByText('CAMPEÃ DA COPA')).toBeVisible();
  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('partida rápida não altera a chave da Copa', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'JOGAR', exact: true }).click();
  await forceMatchEnd(page, 0);
  const cup = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    return saved.cup;
  }, SAVE_KEY);
  expect(cup).toEqual({ currentRound: 0, completed: false, attempts: [0, 0, 0, 0] });
});
