import { describe, it, expect } from 'vitest';
import { exporDebugHabilitado } from './debug';

describe('exporDebugHabilitado', () => {
  it('expõe em dev', () => {
    expect(exporDebugHabilitado({ dev: true, search: '' })).toBe(true);
  });

  it('oculta em produção sem flag', () => {
    expect(exporDebugHabilitado({ dev: false, search: '' })).toBe(false);
  });

  it('expõe em produção com ?debug', () => {
    expect(exporDebugHabilitado({ dev: false, search: '?debug' })).toBe(true);
  });

  it('aceita ?debug=1', () => {
    expect(exporDebugHabilitado({ dev: false, search: '?debug=1' })).toBe(true);
  });

  it('ignora outras queries', () => {
    expect(exporDebugHabilitado({ dev: false, search: '?touch=1' })).toBe(false);
  });
});
