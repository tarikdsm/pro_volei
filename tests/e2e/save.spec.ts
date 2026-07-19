import { expect, test } from '@playwright/test';

const SAVE_KEY = 'pro-volei.save.v1';

test('preferências de partida persistem no save canônico após reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Difícil' }).click();
  await page.getByRole('button', { name: /Clássica/ }).click();
  await page.reload();

  await expect(page.getByRole('button', { name: 'Difícil' })).toHaveClass(/sel/);
  await expect(page.getByRole('button', { name: /Clássica/ })).toHaveClass(/sel/);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    SAVE_KEY,
  );
  expect(saved).toMatchObject({ version: 1, preferences: { difficulty: 2, format: 2 } });
});

test('migra o mixer legado quando o save canônico ainda não existe', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pro-volei.audio.v1',
      JSON.stringify({ master: 0.1, effects: 0.2, crowd: 0.3, music: 0.4 }),
    );
  });
  await page.goto('/');

  const audio = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as {
      preferences?: { audio?: unknown };
    };
    return saved.preferences?.audio;
  }, SAVE_KEY);
  expect(audio).toEqual({ master: 0.1, effects: 0.2, crowd: 0.3, music: 0.4 });
});

test('save corrompido ou storage bloqueado não impede o bootstrap', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{'), SAVE_KEY);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'JOGAR' })).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage bloqueado');
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'JOGAR' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});
