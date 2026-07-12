import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  activeYamlLines,
  blockEnd,
  directChild,
  extractJobSteps,
  type YamlLine,
} from './support/workflowContract';

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(resolve(here, '../../package.json'), 'utf8'),
) as PackageJson;

const CHECK_STEPS = [
  'uses:actions/checkout@v7',
  'uses:actions/setup-node@v6',
  'run:npm ci',
  'run:npm run check',
  'run:npm run build',
  'run:npx playwright install --with-deps chromium',
  'run:npm run test:e2e:smoke:prod',
  'uses:actions/upload-pages-artifact@v5',
];

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface StepRecord {
  properties: Map<string, string>;
  with: Map<string, string>;
}

function nodeAtPath(lines: YamlLine[], path: string[]): number {
  let current = -1;
  for (const key of path) {
    if (current < 0) {
      current = lines.findIndex(({ indent, text }) => indent === 0 && text === `${key}:`);
    } else {
      current = directChild(lines, current, key);
    }
    if (current < 0) break;
  }
  return current;
}

function directEntries(lines: YamlLine[], parent: number): string[] {
  if (parent < 0) return [];
  const children = lines.slice(parent + 1, blockEnd(lines, parent));
  if (children.length === 0) return [];
  const indent = Math.min(...children.map((line) => line.indent));
  return children.filter((line) => line.indent === indent).map((line) => line.text);
}

function directValue(lines: YamlLine[], parent: number, key: string): string | undefined {
  return directEntries(lines, parent)
    .find((text) => text.startsWith(`${key}:`))
    ?.slice(key.length + 1)
    .trim();
}

function jobStepRecords(workflow: string, jobName: string): StepRecord[] {
  const lines = activeYamlLines(workflow);
  const steps = nodeAtPath(lines, ['jobs', jobName, 'steps']);
  if (steps < 0) return [];

  const body = lines.slice(steps + 1, blockEnd(lines, steps));
  if (body.length === 0) return [];
  const itemIndent = Math.min(...body.map((line) => line.indent));
  const items = body
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.indent === itemIndent && line.text.startsWith('-'));

  return items.map(({ line, index }, itemIndex) => {
    const end = items[itemIndex + 1]?.index ?? body.length;
    const itemLines = [
      { indent: itemIndent + 2, text: line.text.replace(/^-\s*/, '') },
      ...body.slice(index + 1, end),
    ];
    const propertyIndent = Math.min(...itemLines.map((itemLine) => itemLine.indent));
    const properties = new Map<string, string>();

    for (const itemLine of itemLines.filter(({ indent }) => indent === propertyIndent)) {
      const match = itemLine.text.match(/^([^:]+):\s*(.*)$/);
      if (match) properties.set(match[1], match[2]);
    }

    const withLine = itemLines.findIndex(
      ({ indent, text }) => indent === propertyIndent && text === 'with:',
    );
    const withValues = new Map<string, string>();
    if (withLine >= 0) {
      const nested = itemLines.slice(withLine + 1).filter(({ indent }) => indent > propertyIndent);
      const nestedIndent = nested.length
        ? Math.min(...nested.map((itemLine) => itemLine.indent))
        : -1;
      for (const itemLine of nested.filter(({ indent }) => indent === nestedIndent)) {
        const match = itemLine.text.match(/^([^:]+):\s*(.*)$/);
        if (match) withValues.set(match[1], match[2]);
      }
    }

    return { properties, with: withValues };
  });
}

