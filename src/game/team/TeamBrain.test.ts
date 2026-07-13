import { describe, expect, it } from 'vitest';
import { BASE_SLOTS, COURT, TEAM_TACTICS, TeamSide } from '../../core/constants';
import { rotateSlots } from '../rules/rotation';
import { TeamBrain } from './TeamBrain';
import { fromLocalCourt, toLocalCourt } from './CourtFrame';
import type { AthleteTacticalSnapshot, TeamBrainFrame, TeamPlan } from './TeamTactics';

function snapshots(side: TeamSide, slots: readonly number[]): AthleteTacticalSnapshot[] {
  return slots.map((athleteId, slot) => {
    const base = fromLocalCourt(BASE_SLOTS[slot], side);
    return {
      athleteId,
      slot,
      row: slot <= 2 ? 'back' : 'front',
      position: base,
      velocity: { x: 0, z: 0 },
      base,
      airborne: false,
    };
  });
}

function frame(
  side: TeamSide,
  slots: readonly number[],
  overrides: Partial<TeamBrainFrame> = {},
): TeamBrainFrame {
  return {
    side,
    revision: 1,
    planId: null,
    phase: 'base',
    athletes: snapshots(side, slots),
    activeAthleteId: null,
    contactPoint: null,
    setterAthleteId: null,
    ...overrides,
  };
}

function expectValid(plan: TeamPlan, side: TeamSide): void {
  expect(plan.assignments).toHaveLength(6);
  expect(new Set(plan.assignments.map((assignment) => assignment.athleteId)).size).toBe(6);
  for (const assignment of plan.assignments) {
    expect(Number.isFinite(assignment.target.x)).toBe(true);
    expect(Number.isFinite(assignment.target.z)).toBe(true);
    const local = toLocalCourt(assignment.target, side);
    expect(local.x).toBeGreaterThanOrEqual(-COURT.halfLength + TEAM_TACTICS.courtMargin);
    expect(local.x).toBeLessThanOrEqual(-TEAM_TACTICS.netMargin);
    expect(Math.abs(local.z)).toBeLessThanOrEqual(COURT.halfWidth - TEAM_TACTICS.courtMargin);
  }
}

