import { describe, expect, it } from 'vitest';
import type { ActionEdge, InputCancellation, InputCancelReason } from '../../core/input/InputFrame';
import { ACTION_BUTTON } from '../../core/constants';
import { ActionButtonMachine, type ActionButtonTick } from './ActionButtonMachine';

let sequence = 0;

function edge(
  kind: ActionEdge['kind'],
  atMs = 0,
  source: ActionEdge['source'] = 'keyboard',
): ActionEdge {
  return { kind, source, atMs, sequence: sequence++ };
}

function cancellation(reason: InputCancelReason, atMs = 0): InputCancellation {
  return { reason, atMs, sequence: sequence++ };
}

function tick(simulationTick: number, overrides: Partial<ActionButtonTick> = {}): ActionButtonTick {
  return {
    simulationTick,
    token: 7,
    context: 'attack',
    legal: true,
    compatibleContact: false,
    lockedIllegal: false,
    actionDown: false,
    direction: { x: 0, z: 0 },
    actionEdges: [],
    cancellations: [],
    ...overrides,
  };
}

function pressAt(machine: ActionButtonMachine, simulationTick: number, legal = true): void {
  machine.step(
    tick(simulationTick, {
      legal,
      actionDown: true,
      actionEdges: [edge('press', simulationTick)],
    }),
  );
}

describe('ActionButtonMachine — tap, hold e carga', () => {
  it('classifica release no tick 11 como tap e no tick 12 como hold', () => {
    const tap = new ActionButtonMachine();
    pressAt(tap, 20);
    const tapEvent = tap.step(
      tick(31, { actionEdges: [edge('release', 31)], direction: { x: 0.4, z: -0.2 } }),
    );

    const hold = new ActionButtonMachine();
    pressAt(hold, 40);
    const holdEvent = hold.step(tick(52, { actionEdges: [edge('release', 52)] }));

    expect(tapEvent).toMatchObject({
      gesture: 'tap',
      charge: 0,
      pressedTick: 20,
      resolvedTick: 31,
      cause: 'release',
      direction: { x: 0.4, z: -0.2 },
    });
    expect(holdEvent).toMatchObject({ gesture: 'hold', charge: 0, resolvedTick: 52 });
  });

  it('carrega monotonicamente a partir do tick 12 e satura após mais 30 ticks', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 5);

    machine.step(tick(16, { actionDown: true }));
    expect(machine.snapshot().status).toBe('pressed');
    expect(machine.snapshot().charge).toBe(0);

    machine.step(tick(17, { actionDown: true }));
    expect(machine.snapshot().status).toBe('charging');
    expect(machine.snapshot().charge).toBe(0);

    machine.step(tick(32, { actionDown: true }));
    expect(machine.snapshot().charge).toBe(0.5);

    machine.step(tick(47, { actionDown: true }));
    expect(machine.snapshot().charge).toBe(1);

    machine.step(tick(80, { actionDown: true }));
    expect(machine.snapshot().charge).toBe(1);
  });

  it('resolve press e release no mesmo tick como um único tap', () => {
    const machine = new ActionButtonMachine();

    const event = machine.step(
      tick(9, {
        actionEdges: [edge('press', 90), edge('release', 91)],
      }),
    );

    expect(event).toMatchObject({ gesture: 'tap', pressedTick: 9, resolvedTick: 9 });
    expect(machine.snapshot()).toMatchObject({ status: 'committed', consumed: true });
  });
});

