import { afterEach, describe, expect, it } from 'vitest';
import { makePlaywrightConfig } from '../e2e/playwrightConfig';

const originalPort = process.env.PRO_VOLEI_E2E_PORT;

afterEach(() => {
  if (originalPort === undefined) delete process.env.PRO_VOLEI_E2E_PORT;
  else process.env.PRO_VOLEI_E2E_PORT = originalPort;
});

describe('playwrightConfig', () => {
  it('aceita override local de porta e alinha servidor e baseURL', () => {
    process.env.PRO_VOLEI_E2E_PORT = '5201';
    const config = makePlaywrightConfig('preview');
    const webServer = config.webServer as { command: string; url: string };

    expect(config.use?.baseURL).toBe('http://127.0.0.1:5201');
    expect(webServer.url).toBe('http://127.0.0.1:5201');
    expect(webServer.command).toContain('--port 5201 --strictPort');
  });

  it('rejeita valores injetáveis e fora da faixa', () => {
    process.env.PRO_VOLEI_E2E_PORT = '5201 --host 0.0.0.0';
    const config = makePlaywrightConfig('dev');
    const webServer = config.webServer as { command: string; url: string };

    expect(config.use?.baseURL).toBe('http://127.0.0.1:5199');
    expect(webServer.command).toContain('--port 5199 --strictPort');
  });
});
