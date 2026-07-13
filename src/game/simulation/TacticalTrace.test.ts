import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import type {
  AthleteTacticalSnapshot,
  TacticalRole,
  TeamPlan,
  TeamTacticsPhase,
} from '../team/TeamTactics';
import { TacticalTraceCollector } from './TacticalTrace';

function plan(side: TeamSide, revision: number, phase: TeamTacticsPhase = 'reception'): TeamPlan {
  const roles: TacticalRole[] = [
    'active',
    'setter',
    'receive-left',
    'receive-center',
    'receive-right',
    'cover-deep',
  ];
  return {
    side,
    revision,
    planId: revision,
    phase,
    assignments: roles.map((role, athleteId) => ({
      athleteId,
      role,
      target: {
        x: side === TeamSide.HOME ? -1 - athleteId : 1 + athleteId,
        z: side === TeamSide.HOME ? -3.75 + athleteId * 1.5 : 3.75 - athleteId * 1.5,
      },
    })),
    block: null,
  };
}

function athletes(
  side: TeamSide,
  source: TeamPlan,
  offset = 0,
  airborne: readonly number[] = [],
): AthleteTacticalSnapshot[] {
  return source.assignments.map((assignment, slot) => ({
    athleteId: assignment.athleteId,
    slot,
    row: slot <= 2 ? 'back' : 'front',
    position: { x: assignment.target.x + offset, z: assignment.target.z },
    velocity: { x: offset === 0 ? 0 : -1, z: 0 },
    base: {
      x: side === TeamSide.HOME ? -6 + slot * 0.7 : 6 - slot * 0.7,
      z: side === TeamSide.HOME ? -3.75 + slot * 1.5 : 3.75 - slot * 1.5,
    },
    airborne: airborne.includes(assignment.athleteId),
  }));
}

describe('TacticalTraceCollector', () => {
  it('registra somente mudanças de plano e copia DTOs primitivos congelados', () => {
    const collector = new TacticalTraceCollector();
    const source = plan(TeamSide.HOME, 1);
    collector.record(10, 0, TeamSide.HOME, source, athletes(TeamSide.HOME, source, 0.4));
    collector.record(11, 0, TeamSide.HOME, source, athletes(TeamSide.HOME, source));

    const entries = collector.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      rally: 0,
      startTick: 10,
      endTick: 11,
      side: TeamSide.HOME,
      revision: 1,
    });
    expect(entries[0].assignments[0].targetMm).toEqual([-1_000, -3_750]);
    expect(entries[0].execution[0]).toMatchObject({
      startPositionMm: [-600, -3_750],
      endPositionMm: [-1_000, -3_750],
      minTargetDistanceMm: 0,
      pathLengthMm: 400,
    });
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(Object.isFrozen(entries[0].assignments)).toBe(true);
  });

  it('serializa e resume engajamento, fases e bloqueios sem referências do runtime', () => {
    const collector = new TacticalTraceCollector();
    const reception = plan(TeamSide.HOME, 1);
    collector.record(1, 0, TeamSide.HOME, reception, athletes(TeamSide.HOME, reception, 0.3));
    collector.record(2, 0, TeamSide.HOME, reception, athletes(TeamSide.HOME, reception));
    const defense = {
      ...plan(TeamSide.AWAY, 2, 'block-defense'),
      assignments: plan(TeamSide.AWAY, 2).assignments.map((assignment, index) => ({
        ...assignment,
        role: (
          [
            'block-primary',
            'block-assist',
            'defend-line',
            'defend-cross',
            'defend-seam',
            'cover-short-left',
          ] as const
        )[index],
      })),
      block: { primaryAthleteId: 0, assistAthleteId: 1, crossZ: 0.5, contactIn: 0 },
    } satisfies TeamPlan;
    collector.record(3, 0, TeamSide.AWAY, defense, athletes(TeamSide.AWAY, defense, 0.3));
    collector.recordBlockContact(4, TeamSide.AWAY);
    collector.record(4, 0, TeamSide.AWAY, defense, athletes(TeamSide.AWAY, defense, 0, [0, 1]));

    const entries = collector.entries;
    const metrics = collector.metrics(entries);
    expect(JSON.parse(collector.serialize(entries)).schema).toBe('pro-volei-tactical-trace-v1');
    expect(collector.hash(entries)).toMatch(/^[0-9a-f]{8}$/);
    expect(metrics.violations).toBe(0);
    expect(metrics.phaseVisits.reception).toBe(1);
    expect(metrics.phaseVisits['block-defense']).toBe(1);
    expect(metrics.engagedAthletes).toEqual([6, 6]);
    expect(metrics.doubleBlocks).toBe(1);
    expect(metrics.executedDoubleBlocks).toBe(1);
    expect(entries[1].block?.mechanicalContactTick).toBe(4);
    expect(metrics.arrivedAssignments).toBe(metrics.observedAssignments);
  });

  it('mede violações independentemente das promessas do planner', () => {
    const collector = new TacticalTraceCollector();
    const valid = plan(TeamSide.HOME, 1);
    const invalid: TeamPlan = {
      ...valid,
      assignments: valid.assignments.map((assignment, index) =>
        index === 1
          ? {
              ...assignment,
              athleteId: 0,
              target: valid.assignments[0].target,
            }
          : assignment,
      ),
    };
    collector.record(1, 0, TeamSide.HOME, invalid, athletes(TeamSide.HOME, valid));

    expect(collector.metrics(collector.entries).violations).toBeGreaterThanOrEqual(2);
  });

  it('aceita hold na posição física atual mesmo fora da formação-base', () => {
    const collector = new TacticalTraceCollector();
    const valid = plan(TeamSide.HOME, 1, 'hold');
    const hold: TeamPlan = {
      ...valid,
      assignments: valid.assignments.map((assignment, index) => ({
        ...assignment,
        role: 'base',
        target: index === 0 ? { x: 0.2, z: 5 } : assignment.target,
      })),
    };
    collector.record(1, 0, TeamSide.HOME, hold, athletes(TeamSide.HOME, hold));

    expect(collector.metrics().violations).toBe(0);
  });

  it('detecta roster arbitrário e vínculos inválidos de bloqueio', () => {
    const collector = new TacticalTraceCollector();
    const source = plan(TeamSide.HOME, 1);
    const invalid: TeamPlan = {
      ...source,
      phase: 'block-defense',
      assignments: source.assignments.map((assignment, index) => ({
        ...assignment,
        athleteId: index + 10,
        role: index === 0 ? 'block-primary' : assignment.role,
      })),
      block: { primaryAthleteId: 99, assistAthleteId: 98, crossZ: 0, contactIn: 0.2 },
    };
    collector.record(1, 3, TeamSide.HOME, invalid, athletes(TeamSide.HOME, source));

    expect(collector.metrics().violations).toBeGreaterThanOrEqual(3);
  });
});
