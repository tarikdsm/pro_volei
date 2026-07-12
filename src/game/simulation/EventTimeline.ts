export const EVENT_TIMELINE_KINDS = ['scheduled', 'contact', 'net', 'antenna', 'floor'] as const;

export type EventTimelineKind = (typeof EVENT_TIMELINE_KINDS)[number];
export type EventTimelineToken = string | number;

// Folga menor que um nanossegundo: absorve apenas ruído de soma binária nas fronteiras do tick.
const TIMELINE_EPSILON_SECONDS = 1e-9;

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

function hasHigherPrecedence(
  candidate: EventTimelineCandidate,
  selected: EventTimelineCandidate,
): boolean {
  return (
    candidate.priority < selected.priority ||
    (candidate.priority === selected.priority && candidate.sequence < selected.sequence)
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
  const eligible: { event: T; at: number }[] = [];
  let earliestAt = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.timeWithinTick) ||
      candidate.timeWithinTick < 0 ||
      candidate.timeWithinTick < cursor.at - TIMELINE_EPSILON_SECONDS ||
      candidate.timeWithinTick > end + TIMELINE_EPSILON_SECONDS ||
      cursor.consumedTokens?.has(candidate.token)
    ) {
      continue;
    }

    const at = Math.max(cursor.at, Math.min(end, candidate.timeWithinTick));
    eligible.push({ event: candidate, at });
    earliestAt = Math.min(earliestAt, at);
  }

  let selected: T | null = null;
  let selectedAt = 0;

  // Bucket ancorado no menor instante: evita a não transitividade de comparações pairwise.
  for (const candidate of eligible) {
    if (candidate.at > earliestAt + TIMELINE_EPSILON_SECONDS) continue;
    if (selected === null || hasHigherPrecedence(candidate.event, selected)) {
      selected = candidate.event;
      selectedAt = candidate.at;
    }
  }

  if (selected === null) return null;

  return {
    event: selected,
    at: selectedAt,
    timeFromCursor: selectedAt - cursor.at,
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
