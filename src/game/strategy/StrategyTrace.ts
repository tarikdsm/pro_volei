import type { TeamSide } from '../../core/constants';
import type {
  CommittedStrategyDecision,
  StrategyOutboxEvent,
  StrategyOutcomeRecord,
} from './OpponentStrategySystem';
import type { StrategyDecisionKind, StrategyOptionId } from './StrategyTypes';

export const STRATEGY_TRACE_SCHEMA = 'pro-volei-strategy-trace-v1' as const;
export const STRATEGY_TRACE_HASH = 'fnv1a32-utf16le-v1' as const;

export interface StrategyTraceCandidate {
  readonly optionId: StrategyOptionId;
  readonly family: string;
  readonly targetMm: readonly [number, number];
  readonly componentsBps: Readonly<Record<string, number>>;
  readonly scoreBps: number;
  readonly probabilityBps: number;
}

export type StrategyTraceOutcome =
  Readonly<{ status: 'resolved'; effectivenessBps: number }> | Readonly<{ status: 'revoked' }>;

export interface StrategyTraceEntry {
  readonly rally: number;
  readonly decisionId: string;
  readonly matchEpoch: number;
  readonly side: TeamSide;
  readonly sequence: number;
  readonly kind: StrategyDecisionKind;
  readonly decisionTick: number;
  readonly observationTick: number;
  readonly memoryRevision: number;
  readonly candidates: readonly Readonly<StrategyTraceCandidate>[];
  readonly chosenOptionId: StrategyOptionId;
  /** Ticket uint32 na ordem selection, variation. */
  readonly ticket: readonly [number, number];
  /** Contadores before/after do stream strategy do próprio lado. Cada decisão custa dois draws. */
  readonly strategyDraws: readonly [number, number];
  readonly outcome: StrategyTraceOutcome | null;
}

function quantize(value: number, scale: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} exige número finito`);
  const result = Math.round(value * scale);
  return Object.is(result, -0) ? 0 : result;
}

function basisPoints(value: number, label: string): number {
  if (value < 0 || value > 1) throw new RangeError(`${label} deve estar em [0,1]`);
  return quantize(value, 10_000, label);
}

function millimeters(value: number): number {
  return quantize(value, 1_000, 'target estratégico');
}

function tuple(first: number, second: number): readonly [number, number] {
  return Object.freeze([first, second]) as readonly [number, number];
}

function assertSafeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} deve ser inteiro seguro não negativo`);
  }
}

