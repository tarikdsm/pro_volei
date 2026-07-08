import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  collectBrowserProblems,
  exerciseServeControls,
  expectNoBrowserProblems,
  openGameAndStartMatch,
} from './gameHarness';

type RenderStats = {
  samples: number[];
  frames: number;
  reset: () => void;
};

type BrowserPerfMetrics = {
  durationMs: number;
  frameCount: number;
  averageFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  averageDrawCallsPerFrame: number;
  maxDrawCallsPerFrame: number;
  drawCallSampleCount: number;
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

  await openGameAndStartMatch(page);
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

    const durationMs = 5_000;
    const perf = performance as MemoryPerformance;
    const win = window as StatsWindow;
    const startHeap = perf.memory?.usedJSHeapSize ?? null;
    const frameIntervals: number[] = [];
    const start = performance.now();
    let previous = start;

    await new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        frameIntervals.push(now - previous);
        previous = now;

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

    return {
      durationMs: Math.round(elapsed),
      frameCount: frameIntervals.length,
      averageFps: Number((frameIntervals.length / (elapsed / 1_000)).toFixed(1)),
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
      heapUsedBytes: endHeap,
      heapDeltaBytes: endHeap !== null && startHeap !== null ? endHeap - startHeap : null,
    };
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const cdpMetrics = (await cdp.send('Performance.getMetrics')) as CdpPerformanceMetrics;
  await cdp.detach();

  const cdpMetricByName = new Map(cdpMetrics.metrics.map((metric) => [metric.name, metric.value]));
  const metrics = {
    collectedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    fps: {
      average: browserMetrics.averageFps,
      p95FrameMs: browserMetrics.p95FrameMs,
      p99FrameMs: browserMetrics.p99FrameMs,
      frameCount: browserMetrics.frameCount,
      durationMs: browserMetrics.durationMs,
    },
    heap: {
      browserUsedBytes: browserMetrics.heapUsedBytes,
      browserDeltaBytes: browserMetrics.heapDeltaBytes,
      cdpUsedBytes: cdpMetricByName.get('JSHeapUsedSize') ?? null,
      cdpTotalBytes: cdpMetricByName.get('JSHeapTotalSize') ?? null,
    },
    rendering: {
      averageDrawCallsPerFrame: browserMetrics.averageDrawCallsPerFrame,
      maxDrawCallsPerFrame: browserMetrics.maxDrawCallsPerFrame,
      drawCallSampleCount: browserMetrics.drawCallSampleCount,
    },
  };

  const metricsFile = testInfo.outputPath('performance-metrics.json');
  await writeFile(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach('performance-metrics', {
    path: metricsFile,
    contentType: 'application/json',
  });
  console.info(`PERF_METRICS ${JSON.stringify(metrics)}`);

  expect(browserMetrics.frameCount).toBeGreaterThan(10);
  expect(browserMetrics.averageFps).toBeGreaterThan(0);
  expect(browserMetrics.p95FrameMs).toBeGreaterThan(0);
  expect(browserMetrics.averageDrawCallsPerFrame).toBeGreaterThan(0);
  expect(browserMetrics.maxDrawCallsPerFrame).toBeGreaterThan(0);
  expect(cdpMetricByName.get('JSHeapUsedSize') ?? 0).toBeGreaterThan(0);
  await expectNoBrowserProblems(browserProblems, testInfo);
});
