import { BLOCK, GRAVITY, PLAYER, TeamSide } from '../../core/constants';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import {
  canonicalStrategyOptions,
  strategySubtarget,
  strategyToLocal,
  strategyToWorld,
  type CanonicalStrategyOption,
} from './CourtZones';
import { isCanonicalOwnContactRead } from './OwnContactRead';
import type {
  AthleteStrategySnapshot,
  ScoredStrategyCandidate,
  StrategyDecisionContext,
  StrategyDecisionKind,
  StrategyMemorySnapshot,
  StrategyOptionId,
  StrategyPoint2,
  StrategyProposal,
  StrategyScoreComponents,
  StrategyVisibleBallRead,
} from './StrategyTypes';

const UINT32_SCALE = 0x1_0000_0000;

export const STRATEGY_PROFILES = [
  { exploration: 0.25, temperature: 0.35, cap: 0.5 },
  { exploration: 0.18, temperature: 0.3, cap: 0.55 },
  { exploration: 0.06, temperature: 0.15, cap: 0.7 },
] as const;

/**
 * Janela de legalidade do quick-center. `arrivalSlack` permite que a central chegue um pouco
 * DEPOIS do toque da levantadora: o voo curto do quick cobre a diferença, como no vôlei real.
 */
const QUICK_WINDOW = Object.freeze({
  minEta: 0.1,
  maxEta: 1.35,
  minHeight: 0.8,
  maxHeight: 4,
  arrivalSlack: 0.2,
});

const MEMORY_DEPTH = [2, 5, 6] as const;
const MEMORY_RECENCY_WEIGHTS = [1, 0.72, 0.52, 0.37, 0.27, 0.19] as const;
const SERVE_RECEIVE_WINDOW = 1.25;
const SET_FAMILY_WINDOW: Readonly<Record<string, number>> = Object.freeze({
  quick: 0.55,
  accelerated: 0.85,
  high: 1.35,
});
const SETTER_WINDOW = Object.freeze({ x: -1, z: 1 });
const SETTER_LATERAL_RADIUS = 1.2;
const ATTACK_ORIGIN_X = -0.9;
const KNOWN_OPTION_IDS = new Set<StrategyOptionId>([
  ...canonicalStrategyOptions('serve').map((option) => option.optionId),
  ...canonicalStrategyOptions('set').map((option) => option.optionId),
  ...canonicalStrategyOptions('attack', { attackOriginZ: 0 }).map((option) => option.optionId),
]);
const KNOWN_FAMILIES: Readonly<Record<StrategyDecisionKind, ReadonlySet<string>>> = Object.freeze({
  serve: new Set(['float-deep', 'float-short', 'power-deep']),
  set: new Set(['accelerated', 'high', 'quick']),
  attack: new Set(['placed', 'power', 'tip']),
});
const MAX_TACTICAL_BIAS = 0.12;

const SCORE_WEIGHTS = {
  serve: { space: 0.3, seamEta: 0.25, memory: 0.2, technical: 0.15, variety: 0.1 },
  set: {
    blockPressure: 0.3,
    viabilityEta: 0.3,
    visiblePass: 0.2,
    memory: 0.15,
    variety: 0.05,
  },
  attack: {
    space: 0.3,
    block: 0.25,
    techniqueDepth: 0.2,
    angle: 0.1,
    memory: 0.1,
    variety: 0.05,
  },
} as const;

const SHORTLIST_THRESHOLD = { serve: 0.22, set: 0.18, attack: 0.18 } as const;

interface LocalAthlete extends Omit<AthleteStrategySnapshot, 'position' | 'velocity'> {
  readonly position: StrategyPoint2;
  readonly velocity: StrategyPoint2;
}

