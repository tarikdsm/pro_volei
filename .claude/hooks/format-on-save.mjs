// Hook PostToolUse (Edit|Write): formata com Prettier o arquivo que acabou de ser salvo.
// Recebe o payload do Claude Code via stdin (JSON com tool_input.file_path).
// Silencioso e à prova de falha: um hook nunca deve interromper o fluxo do Claude Code.
import { execSync } from 'node:child_process';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const file = input?.tool_input?.file_path;
    // Prettier respeita o .prettierignore (dist/, *.md, package-lock.json etc.)
    if (file && /\.(ts|tsx|js|mjs|cjs|css|html|json)$/i.test(file)) {
      execSync(`npx prettier --write "${file}"`, { stdio: 'ignore' });
    }
  } catch {
    // ignora qualquer erro de propósito
  }
  process.exit(0);
});
