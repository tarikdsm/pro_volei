import { BLOCK, COURT, TEAM_TACTICS, TeamSide } from '../../core/constants';
import type {
  AthleteTacticalSnapshot,
  TacticalRole,
  TeamPlan,
  TeamTacticsPhase,
} from '../team/TeamTactics';

export const TACTICAL_TRACE_SCHEMA = 'pro-volei-tactical-trace-v1' as const;

export interface TacticalTraceAssignment {
  readonly athleteId: number;
  readonly role: TacticalRole;
  readonly targetMm: readonly [number, number];
}

export interface TacticalTraceExecution {
  readonly athleteId: number;
  readonly startPositionMm: readonly [number, number];
  readonly endPositionMm: readonly [number, number];
  readonly minTargetDistanceMm: number;
  readonly pathLengthMm: number;
  readonly airborneTicks: number;
  readonly maxSpeedMmPerSecond: number;
}

export interface TacticalTraceBlock {
  readonly primaryAthleteId: number;
  readonly assistAthleteId: number | null;
  readonly crossZmm: number;
  readonly contactTicks: number;
  readonly mechanicalContactTick: number | null;
  readonly simultaneousAirborneTicks: number;
}

export interface TacticalTraceEntry {
  readonly rally: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly side: TeamSide;
  readonly revision: number;
  readonly planId: number | null;
  readonly phase: TeamTacticsPhase;
  readonly rosterIds: readonly number[];
  readonly assignments: readonly Readonly<TacticalTraceAssignment>[];
  readonly execution: readonly Readonly<TacticalTraceExecution>[];
  readonly block: Readonly<TacticalTraceBlock> | null;
}

export interface TacticalTraceMetrics {
  readonly violations: number;
  readonly phaseVisits: Readonly<Partial<Record<TeamTacticsPhase, number>>>;
  /** Atletas que realmente percorreram ao menos 25 cm ou saltaram durante um plano. */
  readonly engagedAthletes: readonly [number, number];
  readonly observedAssignments: number;
  readonly arrivedAssignments: number;
  readonly singleBlocks: number;
  readonly doubleBlocks: number;
  readonly executedDoubleBlocks: number;
}

interface MutableExecution {
  readonly athleteId: number;
  readonly targetMm: readonly [number, number];
  readonly startPositionMm: readonly [number, number];
  lastPositionMm: readonly [number, number];
  minTargetDistanceMm: number;
  pathLengthMm: number;
  airborneTicks: number;
  maxSpeedMmPerSecond: number;
}

interface TacticalTraceDraft {
  readonly plan: TeamPlan;
  readonly rally: number;
  readonly startTick: number;
  endTick: number;
  readonly rosterIds: readonly number[];
  readonly executions: MutableExecution[];
  mechanicalBlockContactTick: number | null;
  simultaneousBlockAirborneTicks: number;
}

const EXPECTED_ROLES: Readonly<Partial<Record<TeamTacticsPhase, readonly TacticalRole[]>>> =
  Object.freeze({
    base: ['base', 'base', 'base', 'base', 'base', 'base'],
    recompose: ['base', 'base', 'base', 'base', 'base', 'base'],
    hold: ['base', 'base', 'base', 'base', 'base', 'base'],
    'serve-formation': ['base', 'base', 'base', 'base', 'base', 'server'],
    reception: [
      'active',
      'cover-deep',
      'receive-center',
      'receive-left',
      'receive-right',
      'setter',
    ],
    'offense-transition': [
      'active',
      'attack-center',
      'attack-left',
      'attack-right',
      'cover-short-left',
      'cover-short-right',
    ],
    'attack-coverage': [
      'active',
      'attacker',
      'cover-deep',
      'cover-short-left',
      'cover-short-right',
      'setter',
    ],
  });

const ARRIVAL_RADIUS_MM = 650;
const ENGAGEMENT_DISTANCE_MM = 250;

function quantizeMm(value: number): number {
  return Math.round(value * 1_000);
}

function tuple(x: number, z: number): readonly [number, number] {
  return Object.freeze([x, z]) as readonly [number, number];
}

function sameValues<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

/** Trace separado do RallyJournal: observa intenção e execução sem tocar gameplay, RNG ou replay. */
export class TacticalTraceCollector {
  private readonly mutableEntries: TacticalTraceEntry[] = [];
  private readonly drafts: [TacticalTraceDraft | null, TacticalTraceDraft | null] = [null, null];
  private readonly pendingBlocks: TacticalTraceDraft[] = [];