interface CandidateDraft {
  readonly option: CanonicalStrategyOption;
  readonly components: StrategyScoreComponents;
  readonly score: number;
  readonly target: StrategyPoint2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function tacticalBias(context: StrategyDecisionContext, option: CanonicalStrategyOption): number {
  const profile = context.tacticalProfile;
  if (!profile) return 0;
  const family = profile.familyBias?.[context.kind]?.[option.family] ?? 0;
  const choice = profile.optionBias?.[option.optionId] ?? 0;
  return Math.max(-MAX_TACTICAL_BIAS, Math.min(MAX_TACTICAL_BIAS, family + choice));
}

function distance(a: StrategyPoint2, b: StrategyPoint2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function weightedScore(
  components: StrategyScoreComponents,
  weights: Readonly<Record<string, number>>,
): number {
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) score += (components[name] ?? 0) * weight;
  return clamp01(score);
}

function memoryValue(
  memory: StrategyMemorySnapshot,
  optionId: StrategyOptionId,
  difficulty: 0 | 1 | 2,
): number {
  const kind = optionId.slice(0, optionId.indexOf('.')) as StrategyDecisionKind;
  const categoryHistory = memory.outcomes
    .filter((outcome) => outcome.kind === kind)
    .slice(-MEMORY_DEPTH[difficulty])
    .reverse();
  let weightedEffectiveness = 0;
  let totalWeight = 0;
  categoryHistory.forEach((outcome, recencyIndex) => {
    if (outcome.optionId !== optionId) return;
    const weight = MEMORY_RECENCY_WEIGHTS[recencyIndex];
    weightedEffectiveness += outcome.effectiveness * weight;
    totalWeight += weight;
  });
  return totalWeight === 0 ? 0.5 : clamp01(weightedEffectiveness / totalWeight);
}

function varietyValue(memory: StrategyMemorySnapshot, optionId: StrategyOptionId): number {
  const kindPrefix = optionId.slice(0, optionId.indexOf('.') + 1);
  const repetitions = memory.recentChoices
    .filter((choice) => choice.startsWith(kindPrefix))
    .slice(-3)
    .filter((choice) => choice === optionId).length;
  return 1 - repetitions / 3;
}

function nearestDistances(target: StrategyPoint2, athletes: readonly LocalAthlete[]): number[] {
  return athletes.map((athlete) => distance(target, athlete.position)).sort((a, b) => a - b);
}

function athleteArrivalTime(athlete: LocalAthlete, target: StrategyPoint2): number {
  const deltaX = target.x - athlete.position.x;
  const deltaZ = target.z - athlete.position.z;
  const travelDistance = Math.hypot(deltaX, deltaZ);
  if (travelDistance <= 1e-9) return 0;
  const directionX = deltaX / travelDistance;
  const directionZ = deltaZ / travelDistance;
  const projectedVelocity = athlete.velocity.x * directionX + athlete.velocity.z * directionZ;
  const lateralVelocity = athlete.velocity.x * -directionZ + athlete.velocity.z * directionX;
  return estimatePlanarArrivalTime(
    travelDistance,
    projectedVelocity,
    lateralVelocity,
    PLAYER.aiSpeed,
    PLAYER.acceleration,
    PLAYER.deceleration,
    0.35,
  );
}

function normalizedEta(eta: number, horizon: number): number {
  return Number.isFinite(eta) ? clamp01(eta / horizon) : 1;
}

function freezeComponents(values: Record<string, number>): StrategyScoreComponents {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`Componente estratégico inválido: ${name}`);
    }
  }
  return Object.freeze(values);
}

function localAthletes(context: StrategyDecisionContext): readonly LocalAthlete[] {
  const athletes = context.ownContactRead
    ? [
        ...context.ownContactRead.ownAthletes,
        ...context.observation.athletes.filter((athlete) => athlete.side !== context.side),
      ]
    : context.observation.athletes;
  return athletes
    .map((athlete) => ({
      ...athlete,
      position: strategyToLocal(athlete.position, context.side),
      velocity: strategyToLocal(athlete.velocity, context.side),
    }))
    .sort((a, b) => a.side - b.side || a.id - b.id);
}

