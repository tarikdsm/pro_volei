export interface TouchScreenAxis {
  right: number;
  up: number;
}

const DEFAULT_DEADZONE = 0.35;

/** Converte o deslocamento do joystick em um eixo analógico relativo à tela. */
export function screenAxisFromStick(
  dx: number,
  dy: number,
  radius: number,
  deadzone = DEFAULT_DEADZONE,
): TouchScreenAxis {
  if (![dx, dy, radius, deadzone].every(Number.isFinite) || radius <= 0) {
    return { right: 0, up: 0 };
  }

  const length = Math.hypot(dx, dy);
  const normalizedLength = Math.min(1, length / radius);
  const safeDeadzone = Math.min(0.99, Math.max(0, deadzone));
  if (normalizedLength <= safeDeadzone || length === 0) {
    return { right: 0, up: 0 };
  }

  const magnitude = (normalizedLength - safeDeadzone) / (1 - safeDeadzone);
  return {
    right: (dx / length) * magnitude,
    up: (-dy / length) * magnitude,
  };
}
