import { defineConfig } from 'vite';
import packageJson from './package.json';
import { serviceWorkerPlugin } from './build/serviceWorker';

export default defineConfig({
  base: './',
  plugins: [serviceWorkerPlugin(packageJson.version)],
  // localhost por padrão; use `npm run dev:lan` para expor na rede (teste em celular físico)
  server: { port: 5173, host: 'localhost' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
