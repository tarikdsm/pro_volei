import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  readSimulationClock,
} from './gameHarness';

test('artefato inicia uma partida sem erro nas engines de release', async ({ page }, testInfo) => {
  const mobileProfile = ['android-release', 'iphone-release'].includes(testInfo.project.name);
  const browserProblems = collectBrowserProblems(page);
  const deprecatedShadowWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('PCFSoftShadowMap')) {
      deprecatedShadowWarnings.push(message.text());
    }
  });

  await page.goto(`/?debug=1&tier=${mobileProfile ? 1 : 2}`);
  const audioApi = await page.evaluate(() => ({
    audioContext: typeof globalThis.AudioContext,
    webkitAudioContext: typeof (globalThis as typeof globalThis & { webkitAudioContext?: unknown })
      .webkitAudioContext,
  }));
  console.info(`RELEASE_AUDIO_API ${testInfo.project.name} ${JSON.stringify(audioApi)}`);
  console.info(
    `RELEASE_TOUCH_MODE ${testInfo.project.name} ${await page.evaluate(() => document.body.classList.contains('touch'))}`,
  );
  const touchMode = await page.evaluate(
    () => 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  );
  const viewport = page.viewportSize();
  const portrait = viewport !== null && viewport.height > viewport.width;

  if (touchMode && !portrait) {
    await expect(page.locator('#menu')).toBeHidden();
  } else {
    await page.getByRole('button', { name: 'JOGAR', exact: true }).click();
    if (touchMode && portrait && viewport) {
      await expect(page.locator('#portrait-break')).toBeVisible();
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
    }
  }

  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  const before = await readSimulationClock(page);
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(before.tick);
  const rendering = await page.evaluate(async () => {
    const samples: Array<{ calls: number; triangles: number }> = [];
    await new Promise<void>((resolve) => {
      const sample = (): void => {
        const render = (
          window as typeof window & {
            __renderer?: { info?: { render?: { calls?: number; triangles?: number } } };
          }
        ).__renderer?.info?.render;
        if (render) samples.push({ calls: render.calls ?? 0, triangles: render.triangles ?? 0 });
        if (samples.length >= 12) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return {
      maxCalls: Math.max(...samples.map((sample) => sample.calls)),
      maxTriangles: Math.max(...samples.map((sample) => sample.triangles)),
    };
  });
  console.info(`RELEASE_RENDERING ${testInfo.project.name} ${JSON.stringify(rendering)}`);
  const athleteShadowCasters = await page.evaluate(() => {
    let count = 0;
    const match = (
      window as typeof window & {
        __match?: {
          home: { group: { traverse(callback: (object: unknown) => void): void } };
          away: { group: { traverse(callback: (object: unknown) => void): void } };
        };
      }
    ).__match;
    for (const group of [match?.home.group, match?.away.group]) {
      group?.traverse((object) => {
        const mesh = object as { isMesh?: boolean; castShadow?: boolean };
        if (mesh.isMesh && mesh.castShadow) count += 1;
      });
    }
    return count;
  });
  console.info(`RELEASE_SHADOW_CASTERS ${testInfo.project.name} ${athleteShadowCasters}`);

  expect(touchMode).toBe(mobileProfile);
  expect(athleteShadowCasters).toBe(mobileProfile ? 0 : 60);
  expect(rendering.maxCalls).toBeLessThanOrEqual(touchMode ? 180 : 250);
  expect(rendering.maxTriangles).toBeLessThanOrEqual(touchMode ? 250_000 : 500_000);
  expect(deprecatedShadowWarnings).toEqual([]);
  await expectNoBrowserProblems(browserProblems, testInfo);
});
