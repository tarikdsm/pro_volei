import { defineConfig, devices } from '@playwright/test';

export type TestServerMode = 'dev' | 'preview';

export function makePlaywrightConfig(mode: TestServerMode) {
  const configuredPort = Number(process.env.PRO_VOLEI_E2E_PORT);
  const port =
    Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
      ? configuredPort
      : 5199;
  const baseURL = `http://127.0.0.1:${port}`;
  const serverCommand = `npm run ${mode === 'dev' ? 'dev' : 'preview'} -- --host 127.0.0.1 --port ${port} --strictPort`;
  const desktopTestIgnore =
    mode === 'dev' ? [/touch\.spec\.ts/, /offline\.spec\.ts/] : /touch\.spec\.ts/;
  return defineConfig({
    testDir: './tests/e2e',
    // Os E2E validam comportamento, não latência: no runner do CI o WebGL é software
    // (SwiftShader) e a cena premium da 4D estourou os 45 s antigos sem regressão funcional.
    timeout: 120_000,
    expect: {
      timeout: 7_500,
    },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list']],
    outputDir: '.playwright-mcp/test-results',
    use: {
      // porta dedicada 5199 — a 5173 colide com o outro projeto do usuário
      baseURL,
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
      video: 'off',
      viewport: { width: 1280, height: 800 },
    },
    webServer: {
      command: serverCommand,
      url: baseURL,
      timeout: 60_000,
      reuseExistingServer: mode === 'dev' && !process.env.CI,
    },
    projects: [
      {
        // desktop: smoke, pausa, fim de partida e perfil — tudo menos a suíte de toque
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
        testIgnore: desktopTestIgnore,
      },
      {
        // mobile: suíte de toque em landscape e gate de pausa automática em portrait.
        name: 'mobile',
        use: { ...devices['Pixel 5'], viewport: { width: 844, height: 390 } },
        testMatch: /touch\.spec\.ts/,
      },
    ],
  });
}
