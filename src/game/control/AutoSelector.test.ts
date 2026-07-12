import { describe, expect, it } from 'vitest';
import { AUTO_SELECTOR } from '../../core/constants';
import { AutoSelector, type InterceptCandidate, type InterceptRequest } from './AutoSelector';

type Player = { name: string };

function candidate(
  id: number,
  distance: number,
  overrides: Partial<InterceptCandidate<Player>> = {},
): InterceptCandidate<Player> {
  return {
    id,
    value: { name: `P${id}` },
    distance,
    projectedVelocity: 0,
    lateralVelocity: 0,
    maxSpeed: 6,
    acceleration: 30,
    deceleration: 40,
    legal: true,
    tacticalCost: 0,
    coverageCost: 0,
    approachCost: 0,
    ...overrides,
  };
}

function request(
  candidates: InterceptCandidate<Player>[],
  overrides: Partial<InterceptRequest<Player>> = {},
): InterceptRequest<Player> {
  return {
    planId: 1,
    contactIn: 1,
    technicalRadius: 1.15,
    candidates,
    ...overrides,
  };
}

describe('AutoSelector — atribuição inicial', () => {
  it('escolhe o menor score viável e não conta a atribuição como troca', () => {
    const selector = new AutoSelector<Player>();

    const result = selector.begin(request([candidate(2, 4), candidate(1, 2)]));

    expect(result.selected?.id).toBe(1);
    expect(result.feasible).toBe(true);
    expect(result.switches).toBe(0);
    expect(result.status).toBe('selected');
  });

  it('desempata por id independentemente da ordem de entrada', () => {
    const forward = new AutoSelector<Player>().begin(
      request([candidate(3, 2), candidate(1, 2), candidate(2, 2)]),
    );
    const reverse = new AutoSelector<Player>().begin(
      request([candidate(2, 2), candidate(1, 2), candidate(3, 2)]),
    );

    expect(forward.selected?.id).toBe(1);
    expect(reverse.selected?.id).toBe(1);
  });

  it('ignora atleta ilegal e marca explicitamente quando nenhuma é legal', () => {
    const selector = new AutoSelector<Player>();
    const result = selector.begin(
      request([candidate(1, 1, { legal: false }), candidate(2, 2, { legal: false })]),
    );

    expect(result.status).toBe('no-candidate');
    expect(result.selected).toBe(null);
    expect(result.feasible).toBe(false);
  });

  it('descarta custos não finitos em vez de selecionar score infinito', () => {
    const result = new AutoSelector<Player>().begin(
      request([candidate(1, 1, { tacticalCost: Number.NaN })]),
    );

    expect(result.status).toBe('no-candidate');
    expect(result.selected).toBe(null);
  });

  it('mantém a melhor candidata com feasible=false quando ninguém chega a tempo', () => {
    const result = new AutoSelector<Player>().begin(
      request([candidate(1, 8), candidate(2, 10)], { contactIn: 0.1 }),
    );

    expect(result.selected?.id).toBe(1);
    expect(result.feasible).toBe(false);
    expect(result.score).toBeGreaterThan(AUTO_SELECTOR.unreachablePenalty);
  });

  it('não promete interceptação quando a velocidade lateral impede chegar a tempo', () => {
    const result = new AutoSelector<Player>().begin(
      request([candidate(1, 2, { lateralVelocity: 6.2, maxSpeed: 6.2, acceleration: 31 })], {
        contactIn: 0.28,
      }),
    );

    expect(result.feasible).toBe(false);
  });

  it('considera custos tático, de cobertura e de aproximação no score', () => {
    const result = new AutoSelector<Player>().begin(
      request([
        candidate(1, 2, { tacticalCost: 0.4 }),
        candidate(2, 2.5, { coverageCost: 0.01, approachCost: 0.01 }),
      ]),
    );

    expect(result.selected?.id).toBe(2);
  });
});

describe('AutoSelector — histerese e compromisso', () => {
  it('não troca com melhora inferior a 15% e troca exatamente no limiar', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(
      request([candidate(1, 0, { tacticalCost: 1 }), candidate(2, 0, { tacticalCost: 2 })]),
    );

    const held = selector.update(
      request([candidate(1, 0, { tacticalCost: 1 }), candidate(2, 0, { tacticalCost: 0.8501 })]),
    );
    expect(held.selected?.id).toBe(1);

    const switched = selector.update(
      request([candidate(1, 0, { tacticalCost: 1 }), candidate(2, 0, { tacticalCost: 0.85 })]),
    );
    expect(switched.selected?.id).toBe(2);
    expect(switched.status).toBe('switched');
  });

  it('não troca num empate de score zero só porque a nova candidata tem id menor', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(2, 0)]));

    const held = selector.update(request([candidate(1, 0), candidate(2, 0)]));

    expect(held.selected?.id).toBe(2);
    expect(held.switches).toBe(0);
    expect(held.status).toBe('held');
  });

  it('permite no máximo duas trocas no mesmo plano', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(1, 5), candidate(2, 6), candidate(3, 7)]));

    expect(
      selector.update(request([candidate(1, 5), candidate(2, 1), candidate(3, 7)])).selected?.id,
    ).toBe(2);
    expect(
      selector.update(request([candidate(1, 5), candidate(2, 4), candidate(3, 0.5)])).selected?.id,
    ).toBe(3);
    const capped = selector.update(request([candidate(1, 0.1), candidate(2, 4), candidate(3, 5)]));

    expect(capped.selected?.id).toBe(3);
    expect(capped.switches).toBe(2);
    expect(capped.status).toBe('max-switches');
  });

  it('troca a atual ausente fora do lock e conta a transferência', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(1, 1), candidate(2, 2)]));

    const rebound = selector.update(request([candidate(2, 2)]));

    expect(rebound.selected?.id).toBe(2);
    expect(rebound.switches).toBe(1);
    expect(rebound.status).toBe('switched');
  });

  it('trava em 350 ms exatos e não faz troca milagrosa se a atual ficar ilegal', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(1, 2), candidate(2, 4)]));

    const locked = selector.update(
      request([candidate(1, 2), candidate(2, 0.1)], { contactIn: AUTO_SELECTOR.lockWindow }),
    );
    expect(locked.selected?.id).toBe(1);
    expect(locked.locked).toBe(true);
    expect(locked.status).toBe('locked');

    const illegal = selector.update(
      request([candidate(1, 2, { legal: false }), candidate(2, 0.1)], { contactIn: 0.2 }),
    );
    expect(illegal.selected?.id).toBe(1);
    expect(illegal.status).toBe('locked-illegal');
  });

  it('novo planId reinicia lock e contagem de trocas', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(1, 4), candidate(2, 5)]));
    selector.update(request([candidate(1, 4), candidate(2, 1)]));

    const next = selector.update(
      request([candidate(3, 2), candidate(4, 3)], { planId: 2, contactIn: 0.2 }),
    );

    expect(next.selected?.id).toBe(3);
    expect(next.switches).toBe(0);
    expect(next.status).toBe('selected');
  });

  it('release limpa o snapshot', () => {
    const selector = new AutoSelector<Player>();
    selector.begin(request([candidate(1, 1)]));

    selector.release();

    expect(selector.snapshot()).toMatchObject({ planId: null, selectedId: null, switches: 0 });
  });
});
