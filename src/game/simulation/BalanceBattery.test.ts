// Baterias de balanceamento da Fase 3D. São gates de regressão das metas §4.3/§3.2 do design
// 2.0 na dificuldade Normal. Sob coverage os tempos crescem; os timeouts são deliberadamente
// folgados — a bateria valida faixas estatísticas, não latência.
import { describe, expect, it } from 'vitest';
import { buildBalanceReport, median, percentile } from './BalanceMetrics';
import { runHeadlessBatch, runHeadlessMatches } from './HeadlessRallyRunner';
import type { BalanceRallySample } from './BalanceMetrics';

const NORMAL = 1;
const FORMAT_2_0 = 0;

describe('baterias de balanceamento — Normal', () => {
  it('matriz §4.3: 1.000 rallies em 20 seeds dentro das faixas', { timeout: 240_000 }, () => {
    const startedAt = performance.now();
    const samples: BalanceRallySample[] = [];
    for (let seed = 0; seed < 20; seed += 1) {
      const batch = runHeadlessBatch({
        seed: 0x3d40_0000 + seed,
        rallies: 50,
        difficulty: NORMAL,
        format: FORMAT_2_0,
      });
      samples.push(...batch.rallies);
    }
    const report = buildBalanceReport(samples);
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      `BALANCE_MATRIX rallies=${report.rallies} contactsMedian=${report.contactsMedian} ` +
        `decisiveShare=${report.decisiveShare.toFixed(3)} ` +
        `maxZoneShare=${report.maxZoneShare.toFixed(3)} elapsedMs=${elapsedMs}`,
    );
    expect(report.rallies).toBe(1000);
    expect(report.contactsMedian).toBeGreaterThanOrEqual(4);
    expect(report.contactsMedian).toBeLessThanOrEqual(8);
    expect(report.decisiveShare).toBeGreaterThanOrEqual(0.65);
    expect(report.maxZoneShare).toBeLessThanOrEqual(0.45);
  });

  it(
    'duração §3.2: 30 partidas em 10 seeds com mediana 8–12 min e p90 ≤ 15 min',
    { timeout: 480_000 },
    () => {
      const startedAt = performance.now();
      const minutes: number[] = [];
      for (let seed = 0; seed < 10; seed += 1) {
        const result = runHeadlessMatches({
          seed: 0x3d50_0000 + seed,
          matches: 3,
          difficulty: NORMAL,
          format: FORMAT_2_0,
        });
        for (const match of result.matches) minutes.push(match.durationSeconds / 60);
      }
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(
        `DURATION_MATRIX matches=${minutes.length} medianMin=${median(minutes).toFixed(2)} ` +
          `p90Min=${percentile(minutes, 0.9).toFixed(2)} elapsedMs=${elapsedMs}`,
      );
      expect(minutes).toHaveLength(30);
      expect(median(minutes)).toBeGreaterThanOrEqual(8);
      expect(median(minutes)).toBeLessThanOrEqual(12);
      expect(percentile(minutes, 0.9)).toBeLessThanOrEqual(15);
    },
  );
});
