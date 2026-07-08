import { expect, type Page, type TestInfo } from '@playwright/test';

type BrowserProblem = {
  source: 'console' | 'pageerror';
  text: string;
};

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

export async function openGameAndStartMatch(page: Page): Promise<void> {
  await page.goto('/');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'JOGAR' })).toBeVisible();

  await page.getByRole('button', { name: 'JOGAR' }).click();

  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#score-main')).toHaveText(/\d+\s:\s\d+/);
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __match?: unknown }).__match)))
    .toBe(true);
}

export async function exerciseServeControls(page: Page): Promise<void> {
  await page.keyboard.down('Space');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');

  for (const key of ['KeyA', 'KeyD', 'KeyW']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
  }

  await page.waitForTimeout(1_000);
}