export function readVisibleBall(context: StrategyDecisionContext): StrategyVisibleBallRead {
  const ball = context.ownContactRead?.ballAfter ?? context.observation.ball;
  const unreachable = (lateralMiss = Number.POSITIVE_INFINITY): StrategyVisibleBallRead => ({
    reachable: false,
    eta: Number.POSITIVE_INFINITY,
    predictedHeight: 0,
    lateralMiss,
    quality: 0,
  });
  if (!ball.inFlight) return unreachable();
  const position = strategyToLocal(ball.position, context.side);
  const velocity = strategyToLocal(ball.velocity, context.side);
  const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
  if (speedSq <= 0.05 * 0.05) return unreachable();
  const deltaX = SETTER_WINDOW.x - position.x;
  const deltaZ = SETTER_WINDOW.z - position.z;
  const projection = deltaX * velocity.x + deltaZ * velocity.z;
  if (projection <= 0) return unreachable();
  const eta = projection / speedSq;
  const closest = { x: position.x + velocity.x * eta, z: position.z + velocity.z * eta };
  const lateralMiss = distance(closest, SETTER_WINDOW);
  if (lateralMiss > SETTER_LATERAL_RADIUS) return unreachable(lateralMiss);
  const predictedHeight = ball.position.y + ball.velocity.y * eta + 0.5 * GRAVITY * eta * eta;
  const heightQuality = 1 - Math.abs(predictedHeight - 2.25) / 2.25;
  const timingQuality = 1 - Math.abs(eta - 0.75) / 1.25;
  const lateralQuality = 1 - lateralMiss / SETTER_LATERAL_RADIUS;
  return {
    reachable: true,
    eta,
    predictedHeight,
    lateralMiss,
    quality: clamp01((heightQuality + timingQuality + lateralQuality) / 3),
  };
}

function serveComponents(
  option: CanonicalStrategyOption,
  opponents: readonly LocalAthlete[],
  memory: StrategyMemorySnapshot,
  difficulty: 0 | 1 | 2,
): StrategyScoreComponents {
  const distances = nearestDistances(option.center, opponents);
  const receiverEtas = opponents
    .map((athlete) => athleteArrivalTime(athlete, option.center))
    .sort((a, b) => a - b);
  const firstReceiverEta = normalizedEta(
    receiverEtas[0] ?? Number.POSITIVE_INFINITY,
    SERVE_RECEIVE_WINDOW,
  );
  const secondReceiverEta = normalizedEta(
    receiverEtas[1] ?? receiverEtas[0] ?? Number.POSITIVE_INFINITY,
    SERVE_RECEIVE_WINDOW,
  );
  const technical =
    option.family === 'float-deep' ? 0.85 : option.family === 'float-short' ? 0.78 : 0.7;
  return freezeComponents({
    space: clamp01((distances[0] ?? 0) / 5),
    seamEta: (firstReceiverEta + secondReceiverEta) / 2,
    memory: memoryValue(memory, option.optionId, difficulty),
    technical,
    variety: varietyValue(memory, option.optionId),
  });
}

function setComponents(
  option: CanonicalStrategyOption,
  own: readonly LocalAthlete[],
  opponents: readonly LocalAthlete[],
  memory: StrategyMemorySnapshot,
  ballQuality: number,
  difficulty: 0 | 1 | 2,
  setterAthleteId: number,
): StrategyScoreComponents {
  const ownFront = own.filter(
    (athlete) => athlete.row === 'front' && athlete.id !== setterAthleteId,
  );
  const enemyFront = opponents.filter((athlete) => athlete.row === 'front');
  const familyWindow = SET_FAMILY_WINDOW[option.family] ?? SET_FAMILY_WINDOW.high;
  const attackerEta = ownFront.reduce(
    (best, athlete) => Math.min(best, athleteArrivalTime(athlete, option.center)),
    Number.POSITIVE_INFINITY,
  );
  const blockStaging = { x: BLOCK.netX, z: option.center.z };
  const blockerEta = enemyFront.reduce(
    (best, athlete) => Math.min(best, athleteArrivalTime(athlete, blockStaging)),
    Number.POSITIVE_INFINITY,
  );
  return freezeComponents({
    blockPressure: normalizedEta(blockerEta, familyWindow),
    viabilityEta: 1 - normalizedEta(attackerEta, familyWindow),
    visiblePass: ballQuality,
    memory: memoryValue(memory, option.optionId, difficulty),
    variety: varietyValue(memory, option.optionId),
  });
}

