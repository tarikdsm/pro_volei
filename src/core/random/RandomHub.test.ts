import { describe, expect, it } from 'vitest';
import { RandomHub } from './RandomHub';

function take(hub: RandomHub, name: string, count = 6): number[] {
  const stream = hub.stream(name);
  return Array.from({ length: count }, () => stream.nextUint32());
}

describe('RandomHub', () => {
  it('deriva streams por nome sem depender da ordem de criação', () => {
    const first = new RandomHub(2026);
    const firstAi = take(first, 'ai');
    const firstRules = take(first, 'rules');

    const second = new RandomHub(2026);
    const secondRules = take(second, 'rules');
    const secondAi = take(second, 'ai');

    expect(secondAi).toEqual(firstAi);
    expect(secondRules).toEqual(firstRules);
    expect(firstAi).not.toEqual(firstRules);
  });

  it('fixa golden vectors da derivação (rootSeed, nome)', () => {
    const hub = new RandomHub(2026);

    expect(take(hub, 'ai')).toEqual([
      1_388_260_073, 1_585_300_955, 3_903_095_988, 3_230_685_371, 4_197_659_793, 3_627_663_899,
    ]);
    expect(take(hub, 'rules')).toEqual([
      3_335_718_547, 4_277_758_356, 3_902_459_506, 4_254_137_502, 685_402_124, 3_966_074_874,
    ]);
  });

  it('devolve a mesma instância para o mesmo nome', () => {
    const hub = new RandomHub(7);
    expect(hub.stream('contact')).toBe(hub.stream('contact'));
  });

  it('snapshot/restore recupera streams existentes e remove avanço posterior', () => {
    const hub = new RandomHub(99);
    const ai = hub.stream('ai');
    const rules = hub.stream('rules');
    ai.nextUint32();
    rules.nextUint32();
    const checkpoint = hub.snapshot();
    const expectedAi = Array.from({ length: 4 }, () => ai.nextUint32());
    const late = hub.stream('late');
    late.nextUint32();
    const lateAtOrigin = new RandomHub(99).stream('late').nextUint32();

    hub.restore(checkpoint);

    expect(hub.snapshot()).toEqual(checkpoint);
    expect(Array.from({ length: 4 }, () => ai.nextUint32())).toEqual(expectedAi);
    expect(() => late.nextUint32()).toThrow(/inativo/i);
    expect(hub.stream('late')).toBe(late);
    expect(late.nextUint32()).toBe(lateAtOrigin);
    expect(hub.stream('ai')).toBe(ai);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.streams)).toBe(true);
  });

  it('serializa streams em ordem lexical estável', () => {
    const hub = new RandomHub(5);
    hub.stream('rules');
    hub.stream('ai');
    hub.stream('contact');

    expect(hub.snapshot().streams.map((entry) => entry.name)).toEqual(['ai', 'contact', 'rules']);
  });

  it('rejeita seed, nome e snapshot incompatíveis', () => {
    expect(() => new RandomHub(-1)).toThrow(RangeError);
    const hub = new RandomHub(1);
    expect(() => hub.stream('')).toThrow(RangeError);
    expect(() => hub.stream('   ')).toThrow(RangeError);

    const snapshot = new RandomHub(2).snapshot();
    expect(() => hub.restore(snapshot)).toThrow(/rootSeed/i);
    expect(() => hub.restore({ ...hub.snapshot(), algorithm: 'outro-v1' })).toThrow(/algorithm/i);
  });
});