  get entries(): readonly Readonly<TacticalTraceEntry>[] {
    const active = [
      ...this.pendingBlocks.map((draft) => this.freezeDraft(draft)),
      ...this.drafts.flatMap((draft) => (draft ? [this.freezeDraft(draft)] : [])),
    ];
    return Object.freeze(
      [...this.mutableEntries, ...active].sort(
        (first, second) => first.startTick - second.startTick || first.side - second.side,
      ),
    );
  }

  get length(): number {
    return this.mutableEntries.length;
  }

  sliceFrom(index: number): readonly Readonly<TacticalTraceEntry>[] {
    return Object.freeze(
      this.mutableEntries
        .slice(index)
        .sort((first, second) => first.startTick - second.startTick || first.side - second.side),
    );
  }

  record(
    tick: number,
    rally: number,
    side: TeamSide,
    plan: TeamPlan | null,
    athletes: readonly AthleteTacticalSnapshot[],
  ): void {
    if (!plan) {
      this.detachCurrent(side);
      return;
    }
    if (plan.side !== side) throw new Error('Lado do plano diverge do canal do trace');
    const current = this.drafts[side];
    if (current && (current.plan !== plan || current.rally !== rally)) {
      this.detachCurrent(side);
    }
    this.updatePendingBlocks(side, tick, athletes);
    if (!this.drafts[side]) {
      this.drafts[side] = this.createDraft(tick, rally, plan, athletes);
    }
    this.updateDraft(this.drafts[side]!, tick, athletes);
  }

  flush(): void {
    this.detachCurrent(TeamSide.HOME);
    this.detachCurrent(TeamSide.AWAY);
    for (const draft of this.pendingBlocks.splice(0)) this.finalizeDraft(draft);
  }

  /** Marca o contato aceito por mechanics; evita inferir o cruzamento apenas pelo prazo máximo. */
  recordBlockContact(tick: number, side: TeamSide): void {
    const candidates = [this.drafts[side], ...this.pendingBlocks]
      .filter(
        (draft): draft is TacticalTraceDraft =>
          draft !== null && draft.plan.side === side && draft.plan.block !== null,
      )
      .sort((first, second) => second.startTick - first.startTick);
    const active = candidates.find((draft) => draft.startTick <= tick);
    if (active) active.mechanicalBlockContactTick = tick;
  }

  serialize(entries: readonly Readonly<TacticalTraceEntry>[] = this.entries): string {
    return JSON.stringify({ schema: TACTICAL_TRACE_SCHEMA, entries });
  }

