import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';
import pkg from '../package.json' with { type: 'json' };

// Teste-guarda de config (Node): o dev server deve ligar em localhost por padrão e NÃO expor a LAN.
// `defineConfig` chamado com objeto literal devolve o próprio objeto, então `viteConfig.server`
// é acessível aqui. Se um dia vite.config virar função (async) este import direto para de valer —
// reavaliar o teste nesse caso.
describe('config do dev server (vite)', () => {
  it('não expõe o dev server na LAN por padrão', () => {
    // host: true ligaria em 0.0.0.0/:: (todas as interfaces); 'localhost' mantém o bind local.
    expect(viteConfig.server?.host).not.toBe(true);
    expect(viteConfig.server?.host).toBe('localhost');
  });

  it('mantém a porta 5173 (contrato do Playwright)', () => {
    expect(viteConfig.server?.port).toBe(5173);
  });

  it('expõe o script dev:lan para teste mobile na rede', () => {
    expect(pkg.scripts['dev:lan']).toBeDefined();
    expect(pkg.scripts['dev:lan']).toContain('--host');
  });
});
