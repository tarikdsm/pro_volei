import * as THREE from 'three';
import './style.css';
import { Court } from './world/Court';
import { Arena } from './world/Arena';
import { Crowd } from './world/Crowd';
import { Referee } from './world/Referee';
import { Effects } from './systems/Effects';
import { CameraDirector } from './systems/CameraDirector';
import { Match } from './game/Match';
import { Input } from './core/Input';
import { AudioEngine } from './core/AudioEngine';
import { HUD } from './ui/HUD';
import { Menu } from './ui/Menu';
import { TouchControls } from './ui/TouchControls';
import { AppState, nextAppState } from './ui/appState';
import { CROWD, SIMULATION_TIMING } from './core/constants';
import { exporDebugHabilitado } from './core/debug';
import { mapScreenToCourt } from './core/input/CameraSpaceMapper';
import { FixedStepRunner, type FixedStepDiscard } from './core/time/FixedStepRunner';
import { SlowMotionClock } from './core/time/SlowMotionClock';

const app = document.getElementById('app')!;
const debugWindow = window as unknown as {
  __match?: Match;
  __renderer?: THREE.WebGLRenderer;
  __controlFrame?: { screenAxis: { right: number; up: number }; actionDown: boolean };
  __selection?: ReturnType<Match['selectionSnapshot']>;
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
scene.background = new THREE.Color(0x0e151f);
scene.fog = new THREE.Fog(0x0e151f, 45, 90);

// ---------- mundo (qualidade reduzida no celular) ----------
const court = new Court();
const arena = new Arena(isTouch);
const crowd = new Crowd(
  arena,
  isTouch ? CROWD.densityLow : CROWD.density,
  isTouch ? CROWD.tickHzLow : CROWD.tickHz,
);
const referee = new Referee();
const effects = new Effects();
scene.add(court.group, arena.group, crowd.mesh, referee.group, effects.group);

const director = new CameraDirector(window.innerWidth / window.innerHeight);
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD(app, isTouch);
const menu = new Menu(app, isTouch);
const touch = isTouch ? new TouchControls(app, input, togglePause) : null;
window.addEventListener('blur', () => touch?.resetPointers());
hud.show(false);

// aviso para jogar na horizontal
const rotateTip = document.createElement('div');
rotateTip.id = 'rotate-tip';
rotateTip.textContent = '↻ Gire o celular — o jogo é melhor na horizontal';
app.appendChild(rotateTip);

// ---------- tempo de simulação ----------
const slowMotionClock = new SlowMotionClock();
const fixedStepRunner = new FixedStepRunner(slowMotionClock);
function slowMo(scale: number, dur: number): void {
  slowMotionClock.trigger(scale, dur);
}

// ---------- estado do app (título → jogo → pausa → fim) ----------
let appState: AppState = 'title';

// ---------- partida ----------
const match = new Match({
  banner: (t, s) => hud.banner(t, s),
  hint: (t) => hud.hint(t),
  setScore: (h, a, hs, as, n, sv) => hud.setScore(h, a, hs, as, n, sv),
  serveMeter: (v, val) => hud.serveMeter(v, val),
  zoneHint: (z) => hud.zoneHint(z),
  slowMo,
  matchEnd: (homeWon, stats, scoreline) => {
    // fim da partida: trava o estado em 'ended' para o Escape não abrir a pausa
    // sobre a tela de vitória (sobrescreveria o innerHTML e travaria a UI).
    appState = nextAppState(appState, 'matchEnded');
    hud.show(false);
    touch?.show(false);
    menu.showVictory(homeWon, stats, scoreline);
  },
  audio,
  effects,
  camera: director,
  crowd,
  referee,
  arena,
});
scene.add(match.group);

// ganchos de depuração globais: em dev sempre; no build de produção só com ?debug na URL
// (mesmo opt-in do ?touch=1), para não vazar a superfície de depuração no bundle publicado.
const debugEnabled = exporDebugHabilitado({ dev: import.meta.env.DEV, search: location.search });
if (debugEnabled) {
  // acesso de depuração no console do browser
  debugWindow.__match = match;
  // hook de perf: expõe o renderer para o harness de baseline ler renderer.info.render
  // (draw calls / triângulos por frame). Só leitura; não altera o jogo.
  debugWindow.__renderer = renderer;
}

menu.onStart = () => {
  audio.init();
  audio.uiClick();
  appState = nextAppState(appState, 'start');
  hud.show(true);
  touch?.show(true);
  match.startMatch(menu.difficulty, menu.format);
};
menu.onResume = () => {
  // botão CONTINUAR: o Menu já chamou hide(); aqui só destravamos o estado.
  match.snapPresentation();
  appState = nextAppState(appState, 'resume');
  audio.uiClick();
  audio.resume(); // retoma o áudio caso o contexto tenha sido suspenso durante a pausa
};

function togglePause(): void {
  if (appState !== 'playing' && appState !== 'paused') return;

  const previous = appState;
  appState = nextAppState(appState, 'togglePause');
  if (appState === 'paused') {
    if (touch) touch.cancel('pause');
    else input.cancel('pause');
    match.cancelPendingAction();
    menu.showPause();
  } else if (previous === 'paused') {
    match.snapPresentation();
    menu.hide();
    audio.resume();
  }
}

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
});

function discardStalledInput(discard: FixedStepDiscard): void {
  // Step-cap também ocorre em hardware lento: preserva estado contínuo e entrega suas bordas no
  // próximo tick. Wall-cap invalida somente ações/cargas antigas; direção mantida continua válida.
  if (discard.reason !== 'wall-cap') return;
  input.cancelAction('stall', discard.toMs);
  input.consumeUntil(discard.toMs);
  match.cancelPendingAction();
}

// ---------- loop ----------
let lastPresentationNow = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const visualDt = Math.min(0.05, Math.max(0, (now - lastPresentationNow) / 1000));
  lastPresentationNow = Math.max(lastPresentationNow, now);

  // só o estado 'playing' avança a partida; título/pausa/fim congelam o tempo de jogo
  const active = appState === 'playing';
  const cameraBasis = director.inputBasis();
  const simulationFrame = fixedStepRunner.advance(now, {
    paused: !active,
    onDiscard: discardStalledInput,
    onTick: (ticket) => {
      const inputFrame = input.consumeUntil(ticket.inputThroughMs);
      const controlFrame = {
        ...inputFrame,
        courtAxis: mapScreenToCourt(inputFrame.screenAxis, cameraBasis),
      };
      if (debugEnabled) debugWindow.__controlFrame = controlFrame;
      match.update(ticket.dt, controlFrame);
    },
  });

  // Menus/pausa/fim drenam bordas antigas sem entregá-las à simulação.
  if (!active) input.consumeUntil(now);
  match.present(active ? simulationFrame.alpha : 1);

  const simulatedDt = simulationFrame.steps / SIMULATION_TIMING.hz;
  crowd.update(active ? simulatedDt : visualDt * 0.2);
  referee.update(simulatedDt);
  effects.update(simulatedDt);
  audio.update(visualDt);
  hud.update(visualDt);
  director.update(visualDt);

  if (debugEnabled) {
    debugWindow.__selection = match.selectionSnapshot();
    debugWindow.__simulationClock = {
      tick: simulationFrame.tick,
      simulationSeconds: simulationFrame.simulationSeconds,
      alpha: simulationFrame.alpha,
      discardedWallSeconds: simulationFrame.diagnostics.discardedWallSeconds,
      discardedSimulationSeconds: simulationFrame.diagnostics.discardedSimulationSeconds,
    };
  }

  renderer.render(scene, director.camera);
}
requestAnimationFrame(frame);
