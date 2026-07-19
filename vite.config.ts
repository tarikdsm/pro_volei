import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import packageJson from './package.json';
import { serviceWorkerPlugin } from './build/serviceWorker';
import { normalizeReleaseMetadata } from './src/platform/ReleaseMetadata';

function resolveBuildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;

  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'local';
  }
}

const releaseMetadata = normalizeReleaseMetadata(packageJson.version, resolveBuildSha());

export default defineConfig({
  base: './',
  plugins: [serviceWorkerPlugin(packageJson.version)],
  define: {
    __APP_VERSION__: JSON.stringify(releaseMetadata.version),
    __BUILD_SHA__: JSON.stringify(releaseMetadata.sha),
  },
  // localhost por padrão; use `npm run dev:lan` para expor na rede (teste em celular físico)
  server: { port: 5173, host: 'localhost' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
