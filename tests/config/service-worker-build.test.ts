import { describe, expect, it } from 'vitest';
import { createServiceWorkerSource, normalizePrecacheAssets } from '../../build/serviceWorker';

describe('service worker de release', () => {
  it('normaliza caminhos, inclui o shell e ordena a lista de precache', () => {
    expect(normalizePrecacheAssets(['assets/z.js', 'index.html', 'assets/a.css'])).toEqual([
      './',
      './assets/a.css',
      './assets/z.js',
      './index.html',
    ]);
  });

  it('gera cache imutável e atualização por mensagem sem misturar versões', () => {
    const source = createServiceWorkerSource('2.0.0', 'abc123def456', [
      './',
      './assets/app.js',
      './index.html',
    ]);

    expect(source).toContain('pro-volei-v2-2.0.0-abc123def456');
    expect(source).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(source).toContain('cache.addAll(PRECACHE)');
    expect(source).toContain('url.origin !== self.location.origin');
    expect(source).toContain('ignoreVary: true');
    expect(source).toContain('caches.open(CACHE_NAME)');
    expect(source).not.toContain('caches.match(');
    expect(source).toContain('caches.delete(key)');
    expect(source).not.toMatch(/https?:\/\//);
  });
});
