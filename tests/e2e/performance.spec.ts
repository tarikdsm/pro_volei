import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectBrowserProblems,
  exerciseServeControls,
  expectNoBrowserProblems,
  openGameAndStartMatch,
} from './gameHarness';
import { validateBaseline } from '../perf/schema';

type RenderStats = {
  samples: number[];
  frames: number;
  reset: () => void;
};

type BrowserPerfMetrics = {
  durationMs: number;
  frameCount: number;
  averageFps: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  averageDrawCallsPerFrame: number;
  maxDrawCallsPerFrame: number;
  drawCallSampleCount: number;
  rendererInfoCallsAvg: number;
  rendererInfoTrianglesAvg: number;
  heapUsedBytes: number | null;
  heapDeltaBytes: number | null;
};

type CdpPerformanceMetrics = {
  metrics: Array<{
    name: string;
    value: number;
  }>;
};

test('coleta perfil real de FPS, heap e draw calls no jogo', async ({
  context,
  page,
}, testInfo) => {
  const browserProblems = collectBrowserProblems(page);

  await page.addInitScript(() => {
    type StatsWindow = Window &
      typeof globalThis & {
        __pwRenderStats?: RenderStats;
        WebGL2RenderingContext?: typeof WebGLRenderingContext;
      };

    const win = window as StatsWindow;
    const state: RenderStats & { currentDrawCalls: number } = {
      samples: [],
      frames: 0,
      currentDrawCalls: 0,
      reset() {
        this.samples = [];
        this.frames = 0;
        this.currentDrawCalls = 0;
      },
    };

    function patchDrawCalls(proto: WebGLRenderingContext): void {
      for (const methodName of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ] as const) {
        const original = proto[methodName as keyof WebGLRenderingContext];

        if (typeof original !== 'function') continue;

        Object.defineProperty(proto, methodName, {
          configurable: true,
          value(this: WebGLRenderingContext, ...args: unknown[]) {
            state.currentDrawCalls += 1;
            return (original as (...innerArgs: unknown[]) => unknown).apply(this, args);
          },
        });
      }
    }

    patchDrawCalls(WebGLRenderingContext.prototype);
    if (win.WebGL2RenderingContext) {
      patchDrawCalls(win.WebGL2RenderingContext.prototype);
    }

    win.__pwRenderStats = state;

    const recordFrame = (): void => {
      state.samples.push(state.currentDrawCalls);
      state.currentDrawCalls = 0;
      state.frames += 1;
      requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  });

  await openGameAndStartMatch(page, { search: '?tier=2' });
  await exerciseServeControls(page);
  await page.evaluate(() => {
    (
      window as Window & typeof globalThis & { __pwRenderStats?: RenderStats }
    ).__pwRenderStats?.reset();
  });

  const browserMetrics = await page.evaluate(async (): Promise<BrowserPerfMetrics> => {
    type MemoryPerformance = Performance & {
      memory?: {
        usedJSHeapSize: number;
      };
    };
    type StatsWindow = Window & typeof globalThis & { __pwRenderStats?: RenderStats };

    type RendererWindow = Window &
      typeof globalThis & {
        __renderer?: { info?: { render?: { calls?: number; triangles?: number } } };
      };

    const durationMs = 5_000;
    const perf = performance as MemoryPerformance;
    const win = window as StatsWindow;
    const rendererWin = window as RendererWindow;
    const startHeap = perf.memory?.usedJSHeapSize ?? null;
    const frameIntervals: number[] = [];
    // amostras de renderer.info.render (autoReset do Three dá o valor por frame)
    const rendererCalls: number[] = [];
    const rendererTriangles: number[] = [];
    const start = performance.now();
    let previous = start;

    await new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        frameIntervals.push(now - previous);
        previous = now;

        const render = rendererWin.__renderer?.info?.render;
        if (render) {
          if (typeof render.calls === 'number') rendererCalls.push(render.calls);
          if (typeof render.triangles === 'number') rendererTriangles.push(render.triangles);
        }

        if (now - start >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });

    const elapsed = previous - start;
    const sortedIntervals = [...frameIntervals].sort((a, b) => a - b);
    const drawCallSamples = win.__pwRenderStats?.samples ?? [];
    const drawCallTotal = drawCallSamples.reduce((total, sample) => total + sample, 0);
    const endHeap = perf.memory?.usedJSHeapSize ?? null;
    const average = (values: number[]): number =>
      values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;

    return {
      durationMs: Math.round(elapsed),
      frameCount: frameIntervals.length,
      averageFps: Number((frameIntervals.length / (elapsed / 1_000)).toFixed(1)),
      p50FrameMs: Number(
        (sortedIntervals[Math.floor(sortedIntervals.length * 0.5)] ?? 0).toFixed(2),
      ),
      p95FrameMs: Number(
        (sortedIntervals[Math.floor(sortedIntervals.length * 0.95)] ?? 0).toFixed(2),
      ),
      p99FrameMs: Number(
        (sortedIntervals[Math.floor(sortedIntervals.length * 0.99)] ?? 0).toFixed(2),
      ),
      averageDrawCallsPerFrame: Number(
        (drawCallSamples.length > 0 ? drawCallTotal / drawCallSamples.length : 0).toFixed(1),
      ),
      maxDrawCallsPerFrame: drawCallSamples.length > 0 ? Math.max(...drawCallSamples) : 0,
      drawCallSampleCount: drawCallSamples.length,
      rendererInfoCallsAvg: Number(average(rendererCalls).toFixed(1)),
      rendererInfoTrianglesAvg: Number(average(rendererTriangles).toFixed(0)),
      heapUsedBytes: endHeap,
      heapDeltaBytes: endHeap !== null && startHeap !== null ? endHeap - startHeap : null,
    };
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const cdpMetrics = (await cdp.send('Performance.getMetrics')) as CdpPerformanceMetrics;
  await cdp.detach();

  const cdpMetricByName = new Map(cdpMetrics.metrics.map((metric) => [metric.name, metric.value]));
  const baseline = {
    collectedAt: new Date().toISOString(),
    environment: {
      project: testInfo.project.name,
      headless: true,
      viewport: page.viewportSize(),
      note:
        'Baseline INFORMATIVO em Chromium headless. NÃO é orçamento de hardware nem gate de CI; ' +
        'use só para comparar antes/depois das otimizações de perf.',
    },
    frameTime: {
      averageFps: browserMetrics.averageFps,
      p50Ms: browserMetrics.p50FrameMs,
      p95Ms: browserMetrics.p95FrameMs,
      p99Ms: browserMetrics.p99FrameMs,
      frameCount: browserMetrics.frameCount,
      durationMs: browserMetrics.durationMs,
    },
    rendering: {
      drawCallsPerFrameAvg: browserMetrics.averageDrawCallsPerFrame,
      drawCallsPerFrameMax: browserMetrics.maxDrawCallsPerFrame,
      rendererInfoCallsAvg: browserMetrics.rendererInfoCallsAvg,
      rendererInfoTrianglesAvg: browserMetrics.rendererInfoTrianglesAvg,
      sampleCount: browserMetrics.drawCallSampleCount,
    },
    heap: {
      browserUsedBytes: browserMetrics.heapUsedBytes,
      browserDeltaBytes: browserMetrics.heapDeltaBytes,
      cdpUsedBytes: cdpMetricByName.get('JSHeapUsedSize') ?? 0,
      cdpTotalBytes: cdpMetricByName.get('JSHeapTotalSize') ?? null,
    },
  };

  const problems = validateBaseline(baseline);
  expect(problems, `baseline fora do contrato: ${problems.join('; ')}`).toEqual([]);

  const baselineJson = `${JSON.stringify(baseline, null, 2)}\n`;

  // artefato versionado e regenerável: docs/perf/baseline-latest.json
  const specDir = dirname(fileURLToPath(import.meta.url));
  const versionedFile = resolvePath(specDir, '../../docs/perf/baseline-latest.json');
  await mkdir(dirname(versionedFile), { recursive: true });
  await writeFile(versionedFile, baselineJson, 'utf8');

  // cópia efêmera anexada ao relatório do Playwright
  const metricsFile = testInfo.outputPath('performance-metrics.json');
  await writeFile(metricsFile, baselineJson, 'utf8');
  await testInfo.attach('performance-metrics', {
    path: metricsFile,
    contentType: 'application/json',
  });
  console.info(`PERF_METRICS ${JSON.stringify(baseline)}`);

  expect(browserMetrics.frameCount).toBeGreaterThan(10);
  expect(browserMetrics.averageFps).toBeGreaterThan(0);
  expect(browserMetrics.p50FrameMs).toBeGreaterThan(0);
  expect(browserMetrics.p95FrameMs).toBeGreaterThan(0);
  expect(browserMetrics.averageDrawCallsPerFrame).toBeGreaterThan(0);
  expect(browserMetrics.maxDrawCallsPerFrame).toBeGreaterThan(0);
  // confirma que o hook window.__renderer respondeu (renderer.info.render por frame)
  expect(browserMetrics.rendererInfoCallsAvg).toBeGreaterThan(0);
  expect(browserMetrics.rendererInfoTrianglesAvg).toBeGreaterThan(0);
  expect(browserMetrics.maxDrawCallsPerFrame).toBeLessThanOrEqual(250);
  expect(browserMetrics.rendererInfoCallsAvg).toBeLessThanOrEqual(250);
  expect(browserMetrics.rendererInfoTrianglesAvg).toBeLessThanOrEqual(500_000);
  expect(cdpMetricByName.get('JSHeapUsedSize') ?? 0).toBeGreaterThan(0);
  await expectNoBrowserProblems(browserProblems, testInfo);
});
