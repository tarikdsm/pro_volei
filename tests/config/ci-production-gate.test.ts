import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractJobSteps } from './support/workflowContract';

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, '../../.github/workflows/ci.yml'), 'utf8');

const EXPECTED_CHECK_STEPS = [
  'uses:actions/checkout@v7',
  'uses:actions/setup-node@v6',
  'run:npm ci',
  'run:npm run check',
  'run:npm run build',
  'run:npx playwright install --with-deps chromium',
  'run:npm run test:e2e:smoke:prod',
  'uses:actions/upload-pages-artifact@v5',
];

function extractCheckSteps(workflow: string): string[] {
  return extractJobSteps(workflow, 'check');
}

describe('CI de produção', () => {
  it('usa exatamente os steps oficiais no job check', () => {
    expect(extractCheckSteps(ci)).toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita comandos presentes apenas em comentários', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
      # - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
      - uses: actions/upload-pages-artifact@v5
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita comandos presentes em outro job', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
  outro:
    steps:
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
      - uses: actions/upload-pages-artifact@v5
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });

  it('não aceita build duplicado', () => {
    const workflow = `jobs:
  check:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e:smoke:prod
      - uses: actions/upload-pages-artifact@v5
`;

    expect(extractCheckSteps(workflow)).not.toEqual(EXPECTED_CHECK_STEPS);
  });
});
