// Hook PostToolUse (Edit|Write): formata com Prettier o arquivo que acabou de ser salvo.
// Recebe o payload do Claude Code via stdin (JSON com tool_input.file_path).
// Silencioso e à prova de falha: um hook nunca deve interromper o fluxo do Claude Code.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Decide qual arquivo (se algum) deve ser formatado a partir do payload do hook.
// Retorna o path absoluto validado ou null. Função pura e exportada para teste.
//
// Endurecimento contra command injection: o file_path é entrada NÃO confiável
// (o Claude pode ser induzido, via prompt injection/conteúdo de repo, a escrever
// um arquivo cujo nome contenha metacaracteres de shell). Por isso NUNCA montamos
// uma linha de shell: o path é validado aqui e passado como argumento literal ao
// Prettier (ver execFileSync abaixo).
export function resolveTargetFile(input, repoRoot) {
  const raw = input?.tool_input?.file_path;
  // Ignora entradas ausentes/vazias ou que não sejam string.
  if (typeof raw !== 'string' || raw === '') return null;
  // Ancora no repositório: resolve o path e rejeita traversal (../) e paths
  // absolutos que apontem para fora da raiz. Na prática as edições do Claude
  // ficam dentro do projeto, então isso não deixa de formatar nada real.
  const root = path.resolve(repoRoot);
  const abs = path.resolve(repoRoot, raw);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  // Filtra por extensão (evita rodar Prettier em tudo). Prettier ainda respeita
  // o .prettierignore (dist/, *.md, package-lock.json etc.).
  if (!/\.(ts|tsx|js|mjs|cjs|css|html|json)$/i.test(abs)) return null;
  return abs;
}

// Lê o payload do stdin e formata o arquivo (efeito colateral do hook).
function runHook() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      const repoRoot = process.cwd(); // o hook roda a partir da raiz do repo
      const file = resolveTargetFile(input, repoRoot);
      if (file) {
        // execFileSync com array de args NÃO passa por shell: o path vira um
        // argumento literal, nunca comando (metacaracteres não são interpretados).
        // Invocamos o Prettier local via Node (process.execPath) em vez de `npx`:
        // é cross-platform e evita o bloqueio de spawn de .cmd sem shell no Windows
        // (mitigação do CVE-2024-27980), que quebraria `execFileSync('npx', ...)`.
        const prettierBin = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
        execFileSync(process.execPath, [prettierBin, '--write', file], { stdio: 'ignore' });
      }
    } catch {
      // ignora qualquer erro de propósito
    }
    process.exit(0);
  });
}

// Só registra os listeners de stdin quando o módulo é o ponto de entrada direto
// (node .claude/hooks/format-on-save.mjs). Ao ser importado por um teste, apenas
// a função pura resolveTargetFile é exercitada — sem side effects nem process.exit.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHook();
}
