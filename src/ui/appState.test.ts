import { describe, it, expect } from 'vitest';
import { nextAppState } from './appState';

describe('nextAppState', () => {
  it('start: title → playing', () => {
    expect(nextAppState('title', 'start')).toBe('playing');
  });

  it('togglePause: playing ⇄ paused', () => {
    expect(nextAppState('playing', 'togglePause')).toBe('paused');
    expect(nextAppState('paused', 'togglePause')).toBe('playing');
  });

  it('togglePause é ignorado após o fim da partida (Escape não reabre a pausa — CLAIM 3)', () => {
    expect(nextAppState('ended', 'togglePause')).toBe('ended');
  });

  it('togglePause é ignorado no título (Escape só pausa em jogo)', () => {
    expect(nextAppState('title', 'togglePause')).toBe('title');
  });

  it('resume: paused → playing', () => {
    expect(nextAppState('paused', 'resume')).toBe('playing');
  });

  it('resume é idempotente fora da pausa (playing → playing)', () => {
    expect(nextAppState('playing', 'resume')).toBe('playing');
  });

  it('matchEnded leva qualquer estado a ended', () => {
    expect(nextAppState('playing', 'matchEnded')).toBe('ended');
    expect(nextAppState('paused', 'matchEnded')).toBe('ended');
    expect(nextAppState('title', 'matchEnded')).toBe('ended');
    expect(nextAppState('ended', 'matchEnded')).toBe('ended');
  });
});
