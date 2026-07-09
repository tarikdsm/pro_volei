import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Teste-guarda de docs (Node, lógica pura — só lê arquivos com fs). A regra
// "zero assets remotos" do projeto vale para o runtime do jogo, mas por coerência
// (e privacidade de quem abre o repo no GitHub) queremos que a documentação também
// não carregue imagens/badges servidos por terceiros. Sem a correção (B8), o
// README.md tinha dois badges do img.shields.io — estes casos falham nesse cenário,
// o que é justamente o que impede a regressão de colar outro badge remoto amanhã.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// Sintaxe de IMAGEM markdown apontando para URL http(s) remota: ![alt](https://...).
// Casa só imagens (o prefixo '!'), preservando links de texto normais como
// [Jogue agora](https://...), que são legítimos e não baixam nada ao renderizar.
const REMOTE_IMAGE = /!\[[^\]]*\]\(\s*https?:\/\//;
// Host de badge remoto mais comum — checado à parte no README para dar erro claro.
const SHIELDS_HOST = /https?:\/\/img\.shields\.io/;

// Diretórios que não são documentação versionada do projeto: dependências, saídas
// de build e artefatos de ferramentas. O .playwright-mcp/ em especial pode conter
// error-context.md gerado pelo Playwright, que não é versionado.
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.playwright-mcp']);

function collectMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) collectMarkdown(join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

describe('docs sem assets remotos', () => {
  it('README.md não referencia badges/imagens remotas', () => {
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    expect(readme).not.toMatch(REMOTE_IMAGE);
    expect(readme).not.toMatch(SHIELDS_HOST);
  });

  it('nenhum .md versionado carrega imagem por URL remota', () => {
    const files = collectMarkdown(repoRoot);
    // Sanidade: a varredura tem que encontrar os docs principais.
    const relPaths = files.map((f) => relative(repoRoot, f).replace(/\\/g, '/'));
    expect(relPaths).toContain('README.md');

    const offenders = files.filter((file) => REMOTE_IMAGE.test(readFileSync(file, 'utf8')));
    const offenderPaths = offenders.map((f) => relative(repoRoot, f).replace(/\\/g, '/'));
    expect(offenderPaths).toEqual([]);
  });
});
