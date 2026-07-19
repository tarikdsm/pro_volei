import { expect, test, type Page } from '@playwright/test';
import { openGameAndStartMatch } from './gameHarness';

interface JournalEntry {
  rally: number;
  tick: number;
  type: string;
  draws: number[];
  data: Array<string | number | boolean>;
}

interface JournalSnapshot {
  entries: JournalEntry[];
  hash: string | null;
  serialized: string | null;
}

async function runNeutralAutoplay(
  page: Page,
  search: string,
  reducedMotion = false,
): Promise<JournalSnapshot> {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGameAndStartMatch(page, { search });
  await page.keyboard.press('Escape');

  return page.evaluate(() => {
    type DebugWindow = Window & {
      __match?: { update(dt: number, frame: unknown): void };
      __readJournal?: () => JournalSnapshot;
      __simulationClock?: { tick: number };
    };
    const debug = window as DebugWindow;
    if (!debug.__match || !debug.__readJournal) throw new Error('costura de journal ausente');

    const firstTick = (debug.__simulationClock?.tick ?? 0) + 1;
    const lastTick = firstTick + 7_199;
    for (let tick = firstTick; tick <= lastTick; tick++) {
      debug.__match.update(1 / 60, {
        simulationTick: tick,
        sampledAtMs: tick * (1_000 / 60),
        screenAxis: { right: 0, up: 0 },
        courtAxis: { x: 0, z: 0 },
        actionDown: false,
        actionEdges: [],
        cancellations: [],
      });
      if (debug.__readJournal().entries.some((entry) => entry.type === 'rally-end')) break;
    }

    const snapshot = debug.__readJournal();
    if (!snapshot.entries.some((entry) => entry.type === 'rally-end')) {
      throw new Error('rally não terminou dentro do watchdog');
    }
    return structuredClone(snapshot);
  });
}

function normalizedFirstRally(snapshot: JournalSnapshot): JournalEntry[] {
  const end = snapshot.entries.findIndex((entry) => entry.type === 'rally-end');
  const entries = snapshot.entries.slice(0, end + 1);
  const origin = entries[0]?.tick ?? 0;
  return entries.map((entry) => ({ ...entry, tick: entry.tick - origin }));
}

test('seed fixa preserva o journal em desktop, touch e reduced motion', async ({ page }) => {
  test.setTimeout(120_000);
  const desktop = await runNeutralAutoplay(page, '?debug=1&autoplay=1&seed=305441741');
  const desktopEvents = normalizedFirstRally(desktop);

  await page.setViewportSize({ width: 844, height: 390 });
  const touch = await runNeutralAutoplay(page, '?debug=1&autoplay=1&touch=1&seed=305441741');
  await page.setViewportSize({ width: 1280, height: 720 });
  const reduced = await runNeutralAutoplay(page, '?debug=1&autoplay=1&seed=305441741', true);

  expect(normalizedFirstRally(touch)).toEqual(desktopEvents);
  expect(normalizedFirstRally(reduced)).toEqual(desktopEvents);
  expect(desktop.hash).toMatch(/^[0-9a-f]{8}$/);
  expect(desktop.serialized).toContain('pro-volei-rally-journal-v1');
});

test('outra seed diverge nos eventos estocásticos do browser', async ({ page }) => {
  test.setTimeout(60_000);
  const first = await runNeutralAutoplay(page, '?debug=1&autoplay=1&seed=1');
  const other = await runNeutralAutoplay(page, '?debug=1&autoplay=1&seed=2');

  expect(normalizedFirstRally(first)).not.toEqual(normalizedFirstRally(other));
});
