// Dimensões oficiais (1 unidade = 1 metro) e tuning central do jogo.

export const COURT = {
  halfLength: 9, // cada lado tem 9m de fundo até a rede
  halfWidth: 4.5, // quadra tem 9m de largura
  netHeight: 2.43,
  attackLine: 3, // linha de 3m a partir da rede
  freeZone: 5, // zona livre ao redor
  floorY: 0,
};

// Física arcade: gravidade um pouco mais forte deixa o jogo mais ágil.
export const GRAVITY = -13.0;
export const BALL_RADIUS = 0.105;

export interface SimulationTiming {
  hz: number;
  maxRealFrame: number;
  maxStepsPerFrame: number;
}

export const SIMULATION_TIMING = {
  hz: 60,
  maxRealFrame: 0.25,
  maxStepsPerFrame: 5,
} as const satisfies SimulationTiming;

/** Envelopes de câmera da apresentação; todos avançam somente pelo dt recebido. */
export const CAMERA_FEEL = {
  baseFov: 55,
  fovKickMax: 6,
  fovAttackSeconds: 0.05,
  fovReleaseSeconds: 0.25,
  fovProjectionEpsilon: 0.01,
  shakeDurationSeconds: 0.3,
  shakeWorldMax: 0.35,
  shakeDesktopPixels: 12,
  shakeTouchPixels: 8,
  shakeFrequency: 45,
  spikeAnticipationSeconds: 0.35,
} as const;

// Nº máximo de pontos do rastro luminoso da bola (capacidade do ring buffer).
export const TRAIL_MAX_POINTS = 26;

export enum TeamSide {
  HOME = 0,
  AWAY = 1,
} // HOME = humano, lado x negativo

export function sideSign(side: TeamSide): number {
  return side === TeamSide.HOME ? -1 : 1;
}

export function otherSide(side: TeamSide): TeamSide {
  return side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}

export type TouchKind = 'serve' | 'pass' | 'set' | 'spike' | 'block' | 'freeball' | 'dig';

export interface Difficulty {
  name: string;
  reactionDelay: number; // s até a IA reagir à trajetória
  moveSpeed: number; // multiplicador de velocidade dos atletas IA
  passQuality: [number, number]; // faixa de qualidade de passe [min,max]
  attackError: number; // prob. de erro no ataque (rede/fora)
  serveError: number; // prob. de erro no saque
  servePower: [number, number];
  blockChance: number; // prob. de tentar/acertar bloqueio
  digChance: number; // prob. de defender um ataque forte
}

export const DIFFICULTIES: Difficulty[] = [
  {
    name: 'Fácil',
    reactionDelay: 0.42,
    moveSpeed: 0.8,
    passQuality: [0.3, 0.75],
    attackError: 0.3,
    serveError: 0.18,
    servePower: [0.3, 0.55],
    blockChance: 0.22,
    digChance: 0.28,
  },
  {
    name: 'Normal',
    reactionDelay: 0.24,
    moveSpeed: 1.0,
    passQuality: [0.5, 0.92],
    attackError: 0.13,
    serveError: 0.1,
    servePower: [0.5, 0.8],
    blockChance: 0.45,
    digChance: 0.55,
  },
  {
    name: 'Difícil',
    reactionDelay: 0.1,
    moveSpeed: 1.15,
    passQuality: [0.7, 1.0],
    attackError: 0.05,
    serveError: 0.05,
    servePower: [0.7, 0.98],
    blockChance: 0.65,
    digChance: 0.75,
  },
];

// Alturas de contato (m)
export const CONTACT = {
  pass: 1.05, // manchete
  set: 2.25, // toque
  spike: 3.0, // cortada no ápice do pulo
  serve: 2.35, // saque por cima
  blockReach: 3.08, // alcance das mãos no bloqueio
  reach: 1.15, // raio de alcance p/ jogar a bola
  lungeReach: 2.0, // raio de "peixinho" (toque fraco)
};

// Geometria e janela do bloqueio (mechanics/block.ts). blockChance/digChance NÃO ficam
// aqui — são probabilidade por dificuldade e vivem em Difficulty/DIFFICULTIES.
export const BLOCK = {
  window: 0.8, // janela de tempo (s) após o contato em que o bloqueio ainda pode acontecer
  nearNetX: 1.4, // distância máx. na rede (|x|) para o bloqueador contar como "na rede"
  zReach: 0.85, // distância máx. em z entre bloqueador e ponto de cruzamento para alcançar
  netX: 0.72, // x do bloqueador na rede (espelhado por sideSign)
  jumpReachFactor: 0.5, // ganho de alcance por metro de altura do pulo
  jumpDelayRange: [0.0, 0.12] as const, // faixa de atraso (s) do pulo agendado da IA
  stuffThreshold: 0.5, // limiar de prox p/ STUFF (devolve no chão do atacante)
  softThreshold: 0.95, // limiar de prox p/ pingo jogável (acima disso, explode pra fora)
} as const;

// Sweet-spots e curvas do timing humano (control/timing.ts).
export const HUMAN_TIMING = {
  contactBase: 0.45, // qualidade mínima do toque (timing zerado)
  contactSpan: 0.55, // ganho de qualidade do toque com timing perfeito
  hardPenalty: 0.8, // fator sobre bola forte (penaliza 20%)
} as const;