function localAttackNetCrossZ(originZ: number, target: StrategyPoint2): number {
  const denominator = target.x - ATTACK_ORIGIN_X;
  if (denominator <= 1e-9) return originZ;
  const fraction = -ATTACK_ORIGIN_X / denominator;
  return originZ + (target.z - originZ) * fraction;
}

/** Diagnóstico geométrico puro: z mundial onde a linha origem→target cruza x=0. */
export function attackNetCrossZ(
  attackOriginZ: number,
  worldTarget: StrategyPoint2,
  side: TeamSide,
): number {
  const localOriginZ = strategyToLocal({ x: 0, z: attackOriginZ }, side).z;
  const localTarget = strategyToLocal(worldTarget, side);
  const localCrossZ = localAttackNetCrossZ(localOriginZ, localTarget);
  return strategyToWorld({ x: 0, z: localCrossZ }, side).z;
}

function attackComponents(
  option: CanonicalStrategyOption,
  opponents: readonly LocalAthlete[],
  memory: StrategyMemorySnapshot,
  difficulty: 0 | 1 | 2,
  attackOriginZ: number,
): StrategyScoreComponents {
  const enemyFront = opponents.filter((athlete) => athlete.row === 'front');
  const enemyBack = opponents.filter((athlete) => athlete.row === 'back');
  const spaceDistance = nearestDistances(option.center, opponents)[0] ?? 10;
  const crossZ = localAttackNetCrossZ(attackOriginZ, option.center);
  const blockOpenness =
    enemyFront.length === 0
      ? 1
      : Math.min(
          ...enemyFront.map((athlete) => {
            const eta = athleteArrivalTime(athlete, { x: BLOCK.netX, z: crossZ });
            const threat = clamp01(1 - eta / 0.75 + (athlete.airborne ? 0.2 : 0));
            return 1 - threat;
          }),
        );
  const backDepth =
    enemyBack.length === 0
      ? 0.5
      : clamp01(
          enemyBack.reduce((sum, athlete) => sum + athlete.position.x, 0) / enemyBack.length / 8,
        );
  const techniqueDepth =
    option.family === 'tip'
      ? backDepth
      : option.family === 'power'
        ? 1 - backDepth * 0.7
        : 1 - backDepth * 0.6;
  const angle = option.optionId.includes('seam')
    ? 0.9
    : option.optionId.includes('cross')
      ? 0.82
      : 0.74;
  return freezeComponents({
    space: clamp01(spaceDistance / 5),
    block: blockOpenness,
    techniqueDepth: clamp01(techniqueDepth),
    angle,
    memory: memoryValue(memory, option.optionId, difficulty),
    variety: varietyValue(memory, option.optionId),
  });
}

/** Diagnóstico puro da redistribuição do teto da melhor candidata. */
export function redistributeBestCandidateCap(
  source: readonly number[],
  bestIndex: number,
  cap: number,
): readonly number[] {
  const probabilities = [...source];
  if (probabilities[bestIndex] <= cap) return Object.freeze(probabilities);
  const excess = probabilities[bestIndex] - cap;
  probabilities[bestIndex] = cap;
  const otherTotal = probabilities.reduce(
    (sum, value, index) => sum + (index === bestIndex ? 0 : value),
    0,
  );
  if (otherTotal <= 0) throw new RangeError('Teto exige ao menos uma alternativa com massa');
  for (let index = 0; index < probabilities.length; index++) {
    if (index !== bestIndex && probabilities[index] > 0) {
      probabilities[index] += excess * (probabilities[index] / otherTotal);
    }
  }
  return Object.freeze(probabilities);
}

