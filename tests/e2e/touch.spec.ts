import { expect, test } from '@playwright/test';
import {
  collectBrowserProblems,
  expectNoBrowserProblems,
  forceActionServeScenario,
  forceMatchEnd,
  openWithTouch,
  readActionSnapshot,
  readActionDown,
  readScreenAxis,
  readSimulationClock,
} from './gameHarness';

test('portrait pausa com a área de menu e landscape retoma automaticamente', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  // portrait ANTES do goto: sem autostart — a primeira tela é o título normal
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?touch=1&debug=1');

  await expect(page.locator('#menu')).toBeVisible();
  await page.getByRole('button', { name: 'JOGAR' }).click();

  // §7.1: partida em portrait = pausa com área de menu (girar + novo jogo + sair)
  await expect(page.locator('#portrait-break')).toBeVisible();
  await expect(page.locator('#portrait-break')).toContainText('Gire o celular');
  await expect(page.getByRole('button', { name: 'NOVO JOGO' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SAIR', exact: true })).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeHidden();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  const frozen = await readSimulationClock(page);
  await page.waitForTimeout(350);

  expect((await readSimulationClock(page)).tick).toBe(frozen.tick);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#touch-controls')).toBeVisible();
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(frozen.tick);
  await expect.poll(() => readActionDown(page)).toBe(false);
  await expect.poll(async () => Math.hypot(...Object.values(await readScreenAxis(page)))).toBe(0);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await expect(page.locator('#menu')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toContainText('PAUSA');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#menu')).toContainText('PAUSA'); // pausa explícita vence o gate
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('Space');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#menu')).toContainText('PAUSA');
  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await expect.poll(() => readActionDown(page)).toBe(false);
  await expect.poll(async () => Math.hypot(...Object.values(await readScreenAxis(page)))).toBe(0);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Space');

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('primeira abertura em landscape inicia a partida rápida sozinha', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?touch=1&debug=1');

  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeVisible();
  const before = await readSimulationClock(page);
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(before.tick);

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('fim de partida em landscape conta e relança a revanche sozinha', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?touch=1&debug=1&rematch=1');
  await expect(page.locator('#menu')).toBeHidden(); // autostart

  await forceMatchEnd(page, 0);
  await expect(page.locator('#compact-victory')).toBeVisible();
  await expect(page.locator('#compact-victory')).toContainText('Revanche em');

  // com ?rematch=1 a contagem expira em ~1 s e a partida seguinte entra sozinha
  await expect(page.locator('#compact-victory')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#hud')).toBeVisible();
  const before = await readSimulationClock(page);
  await expect
    .poll(async () => (await readSimulationClock(page)).tick)
    .toBeGreaterThan(before.tick);

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('girar durante a contagem cancela a revanche e abre o painel completo', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?touch=1&debug=1&rematch=9');
  await expect(page.locator('#menu')).toBeHidden();

  await forceMatchEnd(page, 1);
  await expect(page.locator('#compact-victory')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#compact-victory')).toBeHidden();
  await expect(page.locator('#menu')).toContainText('DERROTA');
  await expect(page.getByRole('button', { name: 'JOGAR DE NOVO' })).toBeVisible();

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('joystick e ação aceitam dois dedos reais e pausa não sintetiza teclado', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await openWithTouch(page);
  await forceActionServeScenario(page);

  const stickBox = await page.locator('#tc-stick').boundingBox();
  const actionBox = await page.locator('#tc-action').boundingBox();
  expect(stickBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  if (!stickBox || !actionBox) return;

  const stick = { x: stickBox.x + stickBox.width / 2, y: stickBox.y + stickBox.height / 2 };
  const action = { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height / 2 };
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...stick, id: 1, radiusX: 8, radiusY: 8 },
      { ...action, id: 2, radiusX: 8, radiusY: 8 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: stick.x + 44, y: stick.y - 18, id: 1, radiusX: 8, radiusY: 8 },
      { ...action, id: 2, radiusX: 8, radiusY: 8 },
    ],
  });

  await expect(page.locator('#tc-action')).toHaveClass(/pressed/);
  await expect(page.locator('#tc-knob')).toHaveAttribute('style', /calc/);
  await expect.poll(() => readActionDown(page)).toBe(true);
  await expect
    .poll(async () => Math.hypot(...Object.values(await readScreenAxis(page))))
    .toBeGreaterThan(0.2);

  // Pausar enquanto os dois dedos continuam na tela deve cancelar hub, captures e feedback visual.
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toContainText('PAUSA');
  await expect(page.locator('#tc-action')).not.toHaveClass(/pressed/);
  await expect(page.locator('#tc-knob')).toHaveAttribute('style', /translate\(-50%, -50%\)/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await expect.poll(() => readActionDown(page)).toBe(false);

  // Pointer capture mantém a ação pressionada fora do botão e libera somente no pointerup real.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...action, id: 4, radiusX: 8, radiusY: 8 }],
  });
  await expect(page.locator('#tc-action')).toHaveClass(/pressed/);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: action.x - 240, y: Math.max(20, action.y - 120), id: 4, radiusX: 8, radiusY: 8 },
    ],
  });
  await expect(page.locator('#tc-action')).toHaveClass(/pressed/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#tc-action')).not.toHaveClass(/pressed/);
  await expect.poll(() => readActionDown(page)).toBe(false);
  await expect.poll(async () => (await readActionSnapshot(page)).lastTechnique).toBe('power-serve');

  // Tap imediato pelo touch produz a técnica segura sem depender de timeout do browser.
  await forceActionServeScenario(page);
  await page.locator('#tc-action').tap();
  await expect.poll(async () => (await readActionSnapshot(page)).lastTechnique).toBe('float-serve');

  // Hold com o outro dedo movendo o joystick produz a mesma intenção potente do teclado.
  await forceActionServeScenario(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...stick, id: 6, radiusX: 8, radiusY: 8 },
      { ...action, id: 7, radiusX: 8, radiusY: 8 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: stick.x + 38, y: stick.y, id: 6, radiusX: 8, radiusY: 8 },
      { ...action, id: 7, radiusX: 8, radiusY: 8 },
    ],
  });
  await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await readActionSnapshot(page)).lastTechnique).toBe('power-serve');
  expect((await readActionSnapshot(page)).lastCharge).toBeGreaterThan(0.4);

  await page.locator('#tc-pause').tap();
  await expect(page.locator('#menu')).toContainText('PAUSA');

  await testInfo.attach('touch-landscape', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expectNoBrowserProblems(browserProblems, testInfo);
});
