import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // localhost por padrão; use `npm run dev:lan` para expor na rede (teste em celular físico)
  server: { port: 5173, host: 'localhost' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
