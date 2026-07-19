import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Teste-guarda de apresentação (Node, lógica pura — só lê arquivos com fs). Fica em
// tests/config/ como os outros guardas de arquivo do projeto (mcp-config, deploy-gate),
// pois o tsconfig só cobre `src` e não tem @types/node; além disso o Vitest zera o
// conteúdo de imports `.css?raw`, então a leitura estática com fs é o caminho confiável.
//
// Guarda a correção B4: sob viewport-fit=cover (index.html) os controles de toque em
// src/style.css desenhavam sob o notch/home indicator porque usavam offsets fixos em px,
// e o #hint usava calc(100vw - 400px) sem piso (colapsava em telas muito estreitas). A
// oclusão visual real sob safe area exige device/emulador — fica no fluxo Playwright/playtest.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const css = readFileSync(resolve(repoRoot, 'src/style.css'), 'utf8');
const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
const touchControls = readFileSync(resolve(repoRoot, 'src/ui/TouchControls.ts'), 'utf8');

// Extrai o corpo de uma regra CSS de seletor simples (sem regras aninhadas com { }).
function bloco(seletor: string): string {
  const re = new RegExp(`${seletor.replace(/[.#]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`bloco não encontrado para o seletor ${seletor}`);
  return m[1];
}

describe('safe areas nos controles de toque (B4)', () => {
  it('alimenta o solver das zonas laterais com as quatro safe areas', () => {
    expect(touchControls).toContain("read('--safe-area-top')");
    expect(touchControls).toContain("read('--safe-area-right')");
    expect(touchControls).toContain("read('--safe-area-bottom')");
    expect(touchControls).toContain("read('--safe-area-left')");
    expect(touchControls).toContain('solveTouchLayout(viewport, insets)');
  });

  it('substitui o calc(100vw - 400px) frágil por um max() com piso e insets', () => {
    // A string literal frágil (sem piso) não pode mais existir.
    expect(css).not.toContain('calc(100vw - 400px)');
    // O max-width do #hint deve ter piso via max() e descontar as insets laterais.
    const hint = bloco('body.touch #hint');
    expect(hint).toMatch(/max-width:\s*max\(/);
    expect(hint).toContain('env(safe-area-inset-left');
    expect(hint).toContain('env(safe-area-inset-right');
  });

  it('todo uso de env(safe-area-inset-*) tem fallback , 0px', () => {
    // Sem o fallback, browsers sem suporte à função resolvem a inset como indefinida.
    const usos = css.match(/env\(safe-area-inset-[^)]*\)/g) ?? [];
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) {
      expect(uso).toMatch(/,\s*0px\s*\)$/);
    }
  });

  it('o meta viewport declara viewport-fit=cover (pré-condição das insets)', () => {
    // Sem viewport-fit=cover as insets valem 0 e as correções viram no-op.
    const meta = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)?.[0] ?? '';
    expect(meta).toContain('viewport-fit=cover');
  });
});

describe('preferência de movimento reduzido', () => {
  it('desativa animações e transições decorativas sem esconder conteúdo', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.001ms !important');
    expect(css).toContain('transition-duration: 0.001ms !important');
  });
});
