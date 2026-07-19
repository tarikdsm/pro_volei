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

  await page.getByRole('button', { name: 'VOLTAR' }).click();
  await page.getByRole('button', { name: 'VISUAL', exact: true }).click();
  for (const name of [
    'Uniforme Ondas',
    'Arena Elétrica',
    'Quadra Muralha',
    'Efeito Visão Tática',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-uniform', 'uniform.copa-saque');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'palette.copa-velocidade');
  await expect(page.locator('html')).toHaveAttribute('data-court', 'court.copa-bloqueio');
  await expect(page.locator('html')).toHaveAttribute('data-effect', 'effect.copa-leitura');
  const uniformColors = await page.evaluate(() => {
    const colors: number[] = [];
    const match = (
      window as unknown as {
        __match?: { home: { group: { traverse(callback: (object: unknown) => void): void } } };
      }
    ).__match;
    match?.home.group.traverse((object) => {
      const material = (object as { material?: { color?: { getHex(): number } } }).material;
      if (material?.color) colors.push(material.color.getHex());
    });
    return colors;
  });
  expect(uniformColors).toContain(0x00a8a8);
  expect(uniformColors).toContain(0x092b4c);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-uniform', 'uniform.copa-saque');
  await page.getByRole('button', { name: 'VISUAL', exact: true }).click();
  await expect(page.locator('.cosmetic-option.sel')).toHaveCount(4);
  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('partida rápida não altera a chave da Copa', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'VISUAL', exact: true }).click();
  const lockedCosmetic = page.locator('.cosmetic-option[aria-disabled="true"]').first();
  await lockedCosmetic.focus();
  await expect(lockedCosmetic).toBeFocused();
  await expect(lockedCosmetic).toHaveAttribute('aria-label', /bloqueado/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cosmetic-option.sel')).toHaveCount(4);
  await page.getByRole('button', { name: 'VOLTAR' }).click();
  await page.getByRole('button', { name: 'JOGAR', exact: true }).click();
  await forceMatchEnd(page, 0);
  const cup = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    return saved.cup;
  }, SAVE_KEY);
  expect(cup).toEqual({ currentRound: 0, completed: false, attempts: [0, 0, 0, 0] });
});

test('Copa touch usa resumo compacto e girar cancela a continuidade automática', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?touch=1&debug=1&rematch=9');
  await page.getByRole('button', { name: 'COPA', exact: true }).click();
  await page.getByRole('button', { name: 'CONTINUAR COPA' }).click();
  await expect(page.locator('#portrait-break')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#menu')).toBeHidden();

  await forceMatchEnd(page, 1);
  await expect(page.locator('#compact-cup-result')).toContainText('DERROTA NA COPA');
  await page.getByRole('button', { name: 'REPETIR CONFRONTO' }).click();

  await forceMatchEnd(page, 0);
  await expect(page.locator('#compact-cup-result')).toContainText('VITÓRIA NA COPA');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#compact-cup-result')).toBeHidden();
  await expect(page.locator('.cup-round.current')).toContainText('Raio Veloz');
  await page.waitForTimeout(1_200);
  await expect(page.getByRole('button', { name: 'CONTINUAR COPA' })).toBeVisible();

  await page.getByRole('button', { name: 'CONTINUAR COPA' }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  for (let round = 1; round < 4; round++) {
    await forceMatchEnd(page, 0);
    await expect(page.locator('#compact-cup-result')).toBeVisible();
    if (round < 3) {
      await page.getByRole('button', { name: 'PRÓXIMA PARTIDA' }).click();
    }
  }

  await expect(page.locator('#compact-cup-result')).toContainText('CAMPEÃ DA COPA');
  await expect(page.locator('#cup-count')).toHaveCount(0);
  await page.getByRole('button', { name: 'VER CHAVE' }).click();
  await expect(page.locator('.cup-round.won')).toHaveCount(4);
  await expectNoBrowserProblems(browserProblems, testInfo);
});
