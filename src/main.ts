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

const app = document.getElementById('app')!;

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
const crowd = new Crowd(arena, isTouch ? 0.55 : 1);
const referee = new Referee();
const effects = new Effects();
scene.add(court.group, arena.group, crowd.mesh, referee.group, effects.group);

const director = new CameraDirector(window.innerWidth / window.innerHeight);
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD(app, isTouch);
const menu = new Menu(app, isTouch);
const touch = isTouch ? new TouchControls(app, () => director.mode) : null;
hud.show(false);

// aviso para jogar na horizontal
const rotateTip = document.createElement('div');
rotateTip.id = 'rotate-tip';
rotateTip.textContent = '↻ Gire o celular — o jogo é melhor na horizontal';
app.appendChild(rotateTip);

// ---------- slow motion ----------
let timeScale = 1;
let slowMoLeft = 0;
function slowMo(scale: number, dur: number): void {
  timeScale = scale;
  slowMoLeft = dur;
}

// ---------- partida ----------
const match = new Match({
  banner: (t, s) => hud.banner(t, s),
  hint: (t) => hud.hint(t),
  setScore: (h, a, hs, as, n, sv) => hud.setScore(h, a, hs, as, n, sv),
  serveMeter: (v, val) => hud.serveMeter(v, val),
  zoneHint: (z) => hud.zoneHint(z),
  slowMo,
  matchEnd: (homeWon, stats, scoreline) => {
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

// acesso de depuração no console do browser
(window as unknown as { __match: Match }).__match = match;

let playing = false;
let paused = false;

menu.onStart = () => {
  audio.init();
  audio.uiClick();
  playing = true;
  hud.show(true);
  touch?.show(true);
  match.startMatch(menu.difficulty, menu.format);
};
menu.onResume = () => {
  paused = false;
  audio.uiClick();
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && playing) {
    paused = !paused;
    if (paused) menu.showPause();
    else menu.hide();
  }
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  director.camera.aspect = window.innerWidth / window.innerHeight;
  director.camera.updateProjectionMatrix();
});

// ---------- loop ----------
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // recuperação do slow motion
  if (slowMoLeft > 0) {
    slowMoLeft -= rawDt;
    if (slowMoLeft <= 0) timeScale = 1;
  } else if (timeScale < 1) {
    timeScale = Math.min(1, timeScale + rawDt * 3);
  }

  const dt = rawDt * (paused ? 0 : timeScale);

  if (playing && !paused) {
    match.update(dt, input);
  }
  crowd.update(dt > 0 ? dt : rawDt * 0.2);
  referee.update(dt);
  effects.update(dt);
  audio.update(rawDt);
  hud.update(rawDt);
  director.update(rawDt);

  input.endFrame();
  renderer.render(scene, director.camera);
}
requestAnimationFrame(frame);
