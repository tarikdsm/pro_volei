import { expect, test } from '@playwright/test';
import { collectBrowserProblems, expectNoBrowserProblems, openWithTouch } from './gameHarness';

test('joystick e ação aceitam dois dedos reais e pausa não sintetiza teclado', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await openWithTouch(page);

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

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#tc-action')).not.toHaveClass(/pressed/);
  await expect(page.locator('#tc-knob')).toHaveAttribute('style', /translate\(-50%, -50%\)/);

  await page.locator('#tc-pause').tap();
  await expect(page.locator('#menu')).toContainText('PAUSA');

  await testInfo.attach('touch-landscape', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expectNoBrowserProblems(browserProblems, testInfo);
});