/** Diagnóstico puro da shortlist/CDF, sem candidatos ou estado de gameplay. */
export function strategyProbabilitiesForScores(
  scores: readonly number[],
  kind: StrategyDecisionKind,
  difficulty: 0 | 1 | 2,
): readonly number[] {
  if (
    scores.length === 0 ||
    scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)
  ) {
    throw new RangeError('Scores diagnósticos devem ser finitos em [0,1]');
  }
  const best = Math.max(...scores);
  const eligible = scores.map((score) => score >= best - SHORTLIST_THRESHOLD[kind] - 1e-12);
  const eligibleCount = eligible.filter(Boolean).length;
  if (eligibleCount === 1) return Object.freeze(eligible.map((included) => (included ? 1 : 0)));

  const profile = STRATEGY_PROFILES[difficulty];
  const exponents = scores.map((score, index) =>
    eligible[index] ? Math.exp((score - best) / profile.temperature) : 0,
  );
  const exponentTotal = exponents.reduce((sum, value) => sum + value, 0);
  const probabilities = exponents.map((value, index) =>
    eligible[index]
      ? (1 - profile.exploration) * (value / exponentTotal) + profile.exploration / eligibleCount
      : 0,
  );
  const bestIndex = scores.findIndex((score) => score === best);
  const capped = redistributeBestCandidateCap(probabilities, bestIndex, profile.cap);
  const total = capped.reduce((sum, value) => sum + value, 0);
  return Object.freeze(capped.map((value) => value / total));
}

function chooseIndex(probabilities: readonly number[], selection: number): number {
  const sample = selection / UINT32_SCALE;
  let cumulative = 0;
  let lastEligible = 0;
  for (let index = 0; index < probabilities.length; index++) {
    if (probabilities[index] <= 0) continue;
    lastEligible = index;
    cumulative += probabilities[index];
    if (sample < cumulative) return index;
  }
  return lastEligible;
}

function assertUint32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('StrategyDrawTicket exige dois uint32');
  }
}

function assertFinitePoint(point: StrategyPoint2 & { readonly y?: number }, label: string): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.z) ||
    (point.y !== undefined && !Number.isFinite(point.y))
  ) {
    throw new RangeError(`${label} exige coordenadas finitas`);
  }
}