// Limiares e curvas do saque humano (control/HumanController.ts).
export const SERVE_TUNING = {
  perfectLo: 0.72, // início da zona verde (saque perfeito)
  perfectHi: 0.92, // fim da zona verde (acima arrisca sair longo)
  chargeRate: 1.05, // velocidade de carga/descarga do medidor por s
  clearanceHi: 1.3, // folga sobre a rede com força mínima (flutuante)
  clearanceLo: 0.16, // folga sobre a rede com força máxima (raspando a fita)
  clearanceJitter: [0.92, 1.08] as const, // ruído multiplicativo da folga
  perfectPower: 0.95, // potência aplicada num saque perfeito
} as const;

// Posições-base por slot de rodízio (para o lado HOME, x negativo).
// Slots: 0..5 = posições 1(fundo-dir), 6(fundo-centro), 5(fundo-esq), 4(frente-esq), 3(frente-centro), 2(frente-dir)
// Do ponto de vista de quem olha para a rede no lado HOME: +z é a direita.
export const BASE_SLOTS: { x: number; z: number }[] = [
  { x: -6.5, z: 3.0 }, // pos 1  fundo direita (sacador)
  { x: -6.8, z: 0.0 }, // pos 6  fundo centro
  { x: -6.5, z: -3.0 }, // pos 5  fundo esquerda
  { x: -2.2, z: -3.0 }, // pos 4  frente esquerda (ponteiro)
  { x: -2.0, z: 0.0 }, // pos 3  frente centro
  { x: -2.2, z: 3.0 }, // pos 2  frente direita
];

export const SETTER_SPOT = { x: -0.95, z: 1.1 }; // ponto-alvo do passe (lado HOME; espelhar p/ AWAY)
export const SERVE_SPOT = { x: -9.7, z: 3.2 };

// Zonas de ataque na rede (z), do lado que ataca
export const ATTACK_ZONES = [-3.1, 0, 3.1]; // esquerda, centro, direita (perspectiva HOME)

export const PLAYER = {
  speed: 6.2, // m/s humano controlado
  aiSpeed: 5.6,
  acceleration: 31, // m/s² — atinge velocidade máxima em ~200 ms
  deceleration: 38, // m/s² — freada curta e legível
  jumpVel: 5.4, // impulso de pulo (ataque)
  blockJumpVel: 4.6,
  height: 1.88,
};

export const AUTO_SELECTOR = {
  switchAdvantage: 0.15,
  lockWindow: 0.35,
  maxSwitches: 2,
  assistanceRadius: 0.65,
  netMargin: 0.15,
  unreachablePenalty: 10,
  latenessWeight: 4,
  frontRowCost: 0.08,
  coverageCostPerMeter: 0.025,
  movingAwayCost: 0.12,
} as const;

/** Gramática do botão de ação em ticks da simulação fixa de 60 Hz. */
export const ACTION_BUTTON = {
  tapTicks: 12,
  bufferTicks: 9,
  fullChargeTicks: 30,
  deliberateDirection: 0.35,
} as const;

/** Janelas contextuais também expressas em ticks de 60 Hz. */
export const ACTION_WINDOWS = {
  receiveLeadTicks: 48,
  setLeadTicks: 48,
  attackLeadTicks: 42,
  blockLeadTicks: 45,
  freeballLeadTicks: 48,
  receiveIdealTicks: 5,
  setIdealTicks: 5,
  attackIdealTicks: 16,
  blockIdealTicks: 19,
  freeballIdealTicks: 5,
} as const;

export const TIMING_FEEDBACK = {
  perfectMin: 0.85,
  goodMin: 0.55,
  onTimeToleranceTicks: 1,
  visualDuration: { perfect: 0.24, good: 0.19, off: 0.15 },
  colors: { perfect: 0xeaffff, good: 0xffd45a, off: 0xff665f },
  haptics: { perfect: [20, 30, 20], good: [15], off: [10] },
} as const;

export const MATCH_FORMATS = [
  { name: 'Rápida — 1 set de 15', sets: 1, pointsPerSet: 15 },
  { name: 'Clássica — melhor de 3 a 25', sets: 3, pointsPerSet: 25 },
];

export const COLORS = {
  homeJersey: 0x1565e8,
  homeShorts: 0x0c2f6b,
  awayJersey: 0xe53935,
  awayShorts: 0x7f1613,
  floorCourt: 0xe8894a, // taraflex laranja
  floorFree: 0x2f7d5c, // zona livre verde
  lines: 0xf5f5f5,
  net: 0xeeeeee,
};

// Torcida instanciada (~1300 pessoas). O loop de animação recompõe a matriz de cada
// pessoa e reenvia o buffer à GPU — custo fixo por frame. O throttle por tick fixo
// desacopla esse custo do FPS: a animação é reconstruída `tickHz` vezes por segundo,
// não a cada frame. Valores "Low" = celular (menos gente e reconstrução menos frequente).
export const CROWD = {
  density: 1, // fração de assentos ocupados no desktop
  densityLow: 0.55, // fração de assentos ocupados no celular
  tickHz: 20, // reconstruções da animação por segundo (desktop)
  tickHzLow: 12, // reconstruções da animação por segundo (celular)
  idleFreezeBelow: 0, // se > 0, congela a animação quando a empolgação fica abaixo deste limiar (0 = desligado)
};
