// Mapeamento puro do joystick de toque → teclas WASD, extraído de TouchControls para ser testável
// em ambiente Node (sem DOM). Recebe o deslocamento do knob em pixels (dx, dy) já clampado ao raio,
// o raio do stick e se a câmera de saque está ativa; devolve o conjunto de teclas sintéticas.
//  - câmera de saque (serveCam, atrás da sacadora): cima = mais fundo, direita = direita
//  - câmera broadcast (lateral): direita da tela = rumo à rede (mundo +x), baixo = mundo +z
export function stickKeys(dx: number, dy: number, radius: number, serveCam: boolean): Set<string> {
  const t = 0.35 * radius; // zona morta central: abaixo do limiar não sintetiza tecla
  const want = new Set<string>();
  if (serveCam) {
    if (dy < -t) want.add('KeyW'); // cima = mais fundo
    if (dy > t) want.add('KeyS');
    if (dx > t) want.add('KeyD'); // direita = direita
    if (dx < -t) want.add('KeyA');
  } else {
    if (dx > t) want.add('KeyW'); // direita da tela = rumo à rede (mundo +x)
    if (dx < -t) want.add('KeyS');
    if (dy > t) want.add('KeyD'); // baixo da tela = mundo +z
    if (dy < -t) want.add('KeyA');
  }
  return want;
}
