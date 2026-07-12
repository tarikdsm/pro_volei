import { describe, expect, it } from 'vitest';
import {
  EVENT_TIMELINE_KINDS,
  consumeTimelineEvent,
  selectNextTimelineEvent,
  type EventTimelineCandidate,
} from './EventTimeline';

function candidate(
  token: string,
  timeWithinTick: number,
  priority = 0,
  sequence = 0,
  kind: EventTimelineCandidate['kind'] = 'scheduled',
): EventTimelineCandidate {
  return { kind, timeWithinTick, priority, sequence, token };
}

describe('EventTimeline', () => {
  it('representa e seleciona eventos agendados, contato, rede, antena e chão', () => {
    expect(EVENT_TIMELINE_KINDS).toEqual(['scheduled', 'contact', 'net', 'antenna', 'floor']);

    const kinds = EVENT_TIMELINE_KINDS.map((kind, sequence) =>
      candidate(kind, 0.001 * (sequence + 1), 0, sequence, kind),
    );

    expect(selectNextTimelineEvent(kinds, { at: 0, remaining: 1 / 60 })?.event.kind).toBe(
      'scheduled',
    );
  });

  it('ordena por instante, prioridade e sequência, nessa ordem', () => {
    const events = [
      candidate('later', 0.009, -10, 0),
      candidate('priority-lower', 0.006, 1, 9),
      candidate('sequence-lower', 0.006, 1, 2),
      candidate('priority-higher', 0.006, 2, 0),
    ];

    const selected = selectNextTimelineEvent(events, { at: 0.004, remaining: 0.008 });

    expect(selected).toMatchObject({
      event: { token: 'sequence-lower' },
      at: 0.006,
      timeFromCursor: 0.002,
      consumptionToken: 'sequence-lower',
    });
  });

  it('ignora tempos não finitos, negativos, anteriores ao cursor e posteriores à janela', () => {
    const selected = selectNextTimelineEvent(
      [
        candidate('nan', Number.NaN),
        candidate('positive-infinity', Number.POSITIVE_INFINITY),
        candidate('negative-infinity', Number.NEGATIVE_INFINITY),
        candidate('negative', -0.001),
        candidate('already-passed', 0.004),
        candidate('outside', 0.016_001),
        candidate('valid', 0.012),
      ],
      { at: 0.005, remaining: 0.011 },
    );

    expect(selected?.event.token).toBe('valid');
  });

  it('inclui as duas fronteiras e, com remaining zero, aceita somente o cursor', () => {
    const start = candidate('start', 0.005, 0, 0);
    const end = candidate('end', 0.015, 0, 1);

    expect(selectNextTimelineEvent([end, start], { at: 0.005, remaining: 0.01 })?.event).toBe(
      start,
    );
    expect(selectNextTimelineEvent([end], { at: 0.005, remaining: 0.01 })?.event).toBe(end);
    expect(selectNextTimelineEvent([start, end], { at: 0.005, remaining: 0 })?.event).toBe(start);
  });

  it('exige consumo explícito para não repetir um evento no cursor sem avanço temporal', () => {
    const first = candidate('contact:7', 0, 0, 7, 'contact');
    const second = candidate('net:8', 0, 1, 8, 'net');
    const cursor = { at: 0, remaining: 1 / 60 };

    const selectedFirst = selectNextTimelineEvent([second, first], cursor);
    expect(selectedFirst?.event).toBe(first);
    expect(selectedFirst?.timeFromCursor).toBe(0);

    const consumed = consumeTimelineEvent(new Set(), selectedFirst!);
    const selectedSecond = selectNextTimelineEvent([second, first], {
      ...cursor,
      consumedTokens: consumed,
    });

    expect(selectedSecond?.event).toBe(second);
    expect(consumed).toEqual(new Set(['contact:7']));
  });

  it('não altera o conjunto de tokens consumidos recebido', () => {
    const consumed = new Set<string | number>(['old']);
    const selected = selectNextTimelineEvent([candidate('new', 0)], {
      at: 0,
      remaining: 0,
    });

    const next = consumeTimelineEvent(consumed, selected!);

    expect(consumed).toEqual(new Set(['old']));
    expect(next).toEqual(new Set(['old', 'new']));
  });

  it('é determinístico para ordens de entrada diferentes quando a sequência desempata', () => {
    const events = [
      candidate('sequence-3', 0.01, 4, 3),
      candidate('sequence-1', 0.01, 4, 1),
      candidate('sequence-2', 0.01, 4, 2),
    ];

    const forward = selectNextTimelineEvent(events, { at: 0, remaining: 0.02 });
    const reverse = selectNextTimelineEvent([...events].reverse(), { at: 0, remaining: 0.02 });

    expect(forward?.event.token).toBe('sequence-1');
    expect(reverse?.event.token).toBe('sequence-1');
  });

  it('retorna null quando a janela ou todos os candidatos são inválidos', () => {
    expect(selectNextTimelineEvent([candidate('valid', 0)], { at: Number.NaN, remaining: 1 })).toBe(
      null,
    );
    expect(selectNextTimelineEvent([candidate('valid', 0)], { at: 0, remaining: -1 })).toBe(null);
    expect(
      selectNextTimelineEvent([candidate('invalid', Number.NaN)], { at: 0, remaining: 1 }),
    ).toBe(null);
  });
});
