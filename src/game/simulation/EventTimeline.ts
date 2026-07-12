export const EVENT_TIMELINE_KINDS = ['scheduled', 'contact', 'net', 'antenna', 'floor'] as const;

export type EventTimelineKind = (typeof EVENT_TIMELINE_KINDS)[number];
export type EventTimelineToken = string | number;

export interface EventTimelineCandidate {
  readonly kind: EventTimelineKind;
  readonly timeWithinTick: number;
  readonly priority: number;
  readonly sequence: number;
  readonly token: EventTimelineToken;
}

export interface EventTimelineCursor {
  /** Instante absoluto já alcançado dentro do tick. */
  readonly at: number;
  /** Tempo ainda disponível no tick, incluindo o instante final. */
  readonly remaining: number;
  /** Tokens resolvidos neste tick, necessários para consumir eventos sem avanço temporal. */
  readonly consumedTokens?: ReadonlySet<EventTimelineToken>;
}

export interface SelectedTimelineEvent<T extends EventTimelineCandidate> {
  readonly event: T;
  readonly at: number;
  readonly timeFromCursor: number;
  /** Deve ser consumido antes de recalcular candidatos no mesmo instante. */
  readonly consumptionToken: EventTimelineToken;
}

function comesBefore(candidate: EventTimelineCandidate, selected: EventTimelineCandidate): boolean {
  return (
    candidate.timeWithinTick < selected.timeWithinTick ||
    (candidate.timeWithinTick === selected.timeWithinTick &&
      (candidate.priority < selected.priority ||
        (candidate.priority === selected.priority && candidate.sequence < selected.sequence)))
  );
}

export function selectNextTimelineEvent<T extends EventTimelineCandidate>(
  candidates: readonly T[],
  cursor: EventTimelineCursor,
): SelectedTimelineEvent<T> | null {
  if (!Number.isFinite(cursor.at) || !Number.isFinite(cursor.remaining) || cursor.remaining < 0) {
    return null;
  }

  const end = cursor.at + cursor.remaining;
  let selected: T | null = null;

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.timeWithinTick) ||
      candidate.timeWithinTick < 0 ||
      candidate.timeWithinTick < cursor.at ||
      candidate.timeWithinTick > end ||
      cursor.consumedTokens?.has(candidate.token)
    ) {
      continue;
    }

    if (selected === null || comesBefore(candidate, selected)) selected = candidate;
  }

  if (selected === null) return null;

  return {
    event: selected,
    at: selected.timeWithinTick,
    timeFromCursor: selected.timeWithinTick - cursor.at,
    consumptionToken: selected.token,
  };
}

export function consumeTimelineEvent<T extends EventTimelineCandidate>(
  consumedTokens: ReadonlySet<EventTimelineToken>,
  selected: SelectedTimelineEvent<T>,
): ReadonlySet<EventTimelineToken> {
  const next = new Set(consumedTokens);
  next.add(selected.consumptionToken);
  return next;
}
