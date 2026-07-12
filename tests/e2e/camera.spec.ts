import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  forceAutoSelectionScenario,
  readCameraFrame,
} from './gameHarness';

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
] as const;

test('safe frame mantém sujeitos obrigatórios legíveis na matriz desktop/mobile', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.goto('/?debug=1&touch=1');
  await page.getByRole('button', { name: 'JOGAR' }).click();
  await forceAutoSelectionScenario(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const camera = await readCameraFrame(page);
        const safe = camera.solution?.safeRect;
        const actual = camera.actualSubjects;
        if (!safe || !actual?.controlled) return false;
        return [actual.ball, actual.controlled].every(
          (subject) =>
            subject.x >= safe.x - 0.01 &&
            subject.x <= safe.x + safe.width + 0.01 &&
            subject.y >= safe.y - 0.01 &&
            subject.y <= safe.y + safe.height + 0.01,
        );
      })
      .toBe(true);
    const solution = (await readCameraFrame(page)).solution;
    expect(solution).not.toBeNull();
    expect(
      solution!.destinationIncluded,
      `destino degradado em ${viewport.width}x${viewport.height}: ${JSON.stringify(solution)}`,
    ).toBe(true);
    const safe = solution!.safeRect;
    expect(safe.width).toBeGreaterThan(0);
    expect(safe.height).toBeGreaterThan(0);

    const actual = (await readCameraFrame(page)).actualSubjects;
    expect(actual).not.toBeNull();
    for (const subject of [actual!.ball, actual!.controlled]) {
      expect(subject).toBeDefined();
      expect(subject!.x).toBeGreaterThanOrEqual(safe.x - 0.01);
      expect(subject!.x).toBeLessThanOrEqual(safe.x + safe.width + 0.01);
      expect(subject!.y).toBeGreaterThanOrEqual(safe.y - 0.01);
      expect(subject!.y).toBeLessThanOrEqual(safe.y + safe.height + 0.01);
    }
    expect(actual!.destination).toBeDefined();
    expect(actual!.destination!.x).toBeGreaterThanOrEqual(safe.x - 0.01);
    expect(actual!.destination!.x).toBeLessThanOrEqual(safe.x + safe.width + 0.01);
    expect(actual!.destination!.y).toBeGreaterThanOrEqual(safe.y - 0.01);
    expect(actual!.destination!.y).toBeLessThanOrEqual(safe.y + safe.height + 0.01);
  }

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('preferência reduzida chega ao diretor sem FOV decorativo', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'JOGAR' }).click();

  await expect.poll(async () => (await readCameraFrame(page)).motionProfile).toBe('reduced');
  expect((await readCameraFrame(page)).fov).toBe(55);
  await expectNoBrowserProblems(browserProblems, testInfo);
});