describe('TeamBrain', () => {
  it('recompõe cada uma das seis rotações na base do slot atual', () => {
    let slots = [0, 1, 2, 3, 4, 5];
    const brain = new TeamBrain();
    for (let rotation = 0; rotation < 6; rotation++) {
      const plan = brain.plan(frame(TeamSide.HOME, slots, { revision: rotation + 1 }));
      expectValid(plan, TeamSide.HOME);
      for (const assignment of plan.assignments) {
        const athlete = snapshots(TeamSide.HOME, slots).find(
          (candidate) => candidate.athleteId === assignment.athleteId,
        );
        expect(assignment.role).toBe('base');
        expect(assignment.target).toEqual(athlete?.base);
      }
      slots = rotateSlots(slots);
    }
  });

  it.each(['base', 'recompose'] as const)('espelha %s exatamente entre HOME e AWAY', (phase) => {
    const slots = [3, 4, 5, 0, 1, 2];
    const home = new TeamBrain().plan(frame(TeamSide.HOME, slots, { phase }));
    const away = new TeamBrain().plan(frame(TeamSide.AWAY, slots, { phase }));

    expect(away.assignments).toEqual(
      home.assignments.map((assignment) => ({
        ...assignment,
        target: { x: -assignment.target.x, z: -assignment.target.z },
      })),
    );
  });

  it('identifica a sacadora fora da linha de fundo sem mover as outras da base', () => {
    const plan = new TeamBrain().plan(
      frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
        phase: 'serve-formation',
        planId: -1,
        serverAthleteId: 0,
        serverPoint: { x: -9.7, z: 3.2 },
      }),
    );

    expect(plan.assignments.find((assignment) => assignment.role === 'server')).toEqual({
      athleteId: 0,
      role: 'server',
      target: { x: -9.7, z: 3.2 },
    });
    expect(plan.assignments.filter((assignment) => assignment.role === 'base')).toHaveLength(5);
  });

  it('forma recepção com ativa reservada, setter liberada e três corredores', () => {
    const slots = [0, 1, 2, 3, 4, 5];
    const plan = new TeamBrain().plan(
      frame(TeamSide.HOME, slots, {
        phase: 'reception',
        planId: 7,
        activeAthleteId: 1,
        contactPoint: { x: -6.1, z: 1.4 },
      }),
    );

    expectValid(plan, TeamSide.HOME);
    expect(plan.planId).toBe(7);
    expect(plan.assignments.filter((assignment) => assignment.role === 'active')).toHaveLength(1);
    expect(plan.assignments.find((assignment) => assignment.role === 'active')).toMatchObject({
      athleteId: 1,
      target: { x: -6.1, z: 1.4 },
    });
    expect(plan.assignments.filter((assignment) => assignment.role === 'setter')).toHaveLength(1);
    expect(
      plan.assignments.filter((assignment) => assignment.role.startsWith('receive-')),
    ).toHaveLength(3);
    expect(plan.assignments.filter((assignment) => assignment.role === 'cover-deep')).toHaveLength(
      1,
    );
  });

  it('organiza transição ofensiva com três opções de ataque e duas coberturas', () => {
    const plan = new TeamBrain().plan(
      frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
        phase: 'offense-transition',
        planId: 30,
        activeAthleteId: 1,
        contactPoint: { x: -1.1, z: 0.8 },
        setterAthleteId: 1,
      }),
    );

    expectValid(plan, TeamSide.HOME);
    expect(plan.assignments.find((assignment) => assignment.role === 'active')?.athleteId).toBe(1);
    expect(
      plan.assignments.filter((assignment) => assignment.role.startsWith('attack-')),
    ).toHaveLength(3);
    expect(
      plan.assignments.filter((assignment) => assignment.role.startsWith('cover-short-')),
    ).toHaveLength(2);
  });

  it('forma cobertura de ataque espelhada ao redor da atacante e da levantadora', () => {
    const homeFrame = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
      phase: 'attack-coverage',
      planId: 31,
      activeAthleteId: 4,
      contactPoint: { x: -1, z: 2.6 },
      setterAthleteId: 1,
    });
    const awayFrame = frame(TeamSide.AWAY, [0, 1, 2, 3, 4, 5], {
      phase: 'attack-coverage',
      planId: 31,
      activeAthleteId: 4,
      contactPoint: { x: 1, z: -2.6 },
      setterAthleteId: 1,
    });
    const home = new TeamBrain().plan(homeFrame);
    const away = new TeamBrain().plan(awayFrame);

    expectValid(home, TeamSide.HOME);
    expect(home.assignments.find((assignment) => assignment.role === 'active')?.athleteId).toBe(4);
    expect(home.assignments.find((assignment) => assignment.role === 'setter')?.athleteId).toBe(1);
    expect(
      home.assignments.filter((assignment) => assignment.role.startsWith('cover-short-')),
    ).toHaveLength(2);
    expect(home.assignments.filter((assignment) => assignment.role === 'cover-deep')).toHaveLength(
      1,
    );
    expect(away.assignments).toEqual(
      home.assignments.map((assignment) => ({
        ...assignment,
        target: { x: -assignment.target.x, z: -assignment.target.z },
      })),
    );
  });

  it('forma defesa por corredores com bloqueio duplo apenas quando a assistente chega', () => {
    const brain = new TeamBrain();
    const double = brain.plan(
      frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
        phase: 'block-defense',
        planId: 40,
        contactPoint: { x: -0.72, z: 0.4 },
        contactIn: 1,
      }),
    );
    const single = brain.plan(
      frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
        phase: 'block-defense',
        planId: 41,
        contactPoint: { x: -0.72, z: 0.4 },
        contactIn: 0,
      }),
    );

    expectValid(double, TeamSide.HOME);
    expect(double.block).toMatchObject({ primaryAthleteId: 4, assistAthleteId: 5 });
    expect(
      double.assignments.filter((assignment) => assignment.role === 'block-primary'),
    ).toHaveLength(1);
    expect(
      double.assignments.filter((assignment) => assignment.role === 'block-assist'),
    ).toHaveLength(1);
    expect(
      double.assignments.filter((assignment) => assignment.role === 'defend-line'),
    ).toHaveLength(1);
    expect(
      double.assignments.filter((assignment) => assignment.role === 'defend-cross'),
    ).toHaveLength(1);
    expect(
      double.assignments.filter((assignment) => assignment.role === 'defend-seam'),
    ).toHaveLength(1);
    expect(single.block).toMatchObject({ primaryAthleteId: 4, assistAthleteId: null });
  });

  it('usa ETA cinemático para a primária e exige adjacência da assistente', () => {
    const base = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
      phase: 'block-defense',
      planId: 43,
      activeAthleteId: null,
      contactPoint: { x: -0.72, z: 0 },
      contactIn: 0.2,
    });
    const athletes = base.athletes.map((athlete) => {
      if (athlete.athleteId === 3) return { ...athlete, position: { x: -8, z: 0 } };
      if (athlete.athleteId === 4) return { ...athlete, position: { x: -0.72, z: 0.9 } };
      if (athlete.athleteId === 5) return { ...athlete, position: { x: -8, z: 3 } };
      return athlete;
    });
    const etaPlan = new TeamBrain().plan({ ...base, athletes });
    expect(etaPlan.block?.primaryAthleteId).toBe(4);

    const humanPrimary = new TeamBrain().plan({
      ...base,
      activeAthleteId: 3,
      athletes: athletes.map((athlete) => {
        if (athlete.athleteId === 4) return { ...athlete, position: { x: -8, z: 0 } };
        if (athlete.athleteId === 5) return { ...athlete, position: { x: -0.72, z: 0.72 } };
        return athlete;
      }),
    });
    expect(humanPrimary.block).toMatchObject({ primaryAthleteId: 3, assistAthleteId: null });
  });

  it('mantém gap real da dupla no corredor lateral e rejeita assistente airborne', () => {
    const edge = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
      phase: 'block-defense',
      planId: 44,
      activeAthleteId: 5,
      contactPoint: { x: -0.72, z: 4.1 },
      contactIn: 1.5,
    });
    const plan = new TeamBrain().plan(edge);
    const primary = plan.assignments.find((assignment) => assignment.role === 'block-primary')!;
    const assist = plan.assignments.find((assignment) => assignment.role === 'block-assist')!;
    expect(
      Math.hypot(primary.target.x - assist.target.x, primary.target.z - assist.target.z),
    ).toBeGreaterThanOrEqual(TEAM_TACTICS.targetSeparation);

    const airborne = new TeamBrain().plan({
      ...edge,
      athletes: edge.athletes.map((athlete) =>
        athlete.athleteId === plan.block?.assistAthleteId
          ? { ...athlete, airborne: true }
          : athlete,
      ),
    });
    expect(airborne.block?.assistAthleteId).not.toBe(plan.block?.assistAthleteId);
  });

  it('aceita a primária humana e espelha o plano de bloqueio', () => {
    const homeFrame = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
      phase: 'block-defense',
      planId: 42,
      activeAthleteId: 5,
      contactPoint: { x: -0.72, z: 2.2 },
      contactIn: 0.8,
    });
    const awayFrame = frame(TeamSide.AWAY, [0, 1, 2, 3, 4, 5], {
      phase: 'block-defense',
      planId: 42,
      activeAthleteId: 5,
      contactPoint: { x: 0.72, z: -2.2 },
      contactIn: 0.8,
    });
    const home = new TeamBrain().plan(homeFrame);
    const away = new TeamBrain().plan(awayFrame);

    expect(home.block?.primaryAthleteId).toBe(5);
    expect(away.block).toEqual({ ...home.block, crossZ: -home.block!.crossZ });
    expect(away.assignments).toEqual(
      home.assignments.map((assignment) => ({
        ...assignment,
        target: { x: -assignment.target.x, z: -assignment.target.z },
      })),
    );
  });

  it('mantém recepção simétrica, separada e determinística em empate', () => {
    const slots = [0, 1, 2, 3, 4, 5];
    const homeFrame = frame(TeamSide.HOME, slots, {
      phase: 'reception',
      planId: 8,
      activeAthleteId: 4,
      contactPoint: { x: -5.3, z: 0.4 },
    });
    const awayFrame = frame(TeamSide.AWAY, slots, {
      phase: 'reception',
      planId: 8,
      activeAthleteId: 4,
      contactPoint: { x: 5.3, z: -0.4 },
    });
    const first = new TeamBrain().plan(homeFrame);
    const replay = new TeamBrain().plan(homeFrame);
    const away = new TeamBrain().plan(awayFrame);

    expect(first).toEqual(replay);
    expect(away.assignments).toEqual(
      first.assignments.map((assignment) => ({
        ...assignment,
        target: { x: -assignment.target.x, z: -assignment.target.z },
      })),
    );
    for (let i = 0; i < first.assignments.length; i++) {
      for (let j = i + 1; j < first.assignments.length; j++) {
        const a = first.assignments[i].target;
        const b = first.assignments[j].target;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
          TEAM_TACTICS.targetSeparation,
        );
      }
    }
  });

  it('desempata escolhas equivalentes pelo menor ID de atleta', () => {
    const tied = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5], {
      phase: 'reception',
      planId: 9,
      activeAthleteId: 5,
      contactPoint: { x: -5, z: 1.2 },
    });
    const athletes = tied.athletes.map((athlete) => ({
      ...athlete,
      position: { x: -4.5, z: 0 },
    }));
    const plan = new TeamBrain().plan({ ...tied, athletes });

    expect(plan.assignments.find((assignment) => assignment.role === 'setter')?.athleteId).toBe(0);
    expect(
      plan.assignments
        .filter((assignment) => assignment.role.startsWith('receive-'))
        .map((assignment) => assignment.athleteId),
    ).toEqual([1, 2, 3]);
  });

  it('rejeita frames incompletos e IDs duplicados', () => {
    const brain = new TeamBrain();
    const incomplete = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5]);
    expect(() => brain.plan({ ...incomplete, athletes: incomplete.athletes.slice(0, 5) })).toThrow(
      /seis atletas/i,
    );
    expect(() =>
      brain.plan({
        ...incomplete,
        athletes: incomplete.athletes.map((athlete, index) => ({
          ...athlete,
          athleteId: index === 5 ? 0 : athlete.athleteId,
        })),
      }),
    ).toThrow(/IDs únicos/i);
  });

  it('rejeita fase não implementada, metadados e geometria inválidos', () => {
    const valid = frame(TeamSide.HOME, [0, 1, 2, 3, 4, 5]);
    expect(() => new TeamBrain().plan({ ...valid, phase: 'defense-read' })).toThrow(
      /não implementada/i,
    );
    expect(() => new TeamBrain().plan({ ...valid, phase: 'serve-formation' })).toThrow(/exige/i);
    expect(() => new TeamBrain().plan({ ...valid, revision: Number.NaN })).toThrow(/revisão/i);
    expect(() => new TeamBrain().plan({ ...valid, planId: 0 })).toThrow(/planId/i);
    expect(() => new TeamBrain().plan({ ...valid, planId: -1 })).not.toThrow();
    expect(() =>
      new TeamBrain().plan({
        ...valid,
        athletes: valid.athletes.map((athlete, index) => ({
          ...athlete,
          slot: index === 5 ? 0 : athlete.slot,
        })),
      }),
    ).toThrow(/slots únicos/i);
    expect(() =>
      new TeamBrain().plan({
        ...valid,
        athletes: valid.athletes.map((athlete, index) =>
          index === 0 ? { ...athlete, base: { x: -9.5, z: 0 } } : athlete,
        ),
      }),
    ).toThrow(/fora da meia quadra/i);
  });
});
