// Dimensões oficiais (1 unidade = 1 metro) e tuning central do jogo.

export const COURT = {
  halfLength: 9,       // cada lado tem 9m de fundo até a rede
  halfWidth: 4.5,      // quadra tem 9m de largura
  netHeight: 2.43,
  attackLine: 3,       // linha de 3m a partir da rede
  freeZone: 5,         // zona livre ao redor
  floorY: 0,
};

// Física arcade: gravidade um pouco mais forte deixa o jogo mais ágil.
export const GRAVITY = -13.0;
export const BALL_RADIUS = 0.105;

export enum TeamSide { HOME = 0, AWAY = 1 } // HOME = humano, lado x negativo

export function sideSign(side: TeamSide): number {
  return side === TeamSide.HOME ? -1 : 1;
}

export function otherSide(side: TeamSide): TeamSide {
  return side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}

export enum GameState {
  MENU, SERVE_PREP, SERVING, RALLY, POINT_SCORED, SET_END, MATCH_END, PAUSED,
}

// Fase do rally do ponto de vista da bola/posse
export enum RallyPhase { SERVE, RECEIVE, SET, ATTACK, FREEBALL }

export type TouchKind = 'serve' | 'pass' | 'set' | 'spike' | 'block' | 'freeball' | 'dig';

export interface Difficulty {
  name: string;
  reactionDelay: number;      // s até a IA reagir à trajetória
  moveSpeed: number;          // multiplicador de velocidade dos atletas IA
  passQuality: [number, number];  // faixa de qualidade de passe [min,max]
  attackError: number;        // prob. de erro no ataque (rede/fora)
  serveError: number;         // prob. de erro no saque
  servePower: [number, number];
  blockChance: number;        // prob. de tentar/acertar bloqueio
  digChance: number;          // prob. de defender um ataque forte
}

export const DIFFICULTIES: Difficulty[] = [
  {
    name: 'Fácil', reactionDelay: 0.42, moveSpeed: 0.8,
    passQuality: [0.3, 0.75], attackError: 0.22, serveError: 0.18,
    servePower: [0.35, 0.6], blockChance: 0.25, digChance: 0.35,
  },
  {
    name: 'Normal', reactionDelay: 0.24, moveSpeed: 1.0,
    passQuality: [0.5, 0.92], attackError: 0.11, serveError: 0.1,
    servePower: [0.5, 0.8], blockChance: 0.45, digChance: 0.55,
  },
  {
    name: 'Difícil', reactionDelay: 0.1, moveSpeed: 1.15,
    passQuality: [0.7, 1.0], attackError: 0.05, serveError: 0.05,
    servePower: [0.7, 0.98], blockChance: 0.65, digChance: 0.75,
  },
];

// Alturas de contato (m)
export const CONTACT = {
  pass: 1.05,        // manchete
  set: 2.25,         // toque
  spike: 3.0,        // cortada no ápice do pulo
  serve: 2.35,       // saque por cima
  blockReach: 3.08,  // alcance das mãos no bloqueio
  reach: 1.15,       // raio de alcance p/ jogar a bola
  lungeReach: 2.0,   // raio de "peixinho" (toque fraco)
};

// Posições-base por slot de rodízio (para o lado HOME, x negativo).
// Slots: 0..5 = posições 1(fundo-dir), 6(fundo-centro), 5(fundo-esq), 4(frente-esq), 3(frente-centro), 2(frente-dir)
// Do ponto de vista de quem olha para a rede no lado HOME: +z é a direita.
export const BASE_SLOTS: { x: number; z: number }[] = [
  { x: -6.5, z: 3.0 },   // pos 1  fundo direita (sacador)
  { x: -6.8, z: 0.0 },   // pos 6  fundo centro
  { x: -6.5, z: -3.0 },  // pos 5  fundo esquerda
  { x: -2.2, z: -3.0 },  // pos 4  frente esquerda (ponteiro)
  { x: -2.0, z: 0.0 },   // pos 3  frente centro
  { x: -2.2, z: 3.0 },   // pos 2  frente direita
];

export const SETTER_SPOT = { x: -0.95, z: 1.1 };  // ponto-alvo do passe (lado HOME; espelhar p/ AWAY)
export const SERVE_SPOT = { x: -9.7, z: 3.2 };

// Zonas de ataque na rede (z), do lado que ataca
export const ATTACK_ZONES = [-3.1, 0, 3.1]; // esquerda, centro, direita (perspectiva HOME)

export const PLAYER = {
  speed: 6.2,          // m/s humano controlado
  aiSpeed: 5.6,
  jumpVel: 5.4,        // impulso de pulo (ataque)
  blockJumpVel: 4.6,
  height: 1.88,
};

export const MATCH_FORMATS = [
  { name: 'Rápida — 1 set de 15', sets: 1, pointsPerSet: 15 },
  { name: 'Clássica — melhor de 3 a 25', sets: 3, pointsPerSet: 25 },
];

export const COLORS = {
  homeJersey: 0x1565e8, homeShorts: 0x0c2f6b,
  awayJersey: 0xe53935, awayShorts: 0x7f1613,
  floorCourt: 0xe8894a,   // taraflex laranja
  floorFree: 0x2f7d5c,    // zona livre verde
  lines: 0xf5f5f5,
  net: 0xeeeeee,
};
