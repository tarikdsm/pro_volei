import { describe, expect, it } from 'vitest';
import { FpsMeter } from './FpsMeter';

describe('FpsMeter', () => {
  it('fecha a janela de 0,5 s e reporta o fps arredondado', () => {
    const meter = new FpsMeter(0.5);
    expect(meter.value).toBeNull();
    let reported: number | null = null;
    for (let i = 0; i < 30; i += 1) reported = meter.sample(1 / 60);
    expect(reported).toBe(60);
    expect(meter.value).toBe(60);
  });

  it('reporta fps baixo quando os frames demoram', () => {
    const meter = new FpsMeter(0.5);
    let reported: number | null = null;
    for (let i = 0; i < 15; i += 1) reported = meter.sample(1 / 30);
    expect(reported).toBe(30);
  });

  it('ignora dt não positivo sem quebrar a janela', () => {
    const meter = new FpsMeter(0.5);
    meter.sample(0);
    meter.sample(-1);
    expect(meter.value).toBeNull();
    for (let i = 0; i < 30; i += 1) meter.sample(1 / 60);
    expect(meter.value).toBe(60);
  });

  it('reset limpa a janela e o valor', () => {
    const meter = new FpsMeter(0.5);
    for (let i = 0; i < 30; i += 1) meter.sample(1 / 60);
    meter.reset();
    expect(meter.value).toBeNull();
  });
});