describe('ActionButtonMachine — buffer', () => {
  it('aceita o press 9 ticks antes da janela e resolve no primeiro tick legal', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 10, false);
    machine.step(tick(11, { legal: false, actionEdges: [edge('release', 11)] }));

    for (let current = 12; current < 19; current += 1) {
      expect(machine.step(tick(current, { legal: false }))).toBe(null);
    }

    const event = machine.step(tick(19, { legal: true, direction: { x: -1, z: 0 } }));

    expect(event).toMatchObject({
      gesture: 'tap',
      cause: 'buffer',
      pressedTick: 10,
      resolvedTick: 19,
      direction: { x: -1, z: 0 },
    });
  });

  it('expira o press 10 ticks antes da janela sem produzir gesto', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 10, false);
    machine.step(tick(11, { legal: false, actionEdges: [edge('release', 11)] }));

    expect(machine.step(tick(20, { legal: true }))).toBe(null);
    expect(machine.snapshot()).toMatchObject({ status: 'idle', consumed: false });
  });

  it('consome um press ainda segurado no primeiro tick legal do buffer', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0, false);

    const event = machine.step(
      tick(9, { legal: true, actionDown: true, direction: { x: 0, z: 1 } }),
    );

    expect(event).toMatchObject({ gesture: 'tap', cause: 'buffer', direction: { x: 0, z: 1 } });
    expect(machine.snapshot()).toMatchObject({ status: 'committed', consumed: true });
  });
});

describe('ActionButtonMachine — contato e consumo', () => {
  it('contato compatível durante hold resolve com a carga atual e ignora release posterior', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    const contact = machine.step(
      tick(27, {
        actionDown: true,
        compatibleContact: true,
        direction: { x: 0.8, z: 0.1 },
      }),
    );
    const release = machine.step(tick(28, { actionEdges: [edge('release', 28)] }));

    expect(contact).toMatchObject({ gesture: 'hold', cause: 'contact', charge: 0.5 });
    expect(release).toBe(null);
  });

  it('release e contato no mesmo tick resolvem input primeiro', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    const event = machine.step(
      tick(ACTION_BUTTON.tapTicks, {
        compatibleContact: true,
        actionEdges: [edge('release', 12)],
      }),
    );

    expect(event).toMatchObject({ gesture: 'hold', cause: 'release' });
  });

  it('emite no máximo um gesto por token e rearma ao receber token novo', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);
    expect(machine.step(tick(1, { actionEdges: [edge('release', 1)] }))).not.toBe(null);

    expect(machine.step(tick(2, { actionEdges: [edge('press', 2), edge('release', 2.1)] }))).toBe(
      null,
    );

    const next = machine.step(
      tick(3, {
        token: 8,
        context: 'receive',
        actionEdges: [edge('press', 3), edge('release', 3.1)],
      }),
    );
    expect(next).toMatchObject({ token: 8, context: 'receive', gesture: 'tap' });
  });

  it('vincula ao token novo um press que nasce no mesmo tick', () => {
    const machine = new ActionButtonMachine();
    machine.step(tick(0));

    machine.step(
      tick(1, {
        token: 8,
        context: 'receive',
        actionDown: true,
        actionEdges: [edge('press', 1)],
      }),
    );
    const event = machine.step(
      tick(2, {
        token: 8,
        context: 'receive',
        actionEdges: [edge('release', 2)],
      }),
    );

    expect(event).toMatchObject({ token: 8, context: 'receive', gesture: 'tap' });
  });

  it('não libera um segundo gesto do mesmo token após cancelamento tardio', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);
    expect(machine.step(tick(1, { actionEdges: [edge('release', 1)] }))).not.toBe(null);

    machine.step(tick(2, { cancellations: [cancellation('pause', 2)] }));
    const duplicate = machine.step(
      tick(3, { actionEdges: [edge('press', 3), edge('release', 3.1)] }),
    );

    expect(duplicate).toBe(null);
    expect(machine.snapshot()).toMatchObject({ consumed: true, status: 'committed' });
  });

  it('mudança de token durante a carga cancela sem executar', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);
    machine.step(tick(20, { actionDown: true }));

    const result = machine.step(tick(21, { token: 8, context: 'receive', actionDown: true }));

    expect(result).toBe(null);
    expect(machine.snapshot()).toMatchObject({
      token: 8,
      context: 'receive',
      status: 'blocked',
      consumed: false,
      lastCancellation: 'plan-changed',
    });
  });

  it('usa o contexto do tick de resolução quando a técnica muda no mesmo token', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    const event = machine.step(
      tick(1, {
        token: 7,
        context: 'freeball',
        actionEdges: [edge('release', 1)],
      }),
    );

    expect(event).toMatchObject({ token: 7, context: 'freeball', gesture: 'tap' });
  });

  it('locked-illegal cancela explicitamente sem transferir a intenção', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    expect(
      machine.step(tick(5, { lockedIllegal: true, compatibleContact: true, actionDown: true })),
    ).toBe(null);
    expect(machine.snapshot()).toMatchObject({
      status: 'blocked',
      consumed: false,
      lastCancellation: 'plan-changed',
    });
  });

  it('locked-illegal não deixa bloqueio fantasma quando o release chega no mesmo tick', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    machine.step(
      tick(5, {
        lockedIllegal: true,
        actionDown: false,
        actionEdges: [edge('release', 5)],
      }),
    );

    expect(machine.snapshot()).toMatchObject({ status: 'idle', consumed: false });
  });
});

