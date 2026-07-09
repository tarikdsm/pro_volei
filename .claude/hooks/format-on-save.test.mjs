import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveTargetFile } from './format-on-save.mjs';

// repoRoot sintético (usa o cwd real, mas as asserções derivam sempre de
// path.resolve para serem estáveis em Windows e Linux — o CI roda em ubuntu).
const repoRoot = process.cwd();

// açúcar: monta o payload do hook a partir de um file_path.
function payload(file_path) {
  return { tool_input: { file_path } };
}

describe('resolveTargetFile', () => {
  it('caso feliz: retorna o path absoluto resolvido (literal, não comando)', () => {
    const out = resolveTargetFile(payload('src/game/Match.ts'), repoRoot);
    expect(out).toBe(path.resolve(repoRoot, 'src/game/Match.ts'));
  });

  describe('injeção neutralizada: metacaracteres viram um único argumento literal', () => {
    // Cada entrada tem metacaracteres de shell mas fica dentro do repo e com
    // extensão válida. O retorno deve ser o path.resolve VERBATIM (metacaracteres
    // preservados), provando que não há split/interpretação de shell.
    const casos = [
      { file: 'src/evil$(calc).ts', metac: '$(calc)' },
      { file: 'src/a;rm -rf ~.ts', metac: ';rm -rf ~' },
      { file: 'src/a" & calc & ".ts', metac: '" & calc & "' },
    ];
    for (const { file, metac } of casos) {
      it(`preserva ${JSON.stringify(file)} sem interpretar shell`, () => {
        const out = resolveTargetFile(payload(file), repoRoot);
        expect(out).toBe(path.resolve(repoRoot, file));
        expect(out).toContain(metac);
      });
    }
  });

  describe('filtro de extensão', () => {
    it('rejeita extensão não suportada (.md)', () => {
      expect(resolveTargetFile(payload('notes.md'), repoRoot)).toBeNull();
    });
    it('rejeita extensão perigosa (.exe)', () => {
      expect(resolveTargetFile(payload('app.exe'), repoRoot)).toBeNull();
    });
    it('rejeita arquivo sem extensão', () => {
      expect(resolveTargetFile(payload('README'), repoRoot)).toBeNull();
    });
    it('aceita extensão em maiúsculas (regex case-insensitive)', () => {
      expect(resolveTargetFile(payload('Match.TS'), repoRoot)).toBe(
        path.resolve(repoRoot, 'Match.TS'),
      );
    });
  });

  describe('traversal / fora do repositório', () => {
    it('rejeita traversal com barra (../)', () => {
      expect(resolveTargetFile(payload('../../etc/passwd.ts'), repoRoot)).toBeNull();
    });
    it('rejeita traversal com separador nativo', () => {
      // path.join usa \ no Windows e / no POSIX — cobre o caso ..\..\evil.ts.
      const nativo = path.join('..', '..', 'evil.ts');
      expect(resolveTargetFile(payload(nativo), repoRoot)).toBeNull();
    });
    it('rejeita path absoluto fora do repo', () => {
      const foraDoRepo = path.join(path.dirname(repoRoot), 'evil.ts');
      expect(resolveTargetFile(payload(foraDoRepo), repoRoot)).toBeNull();
    });
  });

  describe('entrada malformada', () => {
    it('objeto vazio', () => {
      expect(resolveTargetFile({}, repoRoot)).toBeNull();
    });
    it('tool_input vazio', () => {
      expect(resolveTargetFile({ tool_input: {} }, repoRoot)).toBeNull();
    });
    it('file_path vazio', () => {
      expect(resolveTargetFile(payload(''), repoRoot)).toBeNull();
    });
    it('file_path não-string (número)', () => {
      expect(resolveTargetFile(payload(42), repoRoot)).toBeNull();
    });
    it('file_path não-string (objeto)', () => {
      expect(resolveTargetFile(payload({}), repoRoot)).toBeNull();
    });
    it('input undefined', () => {
      expect(resolveTargetFile(undefined, repoRoot)).toBeNull();
    });
  });
});
