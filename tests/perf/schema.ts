// Contrato mínimo do baseline de performance (docs/perf/baseline-*.json).
// Puro (sem Playwright/Three) para ser reutilizado pelo harness de medição e pelo teste Vitest.
// Serve só para validar o formato do artefato — NÃO impõe orçamento de FPS/hardware.

export type PerfBaseline = {
  collectedAt: string;
  environment: {
    project: string;
    headless: boolean;
    viewport: { width: number; height: number } | null;
    note: string;
  };
  frameTime: {
    averageFps: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    frameCount: number;
    durationMs: number;
  };
  rendering: {
    drawCallsPerFrameAvg: number;
    drawCallsPerFrameMax: number;
    rendererInfoCallsAvg: number;
    rendererInfoTrianglesAvg: number;
    sampleCount: number;
  };
  heap: {
    browserUsedBytes: number | null;
    browserDeltaBytes: number | null;
    cdpUsedBytes: number;
    cdpTotalBytes: number | null;
  };
};

// Campos numéricos obrigatórios (caminho pontilhado). Cobrem as três métricas-chave
// do baseline: draw calls, frame time (p50/p95) e heap.
export const REQUIRED_BASELINE_FIELDS = [
  'frameTime.averageFps',
  'frameTime.p50Ms',
  'frameTime.p95Ms',
  'rendering.drawCallsPerFrameAvg',
  'heap.cdpUsedBytes',
] as const;

// Retorna a lista de problemas encontrados (vazia = baseline válido).
export function validateBaseline(data: unknown): string[] {
  const problems: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return ['baseline não é um objeto'];
  }

  const root = data as Record<string, unknown>;
  if (typeof root.collectedAt !== 'string' || root.collectedAt.length === 0) {
    problems.push('collectedAt ausente ou vazio');
  }

  for (const path of REQUIRED_BASELINE_FIELDS) {
    const value = readPath(root, path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`campo ${path} ausente ou não numérico`);
    }
  }

  return problems;
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
