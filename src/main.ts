import * as THREE from 'three';
import './style.css';
import { Court } from './world/Court';
import { Arena } from './world/Arena';
import { Crowd } from './world/Crowd';
import { Referee } from './world/Referee';
import { Effects } from './systems/Effects';
import { CameraDirector } from './systems/CameraDirector';
import { Match, type MatchStats } from './game/Match';
import { Input } from './core/Input';
import { AudioEngine } from './core/AudioEngine';
import { HUD } from './ui/HUD';
import { Menu } from './ui/Menu';
import { TouchControls } from './ui/TouchControls';
import { AppState, nextAppState } from './ui/appState';
import { COLORS, QUALITY_TIERS, SIMULATION_TIMING } from './core/constants';
import { QualityManager } from './core/quality/QualityManager';
import { exporDebugHabilitado } from './core/debug';
import { mapScreenToCourt } from './core/input/CameraSpaceMapper';
import { FixedStepRunner, type FixedStepDiscard } from './core/time/FixedStepRunner';
import { SlowMotionClock } from './core/time/SlowMotionClock';
import { Haptics } from './systems/Haptics';
import { PresentationFeedback } from './systems/PresentationFeedback';
import { detectMotionProfile } from './systems/camera/MotionProfile';
import { createSafeFrame } from './ui/SafeFrameLayout';
import type { SafeFrame, ScreenRect } from './systems/camera/CameraFrame';
import { parseSeed, RandomHub } from './core/random';
import { RallyJournal, type RallyJournalEntry } from './game/simulation/RallyJournal';
import type { SimulationTelemetryPort } from './game/simulation/SimulationTelemetry';
import {
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettingsStorage,
} from './core/audio/AudioSettings';
import { registerPwa, type PwaCoordinator } from './platform/PwaCoordinator';
import { bindAudioUnlock } from './platform/AudioUnlock';

const app = document.getElementById('app')!;
const loadingShell = document.getElementById('loading-shell');
let loadingShellRemoved = false;
function finishLoading(): void {
  if (loadingShellRemoved) return;
  loadingShellRemoved = true;
  loadingShell?.remove();
}
const debugWindow = window as unknown as {
  __match?: Match;
  __renderer?: THREE.WebGLRenderer;
  __controlFrame?: {
    simulationTick: number;
    screenAxis: { right: number; up: number };
    actionDown: boolean;
  };
  __selection?: ReturnType<Match['selectionSnapshot']>;
  __action?: ReturnType<Match['actionSnapshot']>;
  __feedback?: ReturnType<PresentationFeedback['snapshot']>;
  __cameraFrame?: ReturnType<CameraDirector['presentationSnapshot']>;
  __seed?: number;
  __random?: ReturnType<RandomHub['snapshot']>;
  __journal?: readonly Readonly<RallyJournalEntry>[];
  __journalHash?: string;
  __journalSerialized?: string;
  __readJournal?: () => {
    entries: readonly Readonly<RallyJournalEntry>[];
    hash: string | null;
    serialized: string | null;
  };
  __simulationClock?: {
    tick: number;
    simulationSeconds: number;
    alpha: number;
    discardedWallSeconds: number;
    discardedSimulationSeconds: number;
  };
};

// dispositivo de toque? (celular/tablet) — ?touch=1 força para testes no desktop
const isTouch =
  matchMedia('(pointer: coarse)').matches ||
  'ontouchstart' in window ||
  new URLSearchParams(location.search).has('touch');
if (isTouch) document.body.classList.add('touch');

function freshSeed(): number {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0]!;
  }
  return (Date.now() ^ Math.floor(performance.timeOrigin)) >>> 0;
}

const matchSeed = parseSeed(new URLSearchParams(location.search).get('seed')) ?? freshSeed();
const randomHub = new RandomHub(matchSeed);
const debugEnabled = exporDebugHabilitado({ dev: import.meta.env.DEV, search: location.search });
const autoplay = debugEnabled && new URLSearchParams(location.search).has('autoplay');
let debugJournal: RallyJournal | null = null;
const debugTelemetry: SimulationTelemetryPort | undefined = debugEnabled
  ? { emit: (event) => debugJournal?.emit(event) }
  : undefined;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.background);
scene.fog = new THREE.Fog(COLORS.background, 45, 90);

