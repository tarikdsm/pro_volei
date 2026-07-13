import { describe, it, expect } from 'vitest';
import { AiController } from './AiController';
import { RallyState, TouchPlan } from '../RallyState';
import type { MechanicsCtx } from '../mechanics/context';
import type { Athlete } from '../Team';
import { RandomHub } from '../../core/random';
import { TeamSide } from '../../core/constants';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';

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

describe('AiController — consumo determinístico na defesa', () => {
  function qualityCtx(contactValues: readonly number[]): {
    ctx: MechanicsCtx;
    contact: SequenceRandom;
  } {
    const hub = new RandomHub(1);
    const contact = SequenceRandom.fromFloats(contactValues);
    const ctx = {
      diff: { digChance: 0.5, passQuality: [0.4, 0.8] },
      random: {
        rules: hub.stream('rules'),
        ai: hub.stream('ai'),
        contact,
        control: hub.stream('control'),
      },
    } as unknown as MechanicsCtx;
    return { ctx, contact };
  }

  it('defesa simples consome somente o sorteio de qualidade', () => {
    const ai = new AiController();
    const { ctx, contact } = qualityCtx([0.5]);

    expect(ai.reachQuality(ctx, false)).toBeCloseTo(0.6);
    expect(contact.draws).toBe(1);
  });

  it('falha dura consome chance de defesa e decisão de toque impossível', () => {
    const ai = new AiController();
    const { ctx, contact } = qualityCtx([0.9, 0.9]);

    expect(ai.reachQuality(ctx, true)).toBe(-1);
    expect(contact.draws).toBe(2);
  });

  it('raspada defensiva consome o range apenas quando selecionada', () => {
    const ai = new AiController();
    const { ctx, contact } = qualityCtx([0.9, 0.1, 0.5]);

    expect(ai.reachQuality(ctx, true)).toBeCloseTo(0.075);
    expect(contact.draws).toBe(3);
  });
});

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

describe('AiController.scheduleApproach — ownership do plano', () => {
  function approachFixture() {
    const callbacks: Array<() => void> = [];
    const moves: Array<[number, number]> = [];
    const athlete = {
      moveTo: (x: number, z: number) => moves.push([x, z]),
    } as unknown as Athlete;
    const rally = new RallyState();
    const ctx = {
      rally,
      diff: { reactionDelay: 0.2 },
      after: (_seconds: number, callback: () => void) => callbacks.push(callback),
    } as unknown as MechanicsCtx;
    const plan = {
      planId: 70,
      athlete,
      side: TeamSide.AWAY,
      kind: 'pass',
      point: { x: 4, z: 1 },
      contactIn: 1,
      tacticalRevision: 1,
    } as unknown as TouchPlan;
    return { callbacks, moves, athlete, rally, ctx, plan };
  }

  it('executa a aproximação enquanto plano e atleta ainda são atuais', () => {
    const fixture = approachFixture();
    fixture.rally.plan = fixture.plan;
    new AiController().scheduleApproach(fixture.ctx, fixture.plan);

    fixture.callbacks[0]();

    expect(fixture.moves).toEqual([[4, 1]]);
  });

  it('ignora callback atrasado depois que o plano foi substituído', () => {
    const fixture = approachFixture();
    fixture.rally.plan = fixture.plan;
    new AiController().scheduleApproach(fixture.ctx, fixture.plan);
    fixture.rally.plan = { ...fixture.plan, planId: 71 } as TouchPlan;

    fixture.callbacks[0]();

    expect(fixture.moves).toEqual([]);
  });

  it('ignora callback atrasado quando a revisão tática avança no mesmo plano', () => {
    const fixture = approachFixture();
    fixture.rally.plan = fixture.plan;
    new AiController().scheduleApproach(fixture.ctx, fixture.plan);
    fixture.plan.tacticalRevision = 2;

    fixture.callbacks[0]();

    expect(fixture.moves).toEqual([]);
  });
});
