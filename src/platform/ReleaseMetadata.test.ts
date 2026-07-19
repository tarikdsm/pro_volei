import { describe, expect, it } from 'vitest';

import { normalizeReleaseMetadata, RELEASE_METADATA } from './ReleaseMetadata';

describe('ReleaseMetadata', () => {
  it('aceita SemVer e SHA hexadecimal e normaliza o SHA', () => {
    const metadata = normalizeReleaseMetadata('2.0.0', 'ABCDEF1234567');

    expect(metadata).toEqual({ version: '2.0.0', sha: 'abcdef1234567' });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it.each([
    ['<img src=x onerror=alert(1)>', 'abcdef1'],
    ['2.0', 'abcdef1'],
    ['2.0.0', 'sha-invalido'],
    ['2.0.0', 'abc123'],
  ])('troca metadados inesperados por fallbacks seguros', (version, sha) => {
    expect(normalizeReleaseMetadata(version, sha)).toEqual({
      version: 'dev',
      sha: 'local',
    });
  });

  it('usa fallbacks quando os defines do Vite não existem no ambiente de testes', () => {
    expect(RELEASE_METADATA).toEqual({ version: 'dev', sha: 'local' });
  });
});