function compareCanonical(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function canonicalComponents(
  source: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const entries = Object.entries(source)
    .sort(([first], [second]) => compareCanonical(first, second))
    .map(([name, value]) => [name, basisPoints(value, `componente ${name}`)] as const);
  return Object.freeze(Object.fromEntries(entries) as Record<string, number>);
}

function canonicalCandidates(
  decision: Readonly<CommittedStrategyDecision>,
): readonly Readonly<StrategyTraceCandidate>[] {
  const seen = new Set<StrategyOptionId>();
  const candidates = decision.proposal.candidates.map((candidate) => {
    if (candidate.kind !== decision.kind)
      throw new RangeError('kind do candidato diverge da decisão');
    if (seen.has(candidate.optionId)) throw new RangeError('candidato estratégico duplicado');
    seen.add(candidate.optionId);
    return Object.freeze({
      optionId: candidate.optionId,
      family: candidate.family,
      targetMm: tuple(millimeters(candidate.target.x), millimeters(candidate.target.z)),
      componentsBps: canonicalComponents(candidate.components),
      scoreBps: basisPoints(candidate.score, 'score estratégico'),
      probabilityBps: basisPoints(candidate.probability, 'probabilidade estratégica'),
    });
  });
  candidates.sort((first, second) => compareCanonical(first.optionId, second.optionId));
  if (!seen.has(decision.proposal.chosen.optionId)) {
    throw new RangeError('escolha estratégica ausente dos candidatos');
  }
  return Object.freeze(candidates);
}

function traceDecision(
  decision: Readonly<CommittedStrategyDecision>,
  rally: number,
): Readonly<StrategyTraceEntry> {
  assertSafeNonNegative(rally, 'rally do trace');
  assertSafeNonNegative(decision.matchEpoch, 'matchEpoch do trace');
  if (!Number.isSafeInteger(decision.sequence) || decision.sequence < 1) {
    throw new RangeError('sequence do trace deve ser inteiro seguro positivo');
  }
  assertSafeNonNegative(decision.decisionTick, 'decisionTick do trace');
  assertSafeNonNegative(decision.observationTick, 'observationTick do trace');
  assertSafeNonNegative(decision.memoryRevision, 'memoryRevision do trace');
  if (decision.observationTick > decision.decisionTick) {
    throw new RangeError('observationTick não pode superar decisionTick');
  }
  const before = (decision.sequence - 1) * 2;
  const after = decision.sequence * 2;
  if (!Number.isSafeInteger(after)) throw new RangeError('janela de draws excede inteiro seguro');
  const ticket = decision.proposal.ticket;
  for (const [label, value] of [
    ['selection', ticket.selection],
    ['variation', ticket.variation],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError(`${label} do ticket deve ser uint32`);
    }
  }
  if (
    decision.proposal.kind !== decision.kind ||
    decision.proposal.side !== decision.side ||
    decision.proposal.observationTick !== decision.observationTick
  ) {
    throw new RangeError('proposal diverge da decisão comprometida');
  }

  return Object.freeze({
    rally,
    decisionId: decision.decisionId,
    matchEpoch: decision.matchEpoch,
    side: decision.side,
    sequence: decision.sequence,
    kind: decision.kind,
    decisionTick: decision.decisionTick,
    observationTick: decision.observationTick,
    memoryRevision: decision.memoryRevision,
    candidates: canonicalCandidates(decision),
    chosenOptionId: decision.proposal.chosen.optionId,
    ticket: tuple(ticket.selection, ticket.variation),
    strategyDraws: tuple(before, after),
    outcome: null,
  });
}

function traceOutcome(outcome: Readonly<StrategyOutcomeRecord>): StrategyTraceOutcome {
  if (outcome.status === 'pending') throw new RangeError('outcome do trace deve ser terminal');
  if (outcome.status === 'resolved') {
    if (outcome.effectiveness === undefined) {
      throw new RangeError('outcome resolvido exige effectiveness');
    }
    return Object.freeze({
      status: 'resolved',
      effectivenessBps: basisPoints(outcome.effectiveness, 'effectiveness terminal'),
    });
  }
  if (outcome.effectiveness !== undefined) {
    throw new RangeError('outcome revogado não aceita effectiveness');
  }
  return Object.freeze({ status: 'revoked' });
}

/**
 * Trace estratégico puro e separado do RallyJournal v1. O consumidor fornece o rally do commit;
 * outcomes posteriores apenas completam a entrada original e nunca reatribuem esse rally.
 */
export class StrategyTraceCollector {
  private mutableEntries: Readonly<StrategyTraceEntry>[] = [];
  private readonly entryIndexByDecisionId = new Map<string, number>();

  get entries(): readonly Readonly<StrategyTraceEntry>[] {
    return Object.freeze([...this.mutableEntries]);
  }

  get length(): number {
    return this.mutableEntries.length;
  }

  record(event: Readonly<StrategyOutboxEvent>, rally: number): void {
    assertSafeNonNegative(rally, 'rally do trace');
    if (event.type === 'decision-committed') {
      const id = event.decision.decisionId;
      if (this.entryIndexByDecisionId.has(id)) {
        throw new Error(`decisão duplicada no trace: ${id}`);
      }
      const entry = traceDecision(event.decision, rally);
      this.entryIndexByDecisionId.set(id, this.mutableEntries.length);
      this.mutableEntries = [...this.mutableEntries, entry];
      return;
    }

    const outcome = event.outcome;
    const index = this.entryIndexByDecisionId.get(outcome.decisionId);
    if (index === undefined)
      throw new Error(`decisão desconhecida no trace: ${outcome.decisionId}`);
    const current = this.mutableEntries[index];
    if (current.outcome !== null) {
      throw new Error(`outcome terminal duplicado no trace: ${outcome.decisionId}`);
    }
    if (
      outcome.side !== current.side ||
      outcome.kind !== current.kind ||
      outcome.optionId !== current.chosenOptionId
    ) {
      throw new Error(`outcome diverge da decisão do trace: ${outcome.decisionId}`);
    }
    const terminal = traceOutcome(outcome);
    const updated = Object.freeze({ ...current, outcome: terminal });
    this.mutableEntries = this.mutableEntries.map((entry, entryIndex) =>
      entryIndex === index ? updated : entry,
    );
  }

  entriesForRally(rally: number): readonly Readonly<StrategyTraceEntry>[] {
    assertSafeNonNegative(rally, 'rally do trace');
    return Object.freeze(this.mutableEntries.filter((entry) => entry.rally === rally));
  }

  sliceFrom(index: number): readonly Readonly<StrategyTraceEntry>[] {
    assertSafeNonNegative(index, 'índice do trace');
    return Object.freeze(this.mutableEntries.slice(index));
  }

  serialize(entries: readonly Readonly<StrategyTraceEntry>[] = this.mutableEntries): string {
    return JSON.stringify({
      schema: STRATEGY_TRACE_SCHEMA,
      hashAlgorithm: STRATEGY_TRACE_HASH,
      entries,
    });
  }

  hash(entries: readonly Readonly<StrategyTraceEntry>[] = this.mutableEntries): string {
    let hash = 0x811c_9dc5;
    const serialized = this.serialize(entries);
    for (let index = 0; index < serialized.length; index++) {
      const code = serialized.charCodeAt(index);
      hash = Math.imul(hash ^ (code & 0xff), 0x0100_0193) >>> 0;
      hash = Math.imul(hash ^ (code >>> 8), 0x0100_0193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