// ---------- mundo (qualidade reduzida no celular) ----------
const court = new Court();
const arena = new Arena(isTouch);
const crowd = new Crowd(arena);
const referee = new Referee();
const effects = new Effects();
scene.add(court.group, arena.group, crowd.mesh, referee.group, effects.group);

// ---------- tiers de qualidade (§10.1) ----------
// Tier inicial por capacidade (touch = médio); ?tier=0|1|2 força em DEV/?debug para testes.
const tierParam = debugEnabled
  ? Number(new URLSearchParams(location.search).get('tier'))
  : Number.NaN;
const initialTier =
  Number.isInteger(tierParam) && tierParam >= 0 && tierParam < QUALITY_TIERS.length
    ? tierParam
    : isTouch
      ? 1
      : 2;
const quality = new QualityManager(initialTier);
function applyQualityTier(tier: number): void {
  const q = QUALITY_TIERS[tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.dpr));
  arena.setShadowResolution(q.shadowRes);
  crowd.setQuality(q.crowdDensity, q.crowdTickHz);
  effects.particleScale = q.particleScale;
}
applyQualityTier(quality.tier);
let lastMatchStateForQuality = '';
let lastActiveForQuality = false;

const director = new CameraDirector(
  window.innerWidth / window.innerHeight,
  detectMotionProfile(window.matchMedia.bind(window)),
);
const input = new Input();
let audioStorage: AudioSettingsStorage | null = null;
try {
  audioStorage = window.localStorage;
} catch {
  // Safari privado/políticas corporativas podem bloquear até o getter do storage.
}
const audio = new AudioEngine(loadAudioSettings(audioStorage), () =>
  THREE.MathUtils.clamp(director.ballPos.z / 9, -0.65, 0.65),
);
saveAudioSettings(audioStorage, audio.settingsSnapshot());
bindAudioUnlock(document, audio);
const haptics = new Haptics();
const feedback = new PresentationFeedback([effects, audio, haptics]);
const hud = new HUD(app, isTouch);
audio.setCaptionSink(({ text, durationMs }) => hud.caption(text, durationMs));
const menu = new Menu(app, isTouch);
const touch = isTouch ? new TouchControls(app, input) : null;
window.addEventListener('blur', () => touch?.resetPointers());
hud.show(false);

const cameraOverlaySelectors = [
  '#scoreboard',
  '#hint',
  '#caption',
  '#meter',
  '#zones',
  '#tc-stick',
  '#tc-action',
] as const;
let cameraLayoutDirty = true;
let meterWasVisible = false;
let zonesWereVisible = false;
let cameraSafeFrame: Readonly<SafeFrame> = createSafeFrame(
  { width: window.innerWidth, height: window.innerHeight },
  { top: 0, right: 0, bottom: 0, left: 0 },
  [],
);

function markCameraLayoutDirty(): void {
  cameraLayoutDirty = true;
}