describe('ActionButtonMachine — cancelamentos e ordem temporal', () => {
  it.each<InputCancelReason>([
    'pause',
    'blur',
    'portrait',
    'point-end',
    'plan-changed',
    'stall',
    'pointer-cancel',
  ])('cancela %s sem fabricar release', (reason) => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);

    expect(
      machine.step(
        tick(15, {
          actionDown: false,
          cancellations: [cancellation(reason, 15)],
        }),
      ),
    ).toBe(null);
    expect(machine.snapshot()).toMatchObject({
      status: 'idle',
      charge: 0,
      consumed: false,
      lastCancellation: reason,
    });
  });

  it('rearma no próximo press após o InputHub cancelar e zerar a ação', () => {
    const machine = new ActionButtonMachine();
    pressAt(machine, 0);
    machine.step(tick(1, { actionDown: false, cancellations: [cancellation('pause', 1)] }));

    pressAt(machine, 2);
    const event = machine.step(tick(3, { actionEdges: [edge('release', 3)] }));

    expect(event).toMatchObject({ gesture: 'tap', pressedTick: 2 });
  });

  it('ordena edges e cancelamentos por timestamp e depois sequence', () => {
    const machine = new ActionButtonMachine();
    const press = { kind: 'press', source: 'keyboard', atMs: 20, sequence: 30 } as const;
    const release = { kind: 'release', source: 'keyboard', atMs: 30, sequence: 10 } as const;
    const cancel = { reason: 'pause', atMs: 25, sequence: 20 } as const;

    const result = machine.step(
      tick(0, {
        actionEdges: [release, press],
        cancellations: [cancel],
      }),
    );

    expect(result).toBe(null);
    expect(machine.snapshot()).toMatchObject({ status: 'idle', lastCancellation: 'pause' });

    const bySequence = new ActionButtonMachine();
    const sequenced = bySequence.step(
      tick(1, {
        actionEdges: [
          { kind: 'release', source: 'keyboard', atMs: 50, sequence: 2 },
          { kind: 'press', source: 'keyboard', atMs: 50, sequence: 1 },
        ],
      }),
    );
    expect(sequenced).toMatchObject({ gesture: 'tap', cause: 'release' });
  });

  it('permite press posterior a cancelamento no mesmo tick ordenado', () => {
    const machine = new ActionButtonMachine();
    const cancel = { reason: 'pause', atMs: 10, sequence: 1 } as const;
    const press = { kind: 'press', source: 'keyboard', atMs: 20, sequence: 2 } as const;

    machine.step(
      tick(0, {
        actionDown: true,
        actionEdges: [press],
        cancellations: [cancel],
      }),
    );
    const event = machine.step(tick(1, { actionEdges: [edge('release', 30)] }));

    expect(event).toMatchObject({ gesture: 'tap', pressedTick: 0 });
  });
});
