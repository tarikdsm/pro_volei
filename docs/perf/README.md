# Baseline de performance

Este diretório guarda o **baseline reproduzível** de performance do Pró Volei, usado como
referência para provar ganho e detectar regressão nas otimizações de perf (M9/M10/M11/B9/B10/B11).

> ⚠️ **Baseline INFORMATIVO, nunca gate.** Os números vêm de Chromium **headless** (CI/dev), que
> é ~10× mais lento que o hardware alvo e ruidoso entre execuções. Servem só para comparar
> **antes/depois** de cada otimização — **não** viram threshold de FPS no `npm run check`/CI.

## Como o harness mede

O harness é o teste Playwright `tests/e2e/performance.spec.ts`. Ele:

1. Abre o jogo, inicia uma partida e exercita o saque (mesma sequência determinista do smoke).
2. Zera os contadores e observa **5 s** de jogo, coletando por frame:
   - **frame time** — `p50`, `p95`, `p99` e FPS médio a partir dos intervalos de `requestAnimationFrame`.
   - **draw calls** — dois métodos que se conferem: contagem real via _patch_ das chamadas
     `drawArrays/drawElements(Instanced)` do WebGL **e** `renderer.info.render.calls` do Three
     (exposto em `window.__renderer` só para leitura).
   - **triângulos por frame** — `renderer.info.render.triangles`.
   - **heap** — `performance.memory` no browser e `JSHeapUsedSize/TotalSize` via CDP
     (`Performance.getMetrics`), mais confiável em headless.
3. Valida o formato contra `tests/perf/schema.ts` e grava o resultado em
   [`baseline-latest.json`](./baseline-latest.json).

## Como rodar

```bash
npm run perf:baseline     # roda o harness e regenera docs/perf/baseline-latest.json
```

Sobe o dev server na porta dedicada **5199** (`--strictPort`; a 5173 colide com outro projeto).
O comando **reescreve** `baseline-latest.json` — é o arquivo regenerável. Também é regenerado ao
rodar a suíte e2e completa (`npm run test:e2e`).

## Fluxo antes/depois de otimizar

1. **Antes** de mexer: `npm run perf:baseline` e anote os números (ou use a última medição).
2. Aplique a otimização (ex.: instancing, merge de geometria, menos draw calls).
3. **Depois**: `npm run perf:baseline` de novo e compare `drawCallsPerFrameAvg`,
   `rendererInfoTrianglesAvg`, `frameTime.p95Ms` e `heap.cdpUsedBytes`.
4. Ao fechar um marco, congele uma cópia datada como snapshot histórico:
   ```bash
   cp docs/perf/baseline-latest.json docs/perf/baseline-AAAA-MM-DD.json
   ```

## Arquivos

- `baseline-latest.json` — última medição (regenerada pelo harness).
- `baseline-AAAA-MM-DD.json` — snapshots datados, congelados por marco (comparação histórica).

## Chaves do JSON

| Caminho | Significado |
|---|---|
| `frameTime.averageFps` | FPS médio na janela de 5 s |
| `frameTime.p50Ms` / `p95Ms` / `p99Ms` | tempo de frame (mediana / cauda) em ms |
| `rendering.drawCallsPerFrameAvg` / `Max` | draw calls por frame (patch WebGL) |
| `rendering.rendererInfoCallsAvg` | draw calls por frame (`renderer.info.render.calls`) |
| `rendering.rendererInfoTrianglesAvg` | triângulos por frame (`renderer.info.render.triangles`) |
| `heap.cdpUsedBytes` / `cdpTotalBytes` | heap JS via CDP (bytes) |
| `heap.browserUsedBytes` / `browserDeltaBytes` | heap via `performance.memory` (pode faltar) |
