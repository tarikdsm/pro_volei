export const HUD_SCALES = [0.85, 1, 1.15] as const;
export type HudScale = (typeof HUD_SCALES)[number];

export interface HintState {
  readonly text: string;
  readonly remaining: number;
}

export type HintEvent =
  | { readonly type: 'show'; readonly text: string; readonly seconds: number }
  | { readonly type: 'tick'; readonly dt: number };

export function normalizeHudScale(value: unknown): HudScale {
  return HUD_SCALES.includes(value as HudScale) ? (value as HudScale) : 1;
}

export function reduceHint(state: HintState, event: HintEvent): HintState {
  if (event.type === 'show') {
    return event.text
      ? { text: event.text, remaining: Math.max(0, event.seconds) }
      : { text: '', remaining: 0 };
  }

  const remaining = Math.max(0, state.remaining - Math.max(0, event.dt));
  return remaining === 0 ? { text: '', remaining: 0 } : { ...state, remaining };
}
