export type MotionProfile = 'full' | 'reduced';

type MotionMediaSource = (query: string) => { readonly matches: boolean };

/** Detecta a preferência do sistema uma vez no composition root; gameplay permanece alheio ao DOM. */
export function detectMotionProfile(source: MotionMediaSource | null): MotionProfile {
  return source?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}