  hash(entries: readonly Readonly<TacticalTraceEntry>[] = this.entries): string {
    let hash = 0x811c_9dc5;
    const serialized = this.serialize(entries);
    for (let index = 0; index < serialized.length; index++) {
      const code = serialized.charCodeAt(index);
      hash = Math.imul(hash ^ (code & 0xff), 0x0100_0193) >>> 0;
      hash = Math.imul(hash ^ (code >>> 8), 0x0100_0193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  metrics(entries: readonly Readonly<TacticalTraceEntry>[] = this.entries): TacticalTraceMetrics {
    let violations = 0;
    let observedAssignments = 0;
    let arrivedAssignments = 0;
    let singleBlocks = 0;
    let doubleBlocks = 0;
    let executedDoubleBlocks = 0;
    const phaseVisits: Partial<Record<TeamTacticsPhase, number>> = {};
    const engaged = [new Set<number>(), new Set<number>()] as const;

    for (const entry of entries) {
      phaseVisits[entry.phase] = (phaseVisits[entry.phase] ?? 0) + 1;
      violations += this.semanticViolations(entry);
      for (const execution of entry.execution) {
        observedAssignments++;
        if (execution.minTargetDistanceMm <= ARRIVAL_RADIUS_MM) arrivedAssignments++;
        if (execution.pathLengthMm >= ENGAGEMENT_DISTANCE_MM || execution.airborneTicks > 0) {
          engaged[entry.side].add(execution.athleteId);
        }
      }
      if (entry.block) {
        if (entry.block.assistAthleteId === null) singleBlocks++;
        else {
          doubleBlocks++;
          if (entry.block.simultaneousAirborneTicks > 0) executedDoubleBlocks++;
        }
      }
    }

    return Object.freeze({
      violations,
      phaseVisits: Object.freeze({ ...phaseVisits }),
      engagedAthletes: Object.freeze([engaged[0].size, engaged[1].size]) as readonly [
        number,
        number,
      ],
      observedAssignments,
      arrivedAssignments,
      singleBlocks,
      doubleBlocks,
      executedDoubleBlocks,
    });
  }

  private createDraft(
    tick: number,
    rally: number,
    plan: TeamPlan,
    athletes: readonly AthleteTacticalSnapshot[],
  ): TacticalTraceDraft {
    const byId = new Map(athletes.map((athlete) => [athlete.athleteId, athlete]));
    return {
      plan,
      rally,
      startTick: tick,
      endTick: tick,
      rosterIds: Object.freeze(athletes.map((athlete) => athlete.athleteId).sort((a, b) => a - b)),
      executions: plan.assignments.map((assignment) => {
        const athlete = byId.get(assignment.athleteId);
        const position = tuple(
          athlete ? quantizeMm(athlete.position.x) : Number.NaN,
          athlete ? quantizeMm(athlete.position.z) : Number.NaN,
        );
        const target = tuple(quantizeMm(assignment.target.x), quantizeMm(assignment.target.z));
        return {
          athleteId: assignment.athleteId,
          targetMm: target,
          startPositionMm: position,
          lastPositionMm: position,
          minTargetDistanceMm: Math.hypot(position[0] - target[0], position[1] - target[1]),
          pathLengthMm: 0,
          airborneTicks: 0,
          maxSpeedMmPerSecond: 0,
        };
      }),
      mechanicalBlockContactTick: null,
      simultaneousBlockAirborneTicks: 0,
    };
  }

  private updateDraft(
    draft: TacticalTraceDraft,
    tick: number,
    athletes: readonly AthleteTacticalSnapshot[],
  ): void {
    draft.endTick = tick;
    const byId = new Map(athletes.map((athlete) => [athlete.athleteId, athlete]));
    for (const execution of draft.executions) {
      const athlete = byId.get(execution.athleteId);
      if (!athlete) continue;
      const position = tuple(quantizeMm(athlete.position.x), quantizeMm(athlete.position.z));
      execution.pathLengthMm += Math.round(
        Math.hypot(
          position[0] - execution.lastPositionMm[0],
          position[1] - execution.lastPositionMm[1],
        ),
      );
      execution.lastPositionMm = position;
      execution.minTargetDistanceMm = Math.min(
        execution.minTargetDistanceMm,
        Math.round(
          Math.hypot(position[0] - execution.targetMm[0], position[1] - execution.targetMm[1]),
        ),
      );
      if (athlete.airborne) execution.airborneTicks++;
      execution.maxSpeedMmPerSecond = Math.max(
        execution.maxSpeedMmPerSecond,
        Math.round(Math.hypot(athlete.velocity.x, athlete.velocity.z) * 1_000),
      );
    }
    const block = draft.plan.block;
    if (
      block?.assistAthleteId !== null &&
      block?.assistAthleteId !== undefined &&
      draft.mechanicalBlockContactTick === tick
    ) {
      const primary = byId.get(block.primaryAthleteId);
      const assist = byId.get(block.assistAthleteId);
      if (primary?.airborne === true && assist?.airborne === true) {
        draft.simultaneousBlockAirborneTicks++;
      }
    }
  }

  private detachCurrent(side: TeamSide): void {
    const draft = this.drafts[side];
    if (!draft) return;
    this.drafts[side] = null;
    if (draft.plan.block) this.pendingBlocks.push(draft);
    else this.finalizeDraft(draft);
  }

  private updatePendingBlocks(
    side: TeamSide,
    tick: number,
    athletes: readonly AthleteTacticalSnapshot[],
  ): void {
    for (let index = this.pendingBlocks.length - 1; index >= 0; index--) {
      const draft = this.pendingBlocks[index];
      if (draft.plan.side !== side) continue;
      this.updateDraft(draft, tick, athletes);
      const contactTicks = Math.max(0, Math.round((draft.plan.block?.contactIn ?? 0) * 60));
      if (tick >= draft.startTick + contactTicks + Math.round(BLOCK.window * 60)) {
        this.pendingBlocks.splice(index, 1);
        this.finalizeDraft(draft);
      }
    }
  }

  private finalizeDraft(draft: TacticalTraceDraft): void {
    this.mutableEntries.push(this.freezeDraft(draft));
  }

  private freezeDraft(draft: TacticalTraceDraft): TacticalTraceEntry {
    const assignments = Object.freeze(
      draft.plan.assignments.map((assignment) =>
        Object.freeze({
          athleteId: assignment.athleteId,
          role: assignment.role,
          targetMm: tuple(quantizeMm(assignment.target.x), quantizeMm(assignment.target.z)),
        }),
      ),
    );
    const execution = Object.freeze(
      draft.executions.map((sample) =>
        Object.freeze({
          athleteId: sample.athleteId,
          startPositionMm: sample.startPositionMm,
          endPositionMm: sample.lastPositionMm,
          minTargetDistanceMm: sample.minTargetDistanceMm,
          pathLengthMm: sample.pathLengthMm,
          airborneTicks: sample.airborneTicks,
          maxSpeedMmPerSecond: sample.maxSpeedMmPerSecond,
        }),
      ),
    );
    const block = draft.plan.block
      ? Object.freeze({
          primaryAthleteId: draft.plan.block.primaryAthleteId,
          assistAthleteId: draft.plan.block.assistAthleteId,
          crossZmm: quantizeMm(draft.plan.block.crossZ),
          contactTicks: Math.max(0, Math.round(draft.plan.block.contactIn * 60)),
          mechanicalContactTick: draft.mechanicalBlockContactTick,
          simultaneousAirborneTicks: draft.simultaneousBlockAirborneTicks,
        })
      : null;
    return Object.freeze({
      rally: draft.rally,
      startTick: draft.startTick,
      endTick: draft.endTick,
      side: draft.plan.side,
      revision: draft.plan.revision,
      planId: draft.plan.planId,
      phase: draft.plan.phase,
      rosterIds: Object.freeze([...draft.rosterIds]),
      assignments,
      execution,
      block,
    });
  }

  private semanticViolations(entry: Readonly<TacticalTraceEntry>): number {
    let violations = 0;
    const rosterIds = [...entry.rosterIds].sort((a, b) => a - b);
    const assignmentIds = entry.assignments
      .map((assignment) => assignment.athleteId)
      .sort((a, b) => a - b);
    const executionIds = entry.execution
      .map((execution) => execution.athleteId)
      .sort((a, b) => a - b);
    if (rosterIds.length !== 6 || new Set(rosterIds).size !== 6) violations++;
    if (!sameValues(rosterIds, assignmentIds)) violations++;
    if (!sameValues(rosterIds, executionIds)) violations++;

    const expectedRoles = EXPECTED_ROLES[entry.phase];
    const actualRoles = entry.assignments.map((assignment) => assignment.role).sort();
    if (expectedRoles && !sameValues(expectedRoles.slice().sort(), actualRoles)) violations++;

    const blockPrimary = entry.assignments.filter(
      (assignment) => assignment.role === 'block-primary',
    );
    const blockAssist = entry.assignments.filter(
      (assignment) => assignment.role === 'block-assist',
    );
    if (entry.phase === 'block-defense') {
      if (!entry.block || blockPrimary.length !== 1) violations++;
      if (entry.block) {
        if (blockPrimary[0]?.athleteId !== entry.block.primaryAthleteId) violations++;
        if (entry.block.assistAthleteId === null) {
          if (blockAssist.length !== 0) violations++;
        } else if (
          blockAssist.length !== 1 ||
          blockAssist[0].athleteId !== entry.block.assistAthleteId
        ) {
          violations++;
        }
        const expectedDefenseRoles: TacticalRole[] =
          entry.block.assistAthleteId === null
            ? [
                'block-primary',
                'cover-short-left',
                'cover-short-right',
                'defend-cross',
                'defend-line',
                'defend-seam',
              ]
            : [
                'block-assist',
                'block-primary',
                'cover-short-left',
                'defend-cross',
                'defend-line',
                'defend-seam',
              ];
        if (!sameValues(expectedDefenseRoles.sort(), actualRoles)) violations++;
      }
    } else if (entry.block || blockPrimary.length > 0 || blockAssist.length > 0) {
      violations++;
    }

    for (const assignment of entry.assignments) {
      const [worldX, worldZ] = assignment.targetMm;
      if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
        violations++;
        continue;
      }
      const localX = entry.side === TeamSide.HOME ? worldX : -worldX;
      const localZ = entry.side === TeamSide.HOME ? worldZ : -worldZ;
      if (
        entry.phase !== 'hold' &&
        Math.abs(localZ) > (COURT.halfWidth - TEAM_TACTICS.courtMargin) * 1_000 + 1
      ) {
        violations++;
      }
      if (
        entry.phase !== 'hold' &&
        assignment.role !== 'server' &&
        (localX < (-COURT.halfLength + TEAM_TACTICS.courtMargin) * 1_000 - 1 ||
          localX > -TEAM_TACTICS.netMargin * 1_000 + 1)
      ) {
        violations++;
      }
    }
    if (entry.phase !== 'hold') {
      for (let first = 0; first < entry.assignments.length; first++) {
        for (let second = first + 1; second < entry.assignments.length; second++) {
          const a = entry.assignments[first].targetMm;
          const b = entry.assignments[second].targetMm;
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < TEAM_TACTICS.targetSeparation * 1_000 - 1) {
            violations++;
          }
        }
      }
    }
    for (const sample of entry.execution) {
      if (
        ![
          ...sample.startPositionMm,
          ...sample.endPositionMm,
          sample.minTargetDistanceMm,
          sample.pathLengthMm,
          sample.airborneTicks,
          sample.maxSpeedMmPerSecond,
        ].every(Number.isFinite)
      ) {
        violations++;
      }
    }
    return violations;
  }
}