function validateContext(context: StrategyDecisionContext): void {
  const validSide = (side: unknown): side is TeamSide =>
    side === TeamSide.HOME || side === TeamSide.AWAY;
  if (!validSide(context.side)) throw new RangeError('Lado estratégico inválido');
  if (!['serve', 'set', 'attack'].includes(context.kind)) {
    throw new RangeError('Tipo de decisão estratégica inválido');
  }
  assertUint32(context.ticket.selection);
  assertUint32(context.ticket.variation);
  if (![0, 1, 2].includes(context.difficulty))
    throw new RangeError('Dificuldade estratégica inválida');
  validateTacticalProfile(context.tacticalProfile);
  if (!Number.isSafeInteger(context.observation.tick) || context.observation.tick < 0) {
    throw new RangeError('Tick observado inválido');
  }
  if (
    !Number.isSafeInteger(context.decisionTick) ||
    context.decisionTick < context.observation.tick
  ) {
    throw new RangeError('Tick de decisão anterior à observação');
  }
  if (
    context.observation.score.length !== 2 ||
    context.observation.score.some((score) => !Number.isSafeInteger(score) || score < 0)
  ) {
    throw new RangeError('Placar estratégico inválido');
  }
  if (
    context.observation.possessionSide !== null &&
    !validSide(context.observation.possessionSide)
  ) {
    throw new RangeError('Lado da posse inválido');
  }
  if (!validSide(context.observation.servingSide)) throw new RangeError('Lado do saque inválido');
  if (
    !Number.isInteger(context.observation.possessionTouches) ||
    context.observation.possessionTouches < 0 ||
    context.observation.possessionTouches > 3
  ) {
    throw new RangeError('Toques da posse devem estar em [0,3]');
  }
  const contactTick = context.observation.ball.lastVisibleContactTick;
  if (
    contactTick !== null &&
    (!Number.isSafeInteger(contactTick) ||
      contactTick < 0 ||
      contactTick > context.observation.tick)
  ) {
    throw new RangeError('Tick do último contato visível inválido');
  }
  if (
    context.kind === 'attack' &&
    (!Number.isFinite(context.attackOriginZ) || Math.abs(context.attackOriginZ!) > 4.5)
  ) {
    throw new RangeError('Ataque exige attackOriginZ mundial válido');
  }
  const ownContact = context.ownContactRead;
  if (context.kind === 'serve') {
    if (ownContact !== undefined) throw new Error('Saque não aceita leitura própria de contato');
  } else {
    if (
      !isCanonicalOwnContactRead(ownContact) ||
      ownContact.side !== context.side ||
      ownContact.tick !== context.decisionTick ||
      (context.kind === 'set' && ownContact.kind !== 'pass' && ownContact.kind !== 'dig') ||
      (context.kind === 'attack' &&
        ownContact.kind !== 'pass' &&
        ownContact.kind !== 'dig' &&
        ownContact.kind !== 'set')
    ) {
      throw new Error('Set/ataque exige leitura própria canônica e causal');
    }
  }
  if (context.observation.athletes.length !== 12) throw new Error('Observação exige 12 atletas');
  const identities = new Set<string>();
  const sideCounts = [0, 0];
  const slots = [new Set<number>(), new Set<number>()];
  for (const athlete of context.observation.athletes) {
    if (!validSide(athlete.side)) throw new Error('Lado da atleta inválido');
    if (!Number.isSafeInteger(athlete.id) || athlete.id < 0)
      throw new Error('ID de atleta inválido');
    if (!Number.isInteger(athlete.slot) || athlete.slot < 0 || athlete.slot > 5) {
      throw new Error('Slot estratégico inválido');
    }
    const identity = `${athlete.side}:${athlete.id}`;
    if (identities.has(identity)) throw new Error(`Atleta duplicada: ${identity}`);
    identities.add(identity);
    sideCounts[athlete.side] += 1;
    slots[athlete.side].add(athlete.slot);
    if ((athlete.slot <= 2 ? 'back' : 'front') !== athlete.row)
      throw new Error('Fileira incompatível');
    assertFinitePoint(athlete.position, 'Posição');
    assertFinitePoint(athlete.velocity, 'Velocidade');
  }
  if (sideCounts[0] !== 6 || sideCounts[1] !== 6 || slots.some((set) => set.size !== 6)) {
    throw new Error('Observação exige seis atletas e seis slots por lado');
  }
  if (
    context.kind === 'set' &&
    (!Number.isSafeInteger(context.setterAthleteId) ||
      context.setterAthleteId! < 0 ||
      !ownContact!.ownAthletes.some((athlete) => athlete.id === context.setterAthleteId))
  ) {
    throw new Error('Set exige setterAthleteId de uma levantadora do próprio roster');
  }
  assertFinitePoint(context.observation.ball.position, 'Bola');
  assertFinitePoint(context.observation.ball.velocity, 'Velocidade da bola');
  if (!Number.isSafeInteger(context.memory.revision) || context.memory.revision < 0) {
    throw new Error('Revisão de memória inválida');
  }
  for (const outcome of context.memory.outcomes) {
    if (
      !KNOWN_OPTION_IDS.has(outcome.optionId) ||
      !outcome.optionId.startsWith(`${outcome.kind}.`)
    ) {
      throw new Error('Outcome de memória incompatível com kind/optionId');
    }
    if (
      !Number.isFinite(outcome.effectiveness) ||
      outcome.effectiveness < 0 ||
      outcome.effectiveness > 1
    ) {
      throw new Error('Outcome de memória inválido');
    }
  }
  for (const choice of context.memory.recentChoices) {
    if (!KNOWN_OPTION_IDS.has(choice)) throw new Error('Escolha recente de memória inválida');
  }
}

function validateTacticalProfile(profile: StrategyDecisionContext['tacticalProfile']): void {
  if (profile === undefined) return;
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new RangeError('Perfil tático inválido');
  }
  for (const [kind, entries] of Object.entries(profile.familyBias ?? {})) {
    if (!['serve', 'set', 'attack'].includes(kind) || !entries || typeof entries !== 'object') {
      throw new RangeError('Perfil tático contém família inválida');
    }
    for (const [family, bias] of Object.entries(entries)) {
      if (!KNOWN_FAMILIES[kind as StrategyDecisionKind].has(family)) {
        throw new RangeError('Perfil tático contém família desconhecida');
      }
      validateBias(bias);
    }
  }
  for (const [optionId, bias] of Object.entries(profile.optionBias ?? {})) {
    if (!KNOWN_OPTION_IDS.has(optionId as StrategyOptionId)) {
      throw new RangeError('Perfil tático contém opção desconhecida');
    }
    validateBias(bias);
  }
}

