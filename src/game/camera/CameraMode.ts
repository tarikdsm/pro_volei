import type { TouchKind } from '../../core/constants';

export type CamMode = 'menu' | 'serveHome' | 'serveAway' | 'rally' | 'spike' | 'point' | 'setEnd';

/** Enquadramento lógico do próximo contato, sem dependência do renderer. */
export function camModeForTouch(nextKind: TouchKind): CamMode {
  return nextKind === 'spike' ? 'spike' : 'rally';
}
