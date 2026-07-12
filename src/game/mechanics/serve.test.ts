import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TeamSide } from '../../core/constants';
import { RandomHub } from '../../core/random';
import { SequenceRandom } from '../../core/random/testing/SequenceRandom';
import { RallyState } from '../RallyState';
import type { Athlete, Team } from '../Team';
import type { MechanicsCtx } from './context';
import { aiServe } from './serve';

function makeCtx(aiValues: readonly number[], contactValues: readonly number[]) {
  const ai = SequenceRandom.fromFloats(aiValues);
  const contact = SequenceRandom.fromFloats(contactValues);
  const hub = new RandomHub(1);
  const scheduled: Array<() => void> = [];
  const launches: Array<{ p0: THREE.Vector3; v0: THREE.Vector3 }> = [];
  const server = {
    act: () => undefined,
    reachPoint: () => new THREE.Vector3(-8.5, 1.1, 0),
  } as unknown as Athlete;
  const ball = {
    pos: new THREE.Vector3(),
    launch: (p0: THREE.Vector3, v0: THREE.Vector3) => {
      launches.push({ p0: p0.clone(), v0: v0.clone() });
    },
  };
  const noop = (): void => undefined;
  const ctx = {
    ball,
    rally: new RallyState(),
    servingTeam: TeamSide.HOME,
    diff: { servePower: [0.5, 0.9], serveError: 0.25 },
    random: {
      rules: hub.stream('rules'),
      ai,
      contact,
      control: hub.stream('control'),
    },
    teamOf: () => ({ server: () => server }) as unknown as Team,
    hooks: {
      serveMeter: noop,
      effects: { showAim: noop },
      audio: { hitHard: noop },
      camera: { setMode: noop },
    },
    after: (_seconds: number, callback: () => void) => scheduled.push(callback),
    startRally: noop,
    planNext: noop,
  } as unknown as MechanicsCtx;

  return { ctx, ai, contact, launches, scheduled };
}

describe('aiServe — ownership e consumo do RNG', () => {
  it('saque dentro consome decisões de alvo no stream ai e contato físico no contact', () => {
    const { ctx, ai, contact, launches, scheduled } = makeCtx([0.5, 0.25, 0.75], [0.9, 0.5]);

    aiServe(ctx);

    expect(ai.draws).toBe(3);
    expect(contact.draws).toBe(2);
    expect(launches).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
  });

  it('erro longo mantém toda a dispersão física no stream contact', () => {
    const { ctx, ai, contact } = makeCtx([0.5], [0.1, 0.1, 0.2, 0.3, 0.4]);

    aiServe(ctx);

    expect(ai.draws).toBe(1);
    expect(contact.draws).toBe(5);
  });

  it('erro na rede tem o mesmo orçamento de draws do erro longo', () => {
    const { ctx, ai, contact } = makeCtx([0.5], [0.1, 0.9, 0.2, 0.3, 0.4]);

    aiServe(ctx);

    expect(ai.draws).toBe(1);
    expect(contact.draws).toBe(5);
  });
});
