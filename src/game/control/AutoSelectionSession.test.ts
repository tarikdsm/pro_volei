import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TeamSide } from '../../core/constants';
import type { Athlete } from '../Team';
import {
  AutoSelectionSession,
  type AutoControlAssignment,
  type SelectionRoster,
} from './AutoSelectionSession';

function athlete(index: number, x: number, z: number, airborne = false): Athlete {
  return {
    index,
    side: TeamSide.HOME,
    pos: new THREE.Vector3(x, 0, z),
    target: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    speedMul: 1,
    isAirborne: airborne,
    moveTo: vi.fn(function (this: { target: THREE.Vector3 }, nx: number, nz: number) {
      this.target.set(nx, 0, nz);
    }),
  } as unknown as Athlete;
}

function roster(players: Athlete[], frontIds: number[] = [3, 4, 5]): SelectionRoster {
  return {
    athletes: players,
    frontRow: () => players.filter((player) => frontIds.includes(player.index)),
    slotIndexOf: (player) => player.index,
    basePositionOf: (player) => ({ x: -6 + Math.floor(player.index / 3) * 4, z: player.index }),
  };
}

function assignment(
  players: Athlete[],
  overrides: Partial<AutoControlAssignment> = {},
): AutoControlAssignment {
  return {
    planId: 1,
    kind: 'receive',
    side: TeamSide.HOME,
    contactPoint: { x: -4, z: 0 },
    contactIn: 1,
    roster: roster(players),
    excluded: null,
    ...overrides,
  };
}

describe('AutoSelectionSession', () => {
  it('seleciona a melhor interceptação legal e exclui o último toque', () => {
    const closeButExcluded = athlete(0, -4, 0);
    const selected = athlete(1, -5, 0);
    const session = new AutoSelectionSession();

    const result = session.begin(
      assignment([closeButExcluded, selected], { excluded: closeButExcluded }),
    );

    expect(result.selected).toBe(selected);
    expect(result.changed).toBe(true);
    expect(result.decision.switches).toBe(0);
  });

  it('prefere fundo quando ETA empata por custo tático de recepção', () => {
    const back = athlete(1, -5, 0);
    const front = athlete(4, -5, 0);
    const session = new AutoSelectionSession();

    const result = session.begin(assignment([front, back]));

    expect(result.selected).toBe(back);
  });

  it('numa troca para a candidata claramente melhor, para o alvo da anterior', () => {
    const first = athlete(0, -6, 0);
    const challenger = athlete(1, -10, 0);
    const players = [first, challenger];
    const session = new AutoSelectionSession();
    session.begin(assignment(players));
    challenger.pos.set(-4, 0, 0);

    const result = session.update(assignment(players));

    expect(result.previous).toBe(first);
    expect(result.selected).toBe(challenger);
    expect(result.changed).toBe(true);
    expect(first.moveTo).toHaveBeenCalledWith(first.pos.x, first.pos.z);
  });

  it('no bloqueio considera somente atletas da linha de frente', () => {
    const backClosest = athlete(0, -0.72, 0);
    const front = athlete(3, -1.5, 0);
    const players = [backClosest, front];
    const session = new AutoSelectionSession();

    const result = session.begin(
      assignment(players, {
        kind: 'block',
        roster: roster(players, [3]),
        contactPoint: { x: -0.72, z: 0 },
      }),
    );

    expect(result.selected).toBe(front);
  });

  it('atleta aérea é ilegal para nova recepção', () => {
    const airborne = athlete(0, -4, 0, true);
    const grounded = athlete(1, -5, 0);
    const session = new AutoSelectionSession();

    const result = session.begin(assignment([airborne, grounded]));

    expect(result.selected).toBe(grounded);
  });
});
