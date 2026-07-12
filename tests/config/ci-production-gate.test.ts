import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');

const EXPECTED_CHECK_STEPS = [
  'uses:actions/checkout@v5',
  'uses:actions/setup-node@v6',
  'run:npm ci',
  'run:npm run check',
  'run:npm run build',
  'run:npx playwright install --with-deps chromium',
  'run:npm run test:e2e:smoke:prod',
];

interface YamlLine {
  indent: number;
  text: string;
}

function activeYamlLines(workflow: string): YamlLine[] {
  return workflow
    .split(/\r?\n/)
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }))
    .filter(({ text }) => text.length > 0 && !text.startsWith('#'));
}

function blockEnd(lines: YamlLine[], parent: number): number {
  let end = parent + 1;
  while (end < lines.length && lines[end].indent > lines[parent].indent) end += 1;
  return end;
}

function directChild(lines: YamlLine[], parent: number, key: string): number {
  if (parent < 0) return -1;

  const end = blockEnd(lines, parent);
  const children = lines.slice(parent + 1, end);
  const childIndent = Math.min(...children.map(({ indent }) => indent));
  const offset = children.findIndex(
    ({ indent, text }) => indent === childIndent && text === `${key}:`,
  );

  return offset < 0 ? -1 : parent + 1 + offset;
}

function extractCheckSteps(workflow: string): string[] {
  const lines = activeYamlLines(workflow);
  const jobs = lines.findIndex(({ text }) => text === 'jobs:');
  const check = directChild(lines, jobs, 'check');
  const steps = directChild(lines, check, 'steps');
  if (steps < 0) return [];

  const end = blockEnd(lines, steps);
  const stepLines = lines.slice(steps + 1, end);
  const stepIndent = Math.min(...stepLines.map(({ indent }) => indent));
  const items = stepLines
    .map((line, offset) => ({ line, offset }))
    .filter(({ line }) => line.indent === stepIndent && line.text.startsWith('-'));

  return items.flatMap(({ line, offset }, index) => {
    const direct = line.text.match(/^-\s+(uses|run):\s*(.+)$/);
    if (direct) return [`${direct[1]}:${direct[2]}`];

    const nextOffset = items[index + 1]?.offset ?? stepLines.length;
    const properties = stepLines.slice(offset + 1, nextOffset);
    const propertyIndent = Math.min(...properties.map(({ indent }) => indent));

    return properties
      .filter(({ indent }) => indent === propertyIndent)
      .flatMap(({ text }) => {
        const action = text.match(/^(uses|run):\s*(.+)$/);
        return action ? [`${action[1]}:${action[2]}`] : [];
      });
  });
}

describe('CI de produção', () => {
  it('usa exatamente os steps oficiais no job check', () => {
    expect(extractCheckSteps(ci)).toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita comandos presentes apenas em comentários', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
      # - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita comandos presentes em outro job', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
  outro:
    steps:
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita build duplicado', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });
});
