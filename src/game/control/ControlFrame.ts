import type { InputFrame } from '../../core/input/InputFrame';
import type { CourtAxis } from '../../core/input/CameraSpaceMapper';

/** Entrada neutra já convertida da tela para o plano da quadra. */
export interface ControlFrame extends InputFrame {
  readonly courtAxis: CourtAxis;
}
