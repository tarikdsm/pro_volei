import { describe, it, expect } from 'vitest';
import { AiController } from './AiController';
import { RallyState, TouchPlan } from '../RallyState';
import type { MechanicsCtx } from '../mechanics/context';
import type { Athlete } from '../Team';

// Stub mínimo de Athlete: só conta as chamadas de act/jump que a IA dispara.
function makeBlockerStub(): { athlete: Athlete; calls: { act: number; jump: number } } {
  const calls = { act: 0, jump: 0 };
  const athlete = {
    act: () => {
      calls.act++;
    },
    jump: () => {
      calls.jump++;
    },
  } as unknown as Athlete;
  return { athlete, calls };
}

// ctx mínimo: updateScheduledJumps só lê rally.plan e rally.blockers.
function makeCtx(rally: RallyState): MechanicsCtx {
  return { rally } as unknown as MechanicsCtx;
}

// plan sem pulo agendado do atacante: mantém o foco do teste nos bloqueadores.
function planSemPulo(): TouchPlan {
  return { jumpScheduledIn: undefined } as unknown as TouchPlan;
}

describe('AiController.updateScheduledJumps — lifecycle do bloqueador agendado', () => {
  it('pula uma vez quando o tempo chega, sem remover a entrada da lista', () => {
    const ai = new AiController();
    const rally = new RallyState();
    rally.plan = planSemPulo();
    const { athlete, calls } = makeBlockerStub();
    rally.blockers = [{ athlete, jumpIn: 0.05, jumped: false }];

    ai.updateScheduledJumps(0.06, makeCtx(rally));

    expect(calls.jump).toBe(1);
    expect(rally.blockers).toHaveLength(1); // permanece elegível (sem splice)
    expect(rally.blockers[0].jumped).toBe(true);
  });

  it('não re-dispara o pulo em chamadas seguintes (idempotente após pular)', () => {
    const ai = new AiController();
    const rally = new RallyState();
    rally.plan = planSemPulo();
    const { athlete, calls } = makeBlockerStub();
    rally.blockers = [{ athlete, jumpIn: 0.05, jumped: false }];

    ai.updateScheduledJumps(0.06, makeCtx(rally));
    ai.updateScheduledJumps(0.06, makeCtx(rally));

    expect(calls.jump).toBe(1); // não pulou de novo
    expect(rally.blockers).toHaveLength(1);
  });

  it('não pula enquanto o tempo agendado não chega (só decrementa)', () => {
    const ai = new AiController();
    const rally = new RallyState();
    rally.plan = planSemPulo();
    const { athlete, calls } = makeBlockerStub();
    rally.blockers = [{ athlete, jumpIn: 0.5, jumped: false }];

    ai.updateScheduledJumps(0.1, makeCtx(rally));

    expect(calls.jump).toBe(0);
    expect(rally.blockers[0].jumped).toBe(false);
    expect(rally.blockers[0].jumpIn).toBeCloseTo(0.4);
  });
});