function measureCameraSafeFrame(): Readonly<SafeFrame> {
  const rootStyle = getComputedStyle(document.documentElement);
  const inset = (name: string) => Number.parseFloat(rootStyle.getPropertyValue(name)) || 0;
  const overlays: ScreenRect[] = [];
  for (const selector of cameraOverlaySelectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
      continue;
    const rect = element.getBoundingClientRect();
    overlays.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  return createSafeFrame(
    { width: window.innerWidth, height: window.innerHeight },
    {
      top: inset('--safe-area-top'),
      right: inset('--safe-area-right'),
      bottom: inset('--safe-area-bottom'),
      left: inset('--safe-area-left'),
    },
    overlays,
  );
}

// Gate de orientação (§7.1): a instrução de girar agora vive no menu de portrait (Fase 5A).
const portraitQuery = matchMedia('(orientation: portrait)');
let portraitBlocked = isTouch && portraitQuery.matches;

// ---------- tempo de simulação ----------
const slowMotionClock = new SlowMotionClock();
const fixedStepRunner = new FixedStepRunner(slowMotionClock);
function slowMo(scale: number, dur: number): void {
  slowMotionClock.trigger(scale, dur);
}

// ---------- estado do app (título → jogo → pausa → fim) ----------
let appState: AppState = 'title';
let pwaCoordinator: PwaCoordinator | null = null;
function activatePwaUpdateIfSafe(): void {
  pwaCoordinator?.activateUpdateIfSafe();
}

// ---------- partida ----------
const match = new Match(
  {
    banner: (t, s) => hud.banner(t, s),
    hint: (t) => {
      hud.hint(t);
      markCameraLayoutDirty();
    },
    setScore: (h, a, hs, as, n, sv) => {
      hud.setScore(h, a, hs, as, n, sv);
      markCameraLayoutDirty();
    },
    serveMeter: (v, val) => {
      hud.serveMeter(v, val);
      if (v !== meterWasVisible) {
        meterWasVisible = v;
        markCameraLayoutDirty();
      }
    },
    zoneHint: (z) => {
      hud.zoneHint(z);
      const visible = z !== null;
      if (visible !== zonesWereVisible) {
        zonesWereVisible = visible;
        markCameraLayoutDirty();
      }
    },
    slowMo,
    matchEnd: (homeWon, stats, scoreline) => {
      // fim da partida: trava o estado em 'ended' para o Escape não abrir a pausa
      // sobre a tela de vitória (sobrescreveria o innerHTML e travaria a UI).
      appState = nextAppState(appState, 'matchEnded');
      activatePwaUpdateIfSafe();
      updateTouchOrientationPresentation();
      hud.show(false);
      touch?.show(false);
      lastVictory = { homeWon, stats, scoreline };
      if (isTouch && !portraitBlocked) {
        // §7.1: em landscape o resultado é compacto e a revanche entra sozinha na contagem.
        menu.showVictoryCompact(homeWon, scoreline, rematchSeconds, startMatchFromMenu);
      } else {
        menu.showVictory(homeWon, stats, scoreline);
      }
      markCameraLayoutDirty();
    },
    feedback,
    audio,
    effects,
    camera: director,
    crowd,
    referee,
    arena,
  },
  { random: randomHub, telemetry: debugTelemetry, humanSide: autoplay ? null : undefined },
);
scene.add(match.group);

// ganchos de depuração globais: em dev sempre; no build de produção só com ?debug na URL
// (mesmo opt-in do ?touch=1), para não vazar a superfície de depuração no bundle publicado.
if (debugEnabled) {
  // acesso de depuração no console do browser
  debugWindow.__match = match;
  // hook de perf: expõe o renderer para o harness de baseline ler renderer.info.render
  // (draw calls / triângulos por frame). Só leitura; não altera o jogo.
  debugWindow.__renderer = renderer;
  debugWindow.__seed = matchSeed;
  debugWindow.__readJournal = () => ({
    entries: debugJournal?.entries ?? [],
    hash: debugJournal?.hash() ?? null,
    serialized: debugJournal?.serialize() ?? null,
  });
}

// Resultado da última partida (para reabrir o painel completo se girar durante a contagem).
let lastVictory: { homeWon: boolean; stats: MatchStats; scoreline: string } | null = null;
// Contagem de revanche (§7.1); ?rematch=N em DEV/?debug encurta para os E2E.
const rematchParam = debugEnabled
  ? Number(new URLSearchParams(location.search).get('rematch'))
  : Number.NaN;
const rematchSeconds =
  Number.isInteger(rematchParam) && rematchParam >= 1 && rematchParam <= 10 ? rematchParam : 5;

/** Início/reinício de partida com as configurações atuais do menu (in-place, sem reload). */
function startMatchFromMenu(): void {
  audio.uiClick();
  appState = nextAppState(appState, 'start');
  activatePwaUpdateIfSafe();
  hud.show(true);
  touch?.show(true);
  if (debugEnabled) {
    debugJournal = new RallyJournal({
      seed: matchSeed,
      difficulty: menu.difficulty,
      format: menu.format,
      simulationHz: SIMULATION_TIMING.hz,
    });
  }
  match.startMatch(menu.difficulty, menu.format);
  if (portraitBlocked) {
    cancelGameplayInput('portrait');
    audio.suspend();
    menu.showPortraitBreak();
  }
  updateTouchOrientationPresentation();
  markCameraLayoutDirty();
}
menu.onStart = startMatchFromMenu;
menu.onResume = () => {
  // botão CONTINUAR: o Menu já chamou hide(); aqui só destravamos o estado.
  match.snapPresentation();
  appState = nextAppState(appState, 'resume');
  activatePwaUpdateIfSafe();
  cancelGameplayInput(portraitBlocked ? 'portrait' : 'pause');
  updateTouchOrientationPresentation();
  audio.uiClick();
  audio.resume(); // retoma o áudio caso o contexto tenha sido suspenso durante a pausa
  markCameraLayoutDirty();
};

// §7.1: primeira abertura já na horizontal (touch) entra direto na partida rápida padrão —
// preferências salvas chegam com o save da Fase 6A; até lá, Normal + formato oficial.
// (O áudio pode nascer suspenso pela política de autoplay; o primeiro gesto o retoma.)
if (isTouch && !portraitBlocked) {
  menu.hide();
  startMatchFromMenu();
}

function togglePause(): void {
  if (appState !== 'playing' && appState !== 'paused') return;

  const previous = appState;
  appState = nextAppState(appState, 'togglePause');
  activatePwaUpdateIfSafe();
  if (appState === 'paused') {
    cancelGameplayInput('pause');
    audio.suspend();
    menu.showPause();
  } else if (previous === 'paused') {
    match.snapPresentation();
    menu.hide();
    audio.resume();
  }
  updateTouchOrientationPresentation();
  markCameraLayoutDirty();
}

function cancelGameplayInput(reason: 'pause' | 'portrait'): void {
  if (touch) touch.cancel(reason);
  else input.cancel(reason);
  match.cancelPendingAction(reason);
}

function updateTouchOrientationPresentation(): void {
  const blockingGameplay = portraitBlocked && appState === 'playing';
  document.body.classList.toggle('portrait-blocked', blockingGameplay);
}

function syncTouchOrientation(): void {
  const nextBlocked = isTouch && portraitQuery.matches;
  if (nextBlocked === portraitBlocked) return;
  portraitBlocked = nextBlocked;
  activatePwaUpdateIfSafe();

  if (appState === 'playing') {
    cancelGameplayInput('portrait');
    if (nextBlocked) {
      // §7.1: portrait pausa e vira área de menu (girar + novo jogo + sair), áudio suspenso.
      audio.suspend();
      menu.showPortraitBreak();
    } else {
      menu.hide();
      match.snapPresentation();
      audio.resume();
    }
  } else if (appState === 'ended' && nextBlocked && lastVictory) {
    // Girar durante a contagem de revanche interrompe a continuidade e abre o painel completo.
    menu.showVictory(lastVictory.homeWon, lastVictory.stats, lastVictory.scoreline);
  }
  updateTouchOrientationPresentation();
  markCameraLayoutDirty();
}
// Robustez além do resize: a media query de orientação notifica a rotação diretamente.
portraitQuery.addEventListener('change', syncTouchOrientation);

window.addEventListener('keydown', (e) => {
  // ignora auto-repeat (segurar Escape não deve piscar a pausa) e só alterna em jogo/pausa
  if (e.code === 'Escape' && !e.repeat) togglePause();
});

// o browser costuma suspender o AudioContext quando a aba vai para background (troca de app
// no celular, bloqueio de tela); ao voltar durante o jogo, retomamos para não ficar mudo.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && appState === 'playing') audio.resume();
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  director.camera.aspect = window.innerWidth / window.innerHeight;
  director.camera.updateProjectionMatrix();
  touch?.refreshLayout();
  syncTouchOrientation();
  markCameraLayoutDirty();
});

