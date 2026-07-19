import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const CACHE_PREFIX = 'pro-volei-v2-';

export function normalizePrecacheAssets(assets: readonly string[]): string[] {
  const normalized = assets.map(
    (asset) => `./${asset.replace(/^\.?[\\/]+/, '').replaceAll('\\', '/')}`,
  );
  return [...new Set(['./', ...normalized])].sort();
}

export function createServiceWorkerSource(
  version: string,
  digest: string,
  assets: readonly string[],
): string {
  const cacheName = `${CACHE_PREFIX}${version}-${digest}`;
  return `const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(assets)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.match('./index.html'))
        .then((cached) => cached ?? fetch(event.request)),
    );
    return;
  }

  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(event.request, { ignoreSearch: true, ignoreVary: true }))
      .then((cached) => cached ?? fetch(event.request)),
  );
});
`;
}

export function serviceWorkerPlugin(version: string): Plugin {
  return {
    name: 'pro-volei-service-worker',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const dist = resolve('dist');
      const files = await listFiles(dist);
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file);
        hash.update(await readFile(join(dist, ...file.split('/'))));
      }
      const digest = hash.digest('hex').slice(0, 12);
      const precache = normalizePrecacheAssets(files.filter((file) => file !== 'sw.js'));
      await writeFile(join(dist, 'sw.js'), createServiceWorkerSource(version, digest, precache));
    },
  };
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, absolute)));
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join('/'));
  }
  return files.sort();
}
