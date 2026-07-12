export interface YamlLine {
  indent: number;
  text: string;
}

export function activeYamlLines(workflow: string): YamlLine[] {
  return workflow
    .split(/\r?\n/)
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }))
    .filter(({ text }) => text.length > 0 && !text.startsWith('#'));
}

export function blockEnd(lines: YamlLine[], parent: number): number {
  let end = parent + 1;
  while (end < lines.length && lines[end].indent > lines[parent].indent) end += 1;
  return end;
}

export function directChild(lines: YamlLine[], parent: number, key: string): number {
  if (parent < 0) return -1;

  const end = blockEnd(lines, parent);
  const children = lines.slice(parent + 1, end);
  if (children.length === 0) return -1;

  const childIndent = Math.min(...children.map(({ indent }) => indent));
  const offset = children.findIndex(
    ({ indent, text }) => indent === childIndent && text === `${key}:`,
  );

  return offset < 0 ? -1 : parent + 1 + offset;
}

export function extractJobSteps(workflow: string, jobName: string): string[] {
  const lines = activeYamlLines(workflow);
  const jobs = lines.findIndex(({ text }) => text === 'jobs:');
  const job = directChild(lines, jobs, jobName);
  const steps = directChild(lines, job, 'steps');
  if (steps < 0) return [];

  const end = blockEnd(lines, steps);
  const stepLines = lines.slice(steps + 1, end);
  if (stepLines.length === 0) return [];

  const stepIndent = Math.min(...stepLines.map(({ indent }) => indent));
  const items = stepLines
    .map((line, offset) => ({ line, offset }))
    .filter(({ line }) => line.indent === stepIndent && line.text.startsWith('-'));

  return items.flatMap(({ line, offset }, index) => {
    const direct = line.text.match(/^-\s+(uses|run):\s*(.+)$/);
    if (direct) return [`${direct[1]}:${direct[2]}`];

    const nextOffset = items[index + 1]?.offset ?? stepLines.length;
    const properties = stepLines.slice(offset + 1, nextOffset);
    if (properties.length === 0) return [];

    const propertyIndent = Math.min(...properties.map(({ indent }) => indent));

    return properties
      .filter(({ indent }) => indent === propertyIndent)
      .flatMap(({ text }) => {
        const action = text.match(/^(uses|run):\s*(.+)$/);
        return action ? [`${action[1]}:${action[2]}`] : [];
      });
  });
}