function discardStalledInput(discard: FixedStepDiscard): void {
  // Step-cap também ocorre em hardware lento: preserva estado contínuo e entrega suas bordas no
  // próximo tick. Wall-cap invalida somente ações/cargas antigas; direção mantida continua válida.
  if (discard.reason !== 'wall-cap') return;
  input.cancelAction('stall', discard.toMs);
  input.consumeUntil(discard.toMs);
  match.cancelPendingAction('stall');
}

// ---------- loop ----------
let lastPresentationNow = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const visualDt = Math.min(0.05, Math.max(0, (now - lastPresentationNow) / 1000));
  lastPresentationNow = Math.max(lastPresentationNow, now);

  // só o estado 'playing' avança a partida; título/pausa/fim congelam o tempo de jogo
  const active = appState === 'playing' && !portraitBlocked;
  const cameraBasis = director.inputBasis();
  const simulationFrame = fixedStepRunner.advance(now, {
    paused: !active,
    onDiscard: discardStalledInput,
    onTick: (ticket) => {
      const inputFrame = input.consumeUntil(ticket.inputThroughMs);
      const controlFrame = {
        ...inputFrame,
        simulationTick: ticket.tick,
        courtAxis: mapScreenToCourt(inputFrame.screenAxis, cameraBasis),
      };
      if (debugEnabled) debugWindow.__controlFrame = controlFrame;
      match.update(ticket.dt, controlFrame);
    },
  });

  // Menus/pausa/fim drenam bordas antigas sem entregá-las à simulação.
  if (!active) input.consumeUntil(now);
  match.present(active ? simulationFrame.alpha : 1);
  if (cameraLayoutDirty) {
    cameraSafeFrame = measureCameraSafeFrame();
    cameraLayoutDirty = false;
  }
  director.setFrame(match.cameraFrameSnapshot(), cameraSafeFrame);

  // Tiers: amostra o frame em jogo e só avalia troca ao ENTRAR no estado de ponto (§10.1).
  if (active) {
    if (!lastActiveForQuality) quality.resetWindow(); // início/retomada: descarta frames velhos
    quality.sampleFrame(visualDt);
    if (match.state === 'point' && lastMatchStateForQuality !== 'point') {
      const nextTier = quality.evaluateAtBreak();
      if (nextTier !== null) applyQualityTier(nextTier);
    }
    lastMatchStateForQuality = match.state;
  }
  lastActiveForQuality = active;

  const simulatedDt = simulationFrame.steps / SIMULATION_TIMING.hz;
  crowd.update(active ? simulatedDt : visualDt * 0.2);
  referee.update(simulatedDt);
  effects.update(simulatedDt);
  audio.update(visualDt);
  hud.update(visualDt);
  director.update(visualDt);

  if (debugEnabled) {
    debugWindow.__selection = match.selectionSnapshot();
    debugWindow.__action = match.actionSnapshot();
    debugWindow.__feedback = feedback.snapshot();
    debugWindow.__cameraFrame = director.presentationSnapshot();
    debugWindow.__random = randomHub.snapshot();
    debugWindow.__journal = debugJournal?.entries;
    debugWindow.__journalHash = debugJournal?.hash();
    debugWindow.__journalSerialized = debugJournal?.serialize();
    debugWindow.__simulationClock = {
      tick: simulationFrame.tick,
      simulationSeconds: simulationFrame.simulationSeconds,
      alpha: simulationFrame.alpha,
      discardedWallSeconds: simulationFrame.diagnostics.discardedWallSeconds,
      discardedSimulationSeconds: simulationFrame.diagnostics.discardedSimulationSeconds,
    };
  }

  renderer.render(scene, director.camera);
  finishLoading();
}

