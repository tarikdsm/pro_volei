// Galeria determinística de aceite do elenco (Fase 4C, DEV-only via ?gallery): as 12 atletas
// em duas fileiras, ciclo fixo de poses por relógio acumulado — para screenshots comparáveis
// nos viewports do design (§5.3). Não participa do bundle de gameplay além do branch no boot.
import * as THREE from 'three';
import { COLORS } from '../core/constants';
import type { CharAction } from '../entities/PlayerCharacter';
import { RiggedCharacter } from '../entities/rig/RiggedCharacter';
import { AWAY_ROSTER, HOME_ROSTER } from '../entities/rig/roster';

const POSE_CYCLE: readonly CharAction[] = ['idle', 'run', 'bump', 'spikeWindup'];
const SECONDS_PER_POSE = 2;

/** Monta a cena da galeria e devolve o passo de animação (dt em segundos). */
export function startGalleryMode(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): (dt: number) => void {
  scene.background = new THREE.Color(0x141c26);
  scene.fog = null;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f4256, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.6);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  const characters: RiggedCharacter[] = [];
  const rows: Array<{ roster: typeof HOME_ROSTER; jersey: number; shorts: number; z: number }> = [
    { roster: HOME_ROSTER, jersey: COLORS.homeJersey, shorts: COLORS.homeShorts, z: 1.6 },
    { roster: AWAY_ROSTER, jersey: COLORS.awayJersey, shorts: COLORS.awayShorts, z: -1.6 },
  ];
  rows.forEach((row, rowIndex) => {
    row.roster.forEach((entry, index) => {
      const char = new RiggedCharacter({ jersey: row.jersey, shorts: row.shorts, ...entry });
      // Colunas intercaladas: a fileira de trás aparece nos vãos da fileira da frente.
      char.root.position.set((index - 2.5) * 1.15 + rowIndex * 0.55, 0, row.z);
      scene.add(char.root);
      characters.push(char);
    });
  });

  camera.position.set(0, 2.8, 7.0);
  camera.lookAt(0, 0.9, 0);

  let clock = 0;
  return (dt: number) => {
    clock += dt;
    const pose = POSE_CYCLE[Math.floor(clock / SECONDS_PER_POSE) % POSE_CYCLE.length];
    for (const char of characters) {
      char.setAction(pose);
      char.moveSpeed = pose === 'run' ? 4 : 0;
      char.setPlanarMotion(pose === 'run' ? 4 : 0, 0, false);
      char.update(dt);
    }
    renderer.render(scene, camera);
  };
}
