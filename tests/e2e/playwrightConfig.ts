import { defineConfig, devices } from '@playwright/test';

export type TestServerMode = 'dev' | 'preview';

const SERVER_COMMAND: Record<TestServerMode, string> = {
  dev: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
  preview: 'npm run preview -- --host 127.0.0.1 --port 5199 --strictPort',
};

export function makePlaywrightConfig(mode: TestServerMode) {
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
      baseURL: 'http://127.0.0.1:5199',
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
      video: 'off',
      viewport: { width: 1280, height: 800 },
    },
    webServer: {
      command: SERVER_COMMAND[mode],
      url: 'http://127.0.0.1:5199',
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
