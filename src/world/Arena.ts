import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, COURT } from '../core/constants';

// Ginásio: arquibancadas em 4 lados, iluminação de arena, placar suspenso, banners.
export class Arena {
  group = new THREE.Group();
  standsInfo: {
    origin: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
    rows: number;
    cols: number;
  }[] = [];
  private scoreCanvas!: HTMLCanvasElement;
  private scoreTex!: THREE.CanvasTexture;
  private keyLight!: THREE.DirectionalLight;

  constructor(private lowSpec = false) {
    this.buildStands();
    this.buildLights();
    this.buildScoreboard();
    this.buildAmbience();
  }

  // Arquibancadas: degraus de concreto; guarda posições p/ a torcida instanciada
  private buildStands(): void {
    const rows = 12;
    const stepH = 0.55,
      stepD = 0.9;
    const startDist = { long: COURT.halfWidth + 6.2, short: COURT.halfLength + 6.5 };
    const stepMat = new THREE.MeshStandardMaterial({ color: COLORS.arenaSteps, roughness: 0.95 });
    const faceMat = new THREE.MeshStandardMaterial({ color: COLORS.arenaFaces, roughness: 0.95 });

    // 2 laterais longas (±z) e 2 fundos (±x)
    const sides = [
      { axis: 'z' as const, sign: 1, len: 30, dist: startDist.long },
      { axis: 'z' as const, sign: -1, len: 30, dist: startDist.long },
      { axis: 'x' as const, sign: 1, len: 22, dist: startDist.short },
      { axis: 'x' as const, sign: -1, len: 22, dist: startDist.short },
    ];

    // Degraus mesclados por material (4E): 48 meshes viravam 48 draw calls estáticos; as
    // transforms são cozidas na geometria e sobram 2 meshes (um por material).
    const stepGeos: THREE.BufferGeometry[] = [];
    const faceGeos: THREE.BufferGeometry[] = [];
    for (const s of sides) {
      const rotY =
        s.axis === 'z' ? (s.sign > 0 ? 0 : Math.PI) : s.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
      const position =
        s.axis === 'z'
          ? new THREE.Vector3(0, 0, s.sign * s.dist)
          : new THREE.Vector3(s.sign * s.dist, 0, 0);
      const matrix = new THREE.Matrix4().makeRotationY(rotY).setPosition(position);
      for (let r = 0; r < rows; r++) {
        const geo = new THREE.BoxGeometry(s.len, stepH, stepD);
        geo.translate(0, r * stepH + stepH / 2, r * stepD + stepD / 2);
        geo.applyMatrix4(matrix);
        (r % 2 ? stepGeos : faceGeos).push(geo);
      }

      // registra info p/ Crowd: origem = 1ª fileira, right ao longo do comprimento, up = subida
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      this.standsInfo.push({
        origin: position.clone(),
        right,
        up: new THREE.Vector3(back.x * stepD, stepH, back.z * stepD),
        rows,
        cols: Math.floor(s.len / 0.75) - 2,
      });
    }
    for (const [geos, material] of [
      [stepGeos, stepMat],
      [faceGeos, faceMat],
    ] as const) {
      const merged = new THREE.Mesh(mergeGeometries(geos), material);
      merged.receiveShadow = true;
      this.group.add(merged);
      for (const geo of geos) geo.dispose();
    }

    // paredes do ginásio
    const wallMat = new THREE.MeshStandardMaterial({
      color: COLORS.arenaWall,
      roughness: 1,
      side: THREE.BackSide,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 22, 24, 1, true), wallMat);
    wall.position.y = 11;
    this.group.add(wall);
    const ceil = new THREE.Mesh(
      new THREE.CircleGeometry(38, 24),
      new THREE.MeshStandardMaterial({ color: COLORS.arenaCeiling, side: THREE.BackSide }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 21.9;
    this.group.add(ceil);

    // banners de publicidade ao redor da quadra
    const bannerTexts = ['PRÓ VOLEI', '★ SUPER LIGA ★', 'PONTO! SETS! GLÓRIA!', 'BEACH & INDOOR'];
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 1024;
    bannerCanvas.height = 64;
    const bc = bannerCanvas.getContext('2d')!;
    bc.fillStyle = '#10161f';
    bc.fillRect(0, 0, 1024, 64);
    bc.font = 'bold 34px Arial';
    bc.textBaseline = 'middle';
    let bx = 20;
    for (let i = 0; i < 6; i++) {
      const t = bannerTexts[i % bannerTexts.length];
      bc.fillStyle = ['#4fc3f7', '#ffd54f', '#ff8a65', '#aed581'][i % 4];
      bc.fillText(t, bx, 34);
      bx += bc.measureText(t).width + 90;
    }
    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    bannerTex.wrapS = THREE.RepeatWrapping;
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(28, 0.85), bannerMat);
      b.position.set(0, 0.45, sz * (COURT.halfWidth + 5.9));
      if (sz > 0) b.rotation.y = Math.PI;
      this.group.add(b);
    }
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(20, 0.85), bannerMat);
      b.position.set(sx * (COURT.halfLength + 6.2), 0.45, 0);
      b.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(b);
    }
  }

  private buildLights(): void {
    // luz ambiente + hemisférica de ginásio
    this.group.add(new THREE.AmbientLight(0xffffff, 0.45));
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x25333f, 0.5);
    this.group.add(hemi);

    // principal com sombras
    const key = new THREE.DirectionalLight(0xfff4e0, 1.9);
    this.keyLight = key;
    key.position.set(12, 24, 10);
    key.castShadow = true;
    const shadowRes = this.lowSpec ? 1024 : 2048;
    key.shadow.mapSize.set(shadowRes, shadowRes);
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.camera.far = 60;
    key.shadow.bias = -0.0005;
    this.group.add(key);

    const fill = new THREE.DirectionalLight(0xd6e8ff, 0.5);
    fill.position.set(-14, 18, -12);
    this.group.add(fill);

    // contra-luz fria (rim) sem sombra: recorta as atletas do fundo, estilo transmissão.
    const rim = new THREE.DirectionalLight(0x9fd8d2, 0.35);
    rim.position.set(0, 14, -20);
    this.group.add(rim);

    // refletores decorativos no teto
    const spotGeo = new THREE.CylinderGeometry(0.4, 0.55, 0.5, 12);
    const spotMat = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rig = new THREE.Group();
      const body = new THREE.Mesh(spotGeo, spotMat);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12), glowMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.26;
      rig.add(body, lens);
      rig.position.set(Math.cos(a) * 14, 20.5, Math.sin(a) * 14);
      this.group.add(rig);
    }
  }

  // Placar 3D suspenso no centro — atualizado via canvas
  /** Redimensiona o shadow map da key light em runtime (tiers de qualidade, 4E). */
  setShadowResolution(resolution: number): void {
    const shadow = this.keyLight.shadow;
    if (shadow.mapSize.x === resolution) return;
    shadow.mapSize.set(resolution, resolution);
    shadow.map?.dispose();
    shadow.map = null;
  }

  private buildScoreboard(): void {
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 512;
    this.scoreCanvas.height = 256;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.updateScoreboard(0, 0, 0, 0, 1);

    const boxMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.4 });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.7, 5.2), boxMat);
    cube.position.y = 16;
    this.group.add(cube);
    const faceMat = new THREE.MeshBasicMaterial({ map: this.scoreTex });
    for (let i = 0; i < 4; i++) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.4), faceMat);
      const a = (i * Math.PI) / 2;
      face.position.set(Math.sin(a) * 2.62, 16, Math.cos(a) * 2.62);
      face.rotation.y = a;
      this.group.add(face);
    }
    // cabo
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 4.5, 6),
      new THREE.MeshBasicMaterial({ color: 0x555555 }),
    );
    cable.position.y = 19.6;
    this.group.add(cable);
  }

  updateScoreboard(hs: number, as: number, hSets: number, aSets: number, setNum: number): void {
    const c = this.scoreCanvas.getContext('2d')!;
    c.fillStyle = '#060a10';
    c.fillRect(0, 0, 512, 256);
    c.textAlign = 'center';
    c.fillStyle = '#8fa3b8';
    c.font = 'bold 28px Arial';
    c.fillText(`SET ${setNum}`, 256, 40);
    c.fillStyle = '#4f8fe8';
    c.font = 'bold 30px Arial';
    c.fillText('VOCÊ', 128, 88);
    c.fillStyle = '#e85a4f';
    c.fillText('CPU', 384, 88);
    c.fillStyle = '#ffe14f';
    c.font = 'bold 96px Arial';
    c.fillText(String(hs), 128, 185);
    c.fillText(String(as), 384, 185);
    c.fillStyle = '#8fa3b8';
    c.font = 'bold 26px Arial';
    c.fillText(`SETS  ${hSets} — ${aSets}`, 256, 235);
    this.scoreTex.needsUpdate = true;
  }

  private buildAmbience(): void {
    // tapetes de proteção coloridos nos cantos da zona livre (detalhe visual)
    const matA = new THREE.MeshStandardMaterial({ color: COLORS.bannerWall, roughness: 0.95 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), matA);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(sx * (COURT.halfLength + 3.4), 0.001, sz * (COURT.halfWidth + 3.2));
        this.group.add(pad);
      }
  }
}
