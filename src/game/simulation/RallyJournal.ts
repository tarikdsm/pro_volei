import type { SimulationTelemetryEvent, SimulationTelemetryPort } from './SimulationTelemetry';
import { TeamSide } from '../../core/constants';

export type JournalAtom = string | number | boolean;

export interface RallyJournalEntry {
  readonly rally: number;
  readonly tick: number;
  readonly type: SimulationTelemetryEvent['type'];
  readonly draws: readonly [number, number, number, number];
  readonly data: readonly JournalAtom[];
}

export const RALLY_JOURNAL_SCHEMA = 'pro-volei-rally-journal-v1' as const;
export const RALLY_JOURNAL_HASH = 'fnv1a32-utf16le-v1' as const;

export interface RallyJournalMetadata {
  readonly seed: number;
  readonly difficulty: number;
  readonly format: number;
  readonly simulationHz?: number;
}

function quantize(value: number, scale: number): number {
  if (!Number.isFinite(value)) throw new RangeError('telemetria exige números finitos');
  const result = Math.round(value * scale);
  return Object.is(result, -0) ? 0 : result;
}

function mm(value: number): number {
  return quantize(value, 1_000);
}

function basisPoints(value: number): number {
  return quantize(Math.max(0, Math.min(1, value)), 10_000);
}

function sideName(side: TeamSide): 'home' | 'away' {
  return side === TeamSide.HOME ? 'home' : 'away';
}

function eventData(event: Readonly<SimulationTelemetryEvent>): readonly JournalAtom[] {
  switch (event.type) {
    case 'rally-start':
      return [sideName(event.serving)];
    case 'serve':
      return [
        sideName(event.side),
        event.athlete,
        basisPoints(event.power),
        mm(event.target.x),
        mm(event.target.y),
        mm(event.target.z),
        mm(event.clearance),
      ];
    case 'contact':
      return [
        sideName(event.side),
        event.athlete,
        event.kind,
        event.possessionTouch,
        event.rallyTouch,
        basisPoints(event.quality),
        mm(event.point.x),
        mm(event.point.y),
        mm(event.point.z),
        mm(event.target.x),
        mm(event.target.y),
        mm(event.target.z),
      ];
    case 'block':
      return [
        sideName(event.side),
        event.outcome,
        mm(event.point.x),
        mm(event.point.y),
        mm(event.point.z),
      ];
    case 'point':
      return [
        sideName(event.winner),
        event.cause,
        event.ace,
        event.score[0],
        event.score[1],
        event.lastTouchSide === null ? 'none' : sideName(event.lastTouchSide),
        event.lastKind ?? 'none',
      ];
    case 'rally-end':
      return [sideName(event.winner), event.cause, event.touches];
  }
}

/** Journal compacto, serializável e estável; não retém Vector3 nem referências mutáveis. */
export class RallyJournal implements SimulationTelemetryPort {
  private readonly mutableEntries: RallyJournalEntry[] = [];
  private readonly metadata: Required<RallyJournalMetadata>;
  private rallyIndex = -1;

  constructor(metadata: RallyJournalMetadata) {
    if (!Number.isInteger(metadata.seed) || metadata.seed < 0 || metadata.seed > 0xffff_ffff) {
      throw new RangeError('seed do journal deve ser uint32');
    }
    this.metadata = Object.freeze({
      seed: metadata.seed,
      difficulty: metadata.difficulty,
      format: metadata.format,
      simulationHz: metadata.simulationHz ?? 60,
    });
  }

  get entries(): readonly Readonly<RallyJournalEntry>[] {
    return Object.freeze([...this.mutableEntries]);
  }

  emit(event: Readonly<SimulationTelemetryEvent>): void {
    if (event.type === 'rally-start') this.rallyIndex += 1;
    const rally = Math.max(0, this.rallyIndex);
    const draws = Object.freeze([
      event.draws.rules,
      event.draws.ai,
      event.draws.contact,
      event.draws.control,
    ]) as unknown as RallyJournalEntry['draws'];
    const entry = Object.freeze({
      tick: event.tick,
      rally,
      type: event.type,
      draws,
      data: Object.freeze([...eventData(event)]),
    });
    this.mutableEntries.push(entry);
  }

  serialize(entries: readonly Readonly<RallyJournalEntry>[] = this.mutableEntries): string {
    return JSON.stringify({
      schema: RALLY_JOURNAL_SCHEMA,
      hashAlgorithm: RALLY_JOURNAL_HASH,
      seed: this.metadata.seed >>> 0,
      difficulty: this.metadata.difficulty,
      format: this.metadata.format,
      simulationHz: this.metadata.simulationHz ?? 60,
      events: entries,
    });
  }

  hash(entries: readonly Readonly<RallyJournalEntry>[] = this.mutableEntries): string {
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
