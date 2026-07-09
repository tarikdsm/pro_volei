import { defineConfig } from 'vitest/config';

// Testes de lógica pura (física, regras, math) rodam em ambiente Node — rápido.
// Para testes que dependam do DOM/WebGL no futuro, criar um projeto com environment 'jsdom'.
export default defineConfig({
  test: {
    environment: 'node',
    // Lógica pura em src/ + o teste do artefato de baseline em tests/perf/.
    // NÃO inclui tests/e2e/ (harness Playwright roda fora do `npm run check`).
    include: ['src/**/*.{test,spec}.ts', 'tests/perf/**/*.{test,spec}.ts'],
  },
});
