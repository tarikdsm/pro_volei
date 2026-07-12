import { defineConfig, devices } from '@playwright/test';

export type TestServerMode = 'dev' | 'preview';

const SERVER_COMMAND: Record<TestServerMode, string> = {
  dev: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
  preview: 'npm run preview -- --host 127.0.0.1 --port 5199 --strictPort',
};

export function makePlaywrightConfig(mode: TestServerMode) {
  return defineConfig({
    testDir: './tests/e2e',
    timeout: 45_000,
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
        testIgnore: /touch\.spec\.ts/,
      },
      {
        // mobile: suíte de toque no uso real em landscape; portrait gate entra na Fase 5A.
        name: 'mobile',
        use: { ...devices['Pixel 5'], viewport: { width: 844, height: 390 } },
        testMatch: /touch\.spec\.ts/,
      },
    ],
  });
}
