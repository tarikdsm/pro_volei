import { expect, test } from '@playwright/test';
import { collectBrowserProblems, expectNoBrowserProblems } from './gameHarness';

async function runCurrentCpuMatch(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
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
    const firstTick = (debugWindow.__simulationClock?.tick ?? 0) + 1;
    const maxTick = firstTick + 300_000;
    let tick = firstTick;
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
}

test('cache limpo instala e completa uma partida rápida após reload offline', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
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
  const completed = await runCurrentCpuMatch(page);
  expect(completed.state).toBe('matchEnd');
  expect(completed.ticks).toBeLessThanOrEqual(completed.maxTick);
  await expect(page.locator('#menu')).toContainText(/VITÓRIA|DERROTA/, { timeout: 20_000 });

  // Instalação já está offline: completa agora a Copa inteira com simulação CPU×CPU real.
  await page.reload();
  await page.getByRole('button', { name: 'COPA', exact: true }).click();
  await page.getByRole('button', { name: 'CONTINUAR COPA' }).click();
  let cupSnapshot: { currentRound: number; completed: boolean; attempts: number[] } | null = null;
  for (let matchCount = 0; matchCount < 20; matchCount++) {
    const cupMatch = await runCurrentCpuMatch(page);
    expect(cupMatch.state).toBe('matchEnd');
    await expect(page.locator('#menu')).toContainText(/VITÓRIA NA COPA|DERROTA NA COPA|CAMPEÃ/, {
      timeout: 20_000,
    });
    cupSnapshot = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('pro-volei.save.v1') ?? '{}');
      return saved.cup;
    });
    if (cupSnapshot?.completed) break;
    const next = page.getByRole('button', { name: /PRÓXIMA PARTIDA|REPETIR CONFRONTO/ });
    await next.click();
  }
  expect(cupSnapshot).toMatchObject({ currentRound: 4, completed: true });
  const unlocks = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pro-volei.save.v1') ?? '{}');
    return saved.unlocks.unlocked;
  });
  expect(unlocks).toEqual(
    expect.arrayContaining([
      'uniform.copa-saque',
      'palette.copa-velocidade',
      'court.copa-bloqueio',
      'effect.copa-leitura',
    ]),
  );

  await expectNoBrowserProblems(browserProblems, testInfo);
});
