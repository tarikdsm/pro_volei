import { expect, test } from '@playwright/test';
import { collectBrowserProblems, expectNoBrowserProblems } from './gameHarness';

test('cache limpo instala e completa uma partida rápida após reload offline', async ({
  context,
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.goto('/?debug=1&autoplay=1');
  await expect(page.locator('#loading-shell')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.offlineReady))
    .toBe('true');

  const cacheSnapshot = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        return {
          name,
          assets: await Promise.all(
            requests.map(async (request) => ({
              url: request.url,
              bytes: (await (await cache.match(request))!.arrayBuffer()).byteLength,
            })),
          ),
        };
      }),
    );
    return entries;
  });
  await testInfo.attach('cache-snapshot', {
    body: JSON.stringify(cacheSnapshot, null, 2),
    contentType: 'application/json',
  });
  expect(cacheSnapshot).toHaveLength(1);
  expect(cacheSnapshot[0]!.assets).toHaveLength(7);
  expect(cacheSnapshot[0]!.assets.every((asset) => asset.bytes > 0)).toBe(true);

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Rápida — 1 set de 15' }).click();
  await page.getByRole('button', { name: 'JOGAR' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  const completed = await page.evaluate(() => {
    const debugWindow = window as unknown as {
      __simulationClock?: { tick: number };
      __match?: {
        state: string;
        score: readonly number[];
        sets: readonly number[];
        update(dt: number, frame: unknown): void;
      };
    };
    const match = debugWindow.__match;
    if (!match) throw new Error('window.__match ausente no modo debug');
    const maxTick = (debugWindow.__simulationClock?.tick ?? 0) + 300_000;
    let tick = (debugWindow.__simulationClock?.tick ?? 0) + 1;
    for (; tick <= maxTick && match.state !== 'matchEnd'; tick++) {
      match.update(1 / 60, {
        simulationTick: tick,
        sampledAtMs: tick * (1_000 / 60),
        screenAxis: { right: 0, up: 0 },
        courtAxis: { x: 0, z: 0 },
        actionDown: false,
        actionEdges: [],
        cancellations: [],
      });
    }
    return {
      state: match.state,
      score: [...match.score],
      sets: [...match.sets],
      ticks: tick,
      maxTick,
    };
  });
  expect(completed.state).toBe('matchEnd');
  expect(completed.ticks).toBeLessThanOrEqual(completed.maxTick);
  await expect(page.locator('#menu')).toContainText(/VITÓRIA|DERROTA/, { timeout: 20_000 });

  await expectNoBrowserProblems(browserProblems, testInfo);
});