function pagesContractErrors(workflow: string): string[] {
  const errors: string[] = [];
  const lines = activeYamlLines(workflow);

  const on = nodeAtPath(lines, ['on']);
  if (JSON.stringify(directEntries(lines, on)) !== JSON.stringify(['push:'])) {
    errors.push('trigger deve conter somente push');
  }
  const push = nodeAtPath(lines, ['on', 'push']);
  if (JSON.stringify(directEntries(lines, push)) !== JSON.stringify(['branches: [main]'])) {
    errors.push('push deve mirar somente main');
  }

  const topPermissions = nodeAtPath(lines, ['permissions']);
  if (JSON.stringify(directEntries(lines, topPermissions)) !== JSON.stringify(['contents: read'])) {
    errors.push('permissão global deve ser contents read');
  }
  if (nodeAtPath(lines, ['concurrency']) >= 0) errors.push('concorrência global é proibida');

  if (JSON.stringify(extractJobSteps(workflow, 'check')) !== JSON.stringify(CHECK_STEPS)) {
    errors.push('steps do check estão fora do contrato');
  }
  const checkConcurrency = nodeAtPath(lines, ['jobs', 'check', 'concurrency']);
  if (directValue(lines, checkConcurrency, 'group') !== 'ci-${{ github.ref }}') {
    errors.push('grupo de concorrência do check inválido');
  }
  if (directValue(lines, checkConcurrency, 'cancel-in-progress') !== 'true') {
    errors.push('check deve cancelar execução antiga');
  }

  const checkSteps = jobStepRecords(workflow, 'check');
  const upload = checkSteps.filter(
    ({ properties }) => properties.get('uses') === 'actions/upload-pages-artifact@v5',
  );
  if (upload.length !== 1 || upload[0].with.get('path') !== 'dist') {
    errors.push('upload Pages deve enviar dist uma única vez');
  }

  const deploy = nodeAtPath(lines, ['jobs', 'deploy']);
  if (directValue(lines, deploy, 'needs') !== 'check') errors.push('deploy deve depender de check');

  const deployPermissions = nodeAtPath(lines, ['jobs', 'deploy', 'permissions']);
  const expectedPermissions = ['contents: read', 'pages: write', 'id-token: write'];
  if (
    JSON.stringify(directEntries(lines, deployPermissions)) !== JSON.stringify(expectedPermissions)
  ) {
    errors.push('permissões do deploy inválidas');
  }

  const environment = nodeAtPath(lines, ['jobs', 'deploy', 'environment']);
  if (directValue(lines, environment, 'name') !== 'github-pages') {
    errors.push('ambiente do deploy inválido');
  }
  if (directValue(lines, environment, 'url') !== '${{ steps.deployment.outputs.page_url }}') {
    errors.push('URL do ambiente não usa output do deployment');
  }

  const deployConcurrency = nodeAtPath(lines, ['jobs', 'deploy', 'concurrency']);
  if (directValue(lines, deployConcurrency, 'group') !== 'pages') {
    errors.push('grupo de concorrência do deploy inválido');
  }
  if (directValue(lines, deployConcurrency, 'cancel-in-progress') !== 'false') {
    errors.push('deploy iniciado não pode ser cancelado');
  }

  const deploySteps = jobStepRecords(workflow, 'deploy');
  if (
    JSON.stringify(extractJobSteps(workflow, 'deploy')) !==
    JSON.stringify(['uses:actions/configure-pages@v6', 'uses:actions/deploy-pages@v5'])
  ) {
    errors.push('actions do deploy inválidas');
  }
  if (deploySteps.some(({ properties }) => properties.has('run'))) {
    errors.push('deploy privilegiado não pode executar run');
  }
  if (
    deploySteps.some(({ properties }) => properties.get('uses')?.startsWith('actions/checkout@'))
  ) {
    errors.push('deploy privilegiado não pode fazer checkout');
  }
  const deployments = deploySteps.filter(
    ({ properties }) => properties.get('uses') === 'actions/deploy-pages@v5',
  );
  if (deployments.length !== 1 || deployments[0].properties.get('id') !== 'deployment') {
    errors.push('deploy Pages deve ser único e expor id deployment');
  }

  return errors;
}

const VALID_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    concurrency:
      group: ci-\${{ github.ref }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
  deploy:
    needs: check
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    concurrency:
      group: pages
      cancel-in-progress: false
    steps:
      - uses: actions/configure-pages@v6
      - id: deployment
        uses: actions/deploy-pages@v5
`;

describe('deploy contínuo do Pages', () => {
  it('mantém o workflow real no contrato de publicação', () => {
    expect(pagesContractErrors(ci)).toEqual([]);
  });

  it('fixa action-validator 0.6.0 e inclui a validação no gate principal', () => {
    expect(packageJson.devDependencies?.['@action-validator/core']).toBe('0.6.0');
    expect(packageJson.devDependencies?.['@action-validator/cli']).toBe('0.6.0');
    expect(packageJson.scripts?.['workflow:check']).toBe(
      'action-validator .github/workflows/ci.yml',
    );
    expect(packageJson.scripts?.check?.split(' && ')).toContain('npm run workflow:check');
  });

  it('aceita a estrutura mínima recomendada', () => {
    expect(pagesContractErrors(VALID_WORKFLOW)).toEqual([]);
  });

  it.each([
    [
      'upload antes do smoke',
      (workflow: string) =>
        workflow
          .replace(
            '      - uses: actions/upload-pages-artifact@v5\n        with:\n          path: dist\n',
            '',
          )
          .replace(
            '      - run: npm run test:e2e:smoke:prod\n',
            '      - uses: actions/upload-pages-artifact@v5\n        with:\n          path: dist\n      - run: npm run test:e2e:smoke:prod\n',
          ),
    ],
    [
      'artefato diferente de dist',
      (workflow: string) => workflow.replace('path: dist', 'path: public'),
    ],
    ['needs ausente', (workflow: string) => workflow.replace('    needs: check\n', '')],
    ['permissão ausente', (workflow: string) => workflow.replace('      pages: write\n', '')],
    [
      'action presente só em comentário',
      (workflow: string) =>
        workflow.replace(
          '      - id: deployment\n        uses: actions/deploy-pages@v5\n',
          '      # - id: deployment\n      #   uses: actions/deploy-pages@v5\n',
        ),
    ],
    [
      'deploy duplicado',
      (workflow: string) =>
        `${workflow}      - id: deployment-copy\n        uses: actions/deploy-pages@v5\n`,
    ],
  ])('rejeita mutação: %s', (_name, mutate) => {
    expect(pagesContractErrors(mutate(VALID_WORKFLOW))).not.toEqual([]);
  });
});
