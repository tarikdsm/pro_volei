import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import { Team } from '../Team';
import { createHeadlessCharacter, HeadlessCharacter } from './HeadlessCharacter';

describe('HeadlessCharacter', () => {
  it('preserva estado lógico sem DOM, canvas, meshes ou materiais', () => {
    expect(globalThis.document).toBeUndefined();
    const character = new HeadlessCharacter();

    character.setAction('spikeHit');
    character.moveSpeed = 4;
    character.presentJump(1.2);
    character.update(1 / 60);

    expect(character.action).toBe('spikeHit');
    expect(character.moveSpeed).toBe(4);
    expect(character.jumpY).toBe(1.2);
    expect(character.root.children).toHaveLength(0);
  });

  it('permite construir e atualizar um time completo em Node', () => {
    const team = new Team(TeamSide.HOME, createHeadlessCharacter);

    expect(team.athletes).toHaveLength(6);
    expect(team.group.children).toHaveLength(6);
    expect(team.athletes.every((athlete) => athlete.char.root.children.length === 0)).toBe(true);

    team.athletes[0].moveTo(-5, 1);
    team.update(1 / 60, 6);
    team.beginFixedStep();
    team.present(0.5);
  });
});