function validateBias(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_TACTICAL_BIAS) {
    throw new RangeError(
      `Viés de perfil tático deve estar em [-${MAX_TACTICAL_BIAS}, ${MAX_TACTICAL_BIAS}]`,
    );
  }
}

export class OpponentBrain {
  decide(context: StrategyDecisionContext): StrategyProposal {
    validateContext(context);
    const athletes = localAthletes(context);
    const own = athletes.filter((athlete) => athlete.side === context.side);
    const opponents = athletes.filter((athlete) => athlete.side !== context.side);
    const ballRead = readVisibleBall(context);
    const localAttackOriginZ =
      context.attackOriginZ === undefined
        ? undefined
        : strategyToLocal({ x: 0, z: context.attackOriginZ }, context.side).z;
    let options = canonicalStrategyOptions(context.kind, { attackOriginZ: localAttackOriginZ });
    if (context.kind === 'set') {
      const quickOption = options.find((option) => option.optionId === 'set.quick-center');
      const frontRow = own.filter(
        (athlete) =>
          athlete.row === 'front' && athlete.id !== context.setterAthleteId && !athlete.airborne,
      );
      const central = quickOption
        ? (frontRow.find((athlete) => athlete.slot === 4) ??
          frontRow
            .slice()
            .sort(
              (a, b) =>
                distance(a.position, quickOption.center) -
                  distance(b.position, quickOption.center) || a.id - b.id,
            )[0])
        : undefined;
      const centralEta =
        central && quickOption
          ? athleteArrivalTime(central, quickOption.center)
          : Number.POSITIVE_INFINITY;
      const quickLegal =
        ballRead.reachable &&
        ballRead.eta >= QUICK_WINDOW.minEta &&
        ballRead.eta <= QUICK_WINDOW.maxEta &&
        ballRead.predictedHeight >= QUICK_WINDOW.minHeight &&
        ballRead.predictedHeight <= QUICK_WINDOW.maxHeight &&
        centralEta <= ballRead.eta + QUICK_WINDOW.arrivalSlack;
      if (!quickLegal)
        options = Object.freeze(options.filter((option) => option.family !== 'quick'));
    }

    const weights = SCORE_WEIGHTS[context.kind];
    const drafts: CandidateDraft[] = options.map((option) => {
      const components =
        context.kind === 'serve'
          ? serveComponents(option, opponents, context.memory, context.difficulty)
          : context.kind === 'set'
            ? setComponents(
                option,
                own,
                opponents,
                context.memory,
                ballRead.quality,
                context.difficulty,
                context.setterAthleteId!,
              )
            : attackComponents(
                option,
                opponents,
                context.memory,
                context.difficulty,
                localAttackOriginZ!,
              );
      return {
        option,
        components,
        score: clamp01(weightedScore(components, weights) + tacticalBias(context, option)),
        target: strategyToWorld(strategySubtarget(option, context.ticket.variation), context.side),
      };
    });
    if (drafts.length === 0) throw new Error('Nenhuma candidata estratégica legal');

    const probabilities = strategyProbabilitiesForScores(
      drafts.map((draft) => draft.score),
      context.kind,
      context.difficulty,
    );
    const candidates = Object.freeze(
      drafts.map((draft, index) =>
        Object.freeze({
          optionId: draft.option.optionId,
          kind: draft.option.kind,
          family: draft.option.family,
          target: draft.target,
          components: draft.components,
          score: draft.score,
          probability: probabilities[index],
        }),
      ),
    ) as readonly ScoredStrategyCandidate[];
    const chosen = candidates[chooseIndex(probabilities, context.ticket.selection)];
    return Object.freeze({
      kind: context.kind,
      side: context.side,
      observationTick: context.observation.tick,
      ticket: Object.freeze({ ...context.ticket }),
      candidates,
      chosen,
    });
  }
}
