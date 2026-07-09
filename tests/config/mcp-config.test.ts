import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Teste-guarda de config (Node): o server MCP do Playwright precisa ficar pinado numa
// versão exata em vez de @latest, para reprodutibilidade e menor superfície de supply-chain.
// Sem a correção (args com @playwright/mcp@latest) estes casos falham — é o que impede regressão.
const here = dirname(fileURLToPath(import.meta.url));
const mcpConfigFile = resolve(here, '../../.mcp.json');
const setupDocFile = resolve(here, '../../docs/claude-code-setup.md');

interface McpConfig {
  mcpServers?: {
    playwright?: {
      args?: string[];
    };
  };
}

describe('config do MCP Playwright', () => {
  it('.mcp.json é JSON válido', () => {
    const raw = readFileSync(mcpConfigFile, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('nenhum arg do server usa @latest', () => {
    const config = JSON.parse(readFileSync(mcpConfigFile, 'utf8')) as McpConfig;
    const args = config.mcpServers?.playwright?.args ?? [];
    expect(args.length).toBeGreaterThan(0);
    expect(args.some((a) => a.includes('@latest'))).toBe(false);
  });

  it('@playwright/mcp está pinado em semver exato', () => {
    const config = JSON.parse(readFileSync(mcpConfigFile, 'utf8')) as McpConfig;
    const args = config.mcpServers?.playwright?.args ?? [];
    const pkgArg = args.find((a) => a.startsWith('@playwright/mcp'));
    expect(pkgArg).toBeDefined();
    expect(pkgArg).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/);
  });

  it('a doc de setup não aponta mais para @playwright/mcp@latest', () => {
    const doc = readFileSync(setupDocFile, 'utf8');
    expect(doc.includes('@playwright/mcp@latest')).toBe(false);
  });
});