if (import.meta.env.PROD) {
  pwaCoordinator = registerPwa({
    state: () => ({ appState, portrait: portraitBlocked }),
    onUpdateReady: () => {
      document.documentElement.dataset.updateReady = 'true';
    },
    onOfflineReady: () => {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onError: () => {
      document.documentElement.dataset.offlineReady = 'false';
    },
  });
}

// Galeria de aceite do elenco (Fase 4C, DEV/?debug + ?gallery): cena própria no mesmo
// renderer, overlays ocultos; import dinâmico mantém o bundle de gameplay limpo.
const galleryEnabled = debugEnabled && new URLSearchParams(location.search).has('gallery');
if (galleryEnabled) {
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('div'))) {
    if (!el.querySelector('canvas')) el.style.display = 'none';
  }
  void import('./ui/galleryMode').then(({ startGalleryMode }) => {
    const galleryScene = new THREE.Scene();
    const galleryCamera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    const stepGallery = startGalleryMode(renderer, galleryScene, galleryCamera);
    window.addEventListener('resize', () => {
      galleryCamera.aspect = window.innerWidth / window.innerHeight;
      galleryCamera.updateProjectionMatrix();
    });
    let last = performance.now();
    const galleryFrame = (now: number): void => {
      requestAnimationFrame(galleryFrame);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      stepGallery(dt);
      finishLoading();
    };
    requestAnimationFrame(galleryFrame);
  });
} else {
  requestAnimationFrame(frame);
}
