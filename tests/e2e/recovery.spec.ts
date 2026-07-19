import { expect, test, type Page } from '@playwright/test';
import { openGameAndStartMatch, readSimulationClock } from './gameHarness';

type RecoveryWindow = Window &
  typeof globalThis & {
    __recoveryGlExtension?: WEBGL_lose_context;
    __renderer?: { info: { render: { frame: number } } };
  };

async function loseWebGlContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas ausente');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context indisponível');
    (window as RecoveryWindow).__recoveryGlExtension = extension;
    extension.loseContext();
  });
}

async function restoreWebGlContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const extension = (window as RecoveryWindow).__recoveryGlExtension;
    if (!extension) throw new Error('extensão de recovery ausente');
    extension.restoreContext();
  });
}

async function readRenderFrame(page: Page): Promise<number> {
  return page.evaluate(() => (window as RecoveryWindow).__renderer?.info.render.frame ?? -1);
}

test('pausa na perda WebGL real, restaura uma vez e torna a reincidência fatal', async ({
  page,
}) => {
  await openGameAndStartMatch(page, { search: '?debug=1' });
  const overlay = page.locator('#app-recovery');

  await loseWebGlContext(page);
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'alert');
  await expect(overlay).toContainText(/restaur/i);

  const frozen = await readSimulationClock(page);
  const frozenRenderFrame = await readRenderFrame(page);
  await page.waitForTimeout(250);
  expect((await readSimulationClock(page)).tick).toBe(frozen.tick);

  await restoreWebGlContext(page);
  await expect(overlay).toBeHidden();
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(frozen.tick);
  await expect.poll(() => readRenderFrame(page)).toBeGreaterThan(frozenRenderFrame);

  await loseWebGlContext(page);
  await expect(overlay).toBeVisible();
  await expect(page.getByRole('button', { name: 'REINICIAR COM SEGURANÇA' })).toBeVisible();
});

test('erro global reinicia sem alterar o save', async ({ page }) => {
  await openGameAndStartMatch(page, { search: '?debug=1' });
  const saveBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }));

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'falha global sintética' }));
  });

  const overlay = page.locator('#app-recovery');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'alert');
  await expect(overlay).toContainText('falha global sintética');
  const reloaded = page.waitForNavigation();
  await page.getByRole('button', { name: 'REINICIAR COM SEGURANÇA' }).click();
  await reloaded;
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(saveBefore);
});

test('erro fatal durante perda WebGL não é ocultado pela restauração tardia', async ({ page }) => {
  await openGameAndStartMatch(page, { search: '?debug=1' });
  await loseWebGlContext(page);
  const frozen = await readSimulationClock(page);

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'fatal durante perda' }));
  });
  await expect(page.getByRole('button', { name: 'REINICIAR COM SEGURANÇA' })).toBeVisible();

  await restoreWebGlContext(page);
  const overlay = page.locator('#app-recovery');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('fatal durante perda');
  await page.waitForTimeout(250);
  expect((await readSimulationClock(page)).tick).toBe(frozen.tick);
});

test('WebGL indisponível mostra fallback claro e reinício seguro', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => null,
    });
  });

  await page.goto('/');

  const overlay = page.locator('#app-recovery');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(/WebGL|gráfic/i);
  await expect(page.getByRole('button', { name: 'REINICIAR COM SEGURANÇA' })).toBeVisible();
});

test('erro precoce de bootstrap também chega ao fallback global', async ({ page }) => {
  await page.addInitScript(() => {
    window.matchMedia = () => {
      throw new Error('falha precoce de bootstrap');
    };
  });

  await page.goto('/');

  const overlay = page.locator('#app-recovery');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('falha precoce de bootstrap');
  await expect(page.getByRole('button', { name: 'REINICIAR COM SEGURANÇA' })).toBeVisible();
});
