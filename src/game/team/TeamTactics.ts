import type { TeamSide, TouchKind } from '../../core/constants';

export interface TacticalPoint {
  readonly x: number;
  readonly z: number;
}

export type TacticalRow = 'front' | 'back';

export interface AthleteTacticalSnapshot {
  readonly athleteId: number;
  readonly slot: number;
  readonly row: TacticalRow;
  readonly position: TacticalPoint;
  readonly velocity: TacticalPoint;
  readonly base: TacticalPoint;
  readonly airborne: boolean;
}

export type TeamTacticsPhase =
  | 'base'
  | 'serve-formation'
  | 'reception'
  | 'offense-transition'
  | 'attack-coverage'
  | 'defense-read'
  | 'block-defense'
  | 'hold'
  | 'recompose';

export type TacticalRole =
  | 'active'
  | 'server'
  | 'setter'
  | 'attacker'
  | 'receive-left'
  | 'receive-center'
  | 'receive-right'
  | 'cover-short-left'
  | 'cover-short-right'
  | 'cover-deep'
  | 'defend-line'
  | 'defend-cross'
  | 'defend-seam'
  | 'block-primary'
  | 'block-assist'
  | 'base';

export interface TeamBrainFrame {
  readonly side: TeamSide;
  readonly revision: number;
  readonly planId: number | null;
  readonly phase: TeamTacticsPhase;
  readonly athletes: readonly AthleteTacticalSnapshot[];
  readonly activeAthleteId: number | null;
  readonly contactPoint: TacticalPoint | null;
  readonly setterAthleteId: number | null;
  readonly serverAthleteId?: number | null;
  readonly serverPoint?: TacticalPoint | null;
  readonly nextTouchKind?: TouchKind | null;
}

export interface TacticalAssignment {
  readonly athleteId: number;
  readonly role: TacticalRole;
  readonly target: TacticalPoint;
}

export interface BlockPlan {
  readonly primaryAthleteId: number;
  readonly assistAthleteId: number | null;
  readonly crossZ: number;
  readonly contactIn: number;
}

export interface TeamPlan {
  readonly side: TeamSide;
  readonly revision: number;
  readonly planId: number | null;
  readonly phase: TeamTacticsPhase;
  readonly assignments: readonly TacticalAssignment[];
  readonly block: BlockPlan | null;
}
