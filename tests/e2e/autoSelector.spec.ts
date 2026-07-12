import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  forceAutoSelectionScenario,
  openGameAndStartMatch,
  readSelection,
} from './gameHarness';

test('AutoSelector aparece no rally e respeita lock e máximo de duas trocas', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await openGameAndStartMatch(page, { search: '?debug=1' });
  await forceAutoSelectionScenario(page);

  await expect.poll(async () => (await readSelection(page)).locked).toBe(true);
  const selection = await readSelection(page);
  expect(selection.planId).not.toBeNull();
  expect(selection.selectedId).toBe(1);
  expect(selection.switches).toBeLessThanOrEqual(2);
  expect(['locked', 'locked-illegal']).toContain(selection.status);

  await expectNoBrowserProblems(browserProblems, testInfo);
});
