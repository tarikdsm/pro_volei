import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { collectBrowserProblems, expectNoBrowserProblems } from './gameHarness';

const SAVE_KEY = 'pro-volei.save.v1';
const EXPECTED_BUILD_SHA = (
  process.env.GITHUB_SHA ??
  execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' })
)
  .trim()
  .toLowerCase();

function optionSection(page: import('@playwright/test').Page, heading: string) {
  return page
    .locator('.option-section')
    .filter({ has: page.getByRole('heading', { name: heading }) });
}

test('opções aplicam, persistem e resolvem movimento reduzido imediatamente', async ({
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'OPÇÕES', exact: true }).click();
  const protan = optionSection(page, 'COR').getByRole('button', { name: 'Protan/Deutan' });
  await protan.focus();
  await page.keyboard.press('Enter');
  await expect(protan).toBeFocused();
  await optionSection(page, 'CONTRASTE').getByRole('button', { name: 'Alto' }).click();
  await optionSection(page, 'HUD').getByRole('button', { name: '115%' }).click();
  await optionSection(page, 'TIMING HUMANO').getByRole('button', { name: 'Amplo' }).click();
  await page.getByRole('button', { name: /Movimento reduzido/ }).click();
  await page.getByRole('button', { name: /Legendas de áudio/ }).click();
  await page.getByRole('button', { name: /Vibração/ }).click();
  await page.getByRole('slider', { name: 'Volume Master' }).fill('25');
  await page.getByRole('slider', { name: 'Volume Efeitos' }).fill('40');
  await page.getByRole('slider', { name: 'Volume Torcida' }).fill('55');
  await page.getByRole('slider', { name: 'Volume Música' }).fill('70');

  await expect(page.locator('html')).toHaveAttribute('data-color-preset', 'protan-deutan');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('html')).toHaveAttribute('data-shake', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-replay', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-captions', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-haptics', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-timing-assist', 'wide');
  const cssMotionDurationMs = await page.locator('#scoreboard').evaluate((element) => {
    const raw = getComputedStyle(element).animationDuration.split(',')[0].trim();
    return raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1_000;
  });
  expect(cssMotionDurationMs).toBeLessThanOrEqual(0.001);

  const preferences = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}').preferences,
    SAVE_KEY,
  );
  expect(preferences).toMatchObject({
    hudScale: 1.15,
    colorPreset: 'protan-deutan',
    highContrast: true,
    reducedMotion: true,
    shakeEnabled: true,
    replayEnabled: true,
    captionsEnabled: false,
    hapticsEnabled: false,
    timingAssist: 'wide',
    audio: { master: 0.25, effects: 0.4, crowd: 0.55, music: 0.7 },
  });

  await page.reload();
  expect(
    await page.locator('#hud').evaluate((element) => element.style.getPropertyValue('--hud-scale')),
  ).toBe('1.15');
  await page.getByRole('button', { name: 'OPÇÕES', exact: true }).click();
  await expect(
    optionSection(page, 'COR').getByRole('button', { name: 'Protan/Deutan' }),
  ).toHaveClass(/sel/);
  await expect(page.getByRole('slider', { name: 'Volume Master' })).toHaveValue('25');

  await page.keyboard.press('Home');
  await expect(optionSection(page, 'COR').getByRole('button', { name: 'Padrão' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'VOLTAR' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'OPÇÕES', exact: true })).toBeFocused();

  await expectNoBrowserProblems(browserProblems, testInfo);
});

test('opções identificam a versão 2.0.0 e o commit do build', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'OPÇÕES', exact: true }).click();

  await expect(page.locator('#release-metadata')).toHaveText(`v2.0.0 · ${EXPECTED_BUILD_SHA}`);
});

test('reset confirmado limpa progresso e preserva opções', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key) ?? '{}');
    save.preferences.hudScale = 0.85;
    save.cup = { currentRound: 3, completed: false, attempts: [0, 1, 0, 0] };
    save.stats.matches = 4;
    save.stats.wins = 3;
    save.unlocks.unlocked.push('uniform.copa-saque');
    save.unlocks.selected.uniform = 'uniform.copa-saque';
    localStorage.setItem(key, JSON.stringify(save));
  }, SAVE_KEY);
  await page.reload();
  await page.getByRole('button', { name: 'OPÇÕES', exact: true }).click();
  await page.getByRole('button', { name: 'RESETAR PROGRESSO' }).click();
  await expect(page.getByRole('button', { name: 'CONFIRMAR RESET' })).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('Suas opções serão preservadas');
  await page.getByRole('button', { name: 'CANCELAR' }).click();
  await expect(page.getByRole('button', { name: 'RESETAR PROGRESSO' })).toBeFocused();
  await page.getByRole('button', { name: 'RESETAR PROGRESSO' }).click();
  await page.getByRole('button', { name: 'CONFIRMAR RESET' }).click();
  await expect(page.getByRole('button', { name: 'JOGAR', exact: true })).toBeVisible();

  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    SAVE_KEY,
  );
  expect(saved.preferences.hudScale).toBe(0.85);
  expect(saved.cup).toEqual({ currentRound: 0, completed: false, attempts: [0, 0, 0, 0] });
  expect(saved.stats.matches).toBe(0);
  expect(saved.unlocks).toMatchObject({
    unlocked: ['uniform.base', 'palette.base', 'court.base', 'effect.base'],
    selected: {
      uniform: 'uniform.base',
      palette: 'palette.base',
      court: 'court.base',
      effect: 'effect.base',
    },
  });
});

test('painel funciona por touch em portrait', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?touch=1');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'NOVO JOGO' })).toBeVisible();
  await page.getByRole('button', { name: 'OPÇÕES', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OPÇÕES' })).toBeVisible();
  await page.getByRole('button', { name: /Movimento reduzido/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByRole('button', { name: 'VOLTAR' }).click();
  await expect(page.getByRole('button', { name: 'NOVO JOGO' })).toBeVisible();
});
