import { defineConfig } from 'vitest/config';

// Testes de lógica pura (física, regras, math) rodam em ambiente Node — rápido.
// Para testes que dependam do DOM/WebGL no futuro, criar um projeto com environment 'jsdom'.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
