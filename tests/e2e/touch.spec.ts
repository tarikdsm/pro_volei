import { expect, test } from '@playwright/test';
import { collectBrowserProblems, expectNoBrowserProblems, openWithTouch } from './gameHarness';

// Suíte de toque: roda no projeto mobile (viewport de celular). Usa dispatchEvent para acionar os
// controles diretamente — evita depender de actionability/pointer-events e do canvas por cima, e
// alcança as zonas de ataque mesmo enquanto ocultas (display:none até o momento de mirar).
test('controles de toque aparecem e respondem sem erro de browser', async ({ page }, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await openWithTouch(page);

  // arrasto no joystick: sintetiza teclas de movimento (WASD) e as solta ao final
  const stick = page.locator('#tc-stick');
  const box = await stick.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await stick.dispatchEvent('pointerdown', {
      pointerId: 1,
      clientX: cx,
      clientY: cy,
      bubbles: true,
    });
    await stick.dispatchEvent('pointermove', {
      pointerId: 1,
      clientX: cx + 45,
      clientY: cy,
      bubbles: true,
    });
    await stick.dispatchEvent('pointerup', {
      pointerId: 1,
      clientX: cx + 45,
      clientY: cy,
      bubbles: true,
    });
  }

  // tap numa zona de ataque tocável (sintetiza A/W/D) — bypass do display:none via dispatchEvent
  await page.locator('#zones.tappable span[data-z="1"]').dispatchEvent('pointerdown', {
    bubbles: true,
  });

  // botão de pausa de toque abre o painel de PAUSA (valida a cadeia sintética Escape → pausa)
  await page.locator('#tc-pause').dispatchEvent('pointerdown', { bubbles: true });
  await expect(page.locator('#menu')).toContainText('PAUSA');

  await expectNoBrowserProblems(browserProblems, testInfo);
});
