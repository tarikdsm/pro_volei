import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  openGameAndStartMatch,
  readSelection,
} from './gameHarness';

test('AutoSelector aparece no rally e respeita lock e máximo de duas trocas', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await openGameAndStartMatch(page, { search: '?debug=1' });

  const observed: Awaited<ReturnType<typeof readSelection>>[] = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    await page.keyboard.press('Space');
    const direction = attempt % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(direction);
    await page.waitForTimeout(180);
    await page.keyboard.up(direction);
    await page.waitForTimeout(220);

    const selection = await readSelection(page);
    expect(selection.switches).toBeLessThanOrEqual(2);
    if (selection.planId !== null) observed.push(selection);
    if (observed.some((item) => item.locked)) break;
  }

  expect(observed.length).toBeGreaterThan(0);
  expect(observed.some((item) => item.selectedId !== null)).toBe(true);
  expect(observed.every((item) => item.switches <= 2)).toBe(true);
  const locked = observed.find((item) => item.locked);
  if (locked) expect(['locked', 'locked-illegal']).toContain(locked.status);

  await expectNoBrowserProblems(browserProblems, testInfo);
});
