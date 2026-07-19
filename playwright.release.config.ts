import { defineConfig, devices } from '@playwright/test';
import { makePlaywrightConfig } from './tests/e2e/playwrightConfig';

const base = makePlaywrightConfig('preview');

export default defineConfig({
  ...base,
  testMatch: /releaseMatrix\.spec\.ts/,
  projects: [
    { name: 'chromium-release', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-release', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-release', use: { ...devices['Desktop Safari'] } },
    { name: 'android-release', use: { ...devices['Pixel 5'] } },
    { name: 'iphone-release', use: { ...devices['iPhone 12'] } },
  ],
});
