import type { AttackExecution } from './StrategicAttackTypes';
import type { SetExecution } from './StrategicOffenseSystem';

/** Envelope imutável entregue à mecânica somente depois que o contato CPU foi confirmado. */
export type CpuTouchExecution =
  | Readonly<{
      kind: 'set';
      execution: SetExecution;
      attackerAthleteId: number | null;
    }>
  | Readonly<{
      kind: 'spike';
      execution: AttackExecution;
    }>;
