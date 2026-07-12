import type { FeedbackPort, TimingFeedbackEvent } from '../game/feedback/TimingFeedback';

export interface TimingFeedbackSink {
  timingCue(event: Readonly<TimingFeedbackEvent>): void;
}

/** Fan-out síncrono e deduplicado: visual, áudio e haptic recebem o mesmo evento. */
export class PresentationFeedback implements FeedbackPort {
  private lastKey: string | null = null;
  private lastEvent: Readonly<TimingFeedbackEvent> | null = null;

  constructor(private readonly sinks: readonly TimingFeedbackSink[]) {}

  emit(event: Readonly<TimingFeedbackEvent>): void {
    const key = `${event.token}:${event.simulationTick}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.lastEvent = event;
    for (const sink of this.sinks) sink.timingCue(event);
  }

  snapshot(): Readonly<TimingFeedbackEvent> | null {
    return this.lastEvent;
  }
}
