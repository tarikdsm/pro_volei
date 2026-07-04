import * as THREE from 'three';
import { COURT, COLORS } from '../core/constants';

// Quadra oficial: piso taraflex com linhas, zona livre, rede com postes e antenas.
export class Court {
  group = new THREE.Group();

  constructor() {
    this.buildFloor();
    this.buildLines();
    this.buildNet();
  }

  private buildFloor(): void {
    const { halfLength, halfWidth, freeZone } = COURT;

    // zona livre (base maior)
    const freeGeo = new THREE.PlaneGeometry((halfLength + freeZone) * 2, (halfWidth + freeZone) * 2);
    const freeMat = new THREE.MeshStandardMaterial({ color: COLORS.floorFree, roughness: 0.85 });
    const free = new THREE.Mesh(freeGeo, freeMat);
    free.rotation.x = -Math.PI / 2;
    free.position.y = -0.01;
    free.receiveShadow = true;
    this.group.add(free);

    // quadra de jogo com leve variação de tom entre os lados da linha de 3m
    const courtMat = new THREE.MeshStandardMaterial({ color: COLORS.floorCourt, roughness: 0.65 });
    const court = new THREE.Mesh(new THREE.PlaneGeometry(halfLength * 2, halfWidth * 2), courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.0;
    court.receiveShadow = true;
    this.group.add(court);

    // faixas da zona de ataque (tom levemente diferente)
    const zoneMat = new THREE.MeshStandardMaterial({ color: 0xdd7c3d, roughness: 0.65 });
    for (const s of [-1, 1]) {
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(COURT.attackLine, halfWidth * 2), zoneMat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(s * COURT.attackLine * 0.5, 0.002, 0);
      zone.receiveShadow = true;
      this.group.add(zone);
    }
  }

  private buildLines(): void {
    const { halfLength, halfWidth, attackLine } = COURT;
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.lines });
    const w = 0.05; // largura da linha
    const y = 0.005;

    const addLine = (cx: number, cz: number, lx: number, lz: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      this.group.add(m);
    };

    // laterais e fundos
    addLine(0, -halfWidth, halfLength * 2 + w, w);
    addLine(0, halfWidth, halfLength * 2 + w, w);
    addLine(-halfLength, 0, w, halfWidth * 2 + w);
    addLine(halfLength, 0, w, halfWidth * 2 + w);
    // linha central
    addLine(0, 0, w, halfWidth * 2);
    // linhas de ataque (3m)
    addLine(-attackLine, 0, w, halfWidth * 2);
    addLine(attackLine, 0, w, halfWidth * 2);
  }

  private buildNet(): void {
    const { halfWidth, netHeight } = COURT;
    const postH = netHeight + 0.35;
    const bandH = 0.07;
    const netTopY = netHeight;
    const netBottomY = netHeight - 1.0;

    // malha da rede — textura procedural em canvas
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 64);
    c.strokeStyle = 'rgba(240,240,240,0.9)';
    c.lineWidth = 1.5;
    for (let x = 0; x <= 256; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 64); c.stroke(); }
    for (let y = 0; y <= 64; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke(); }
    const netTex = new THREE.CanvasTexture(canvas);
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(6, 1);

    const netMat = new THREE.MeshBasicMaterial({
      map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 2 + 1.0, netTopY - netBottomY), netMat,
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, (netTopY + netBottomY) / 2, 0);
    this.group.add(net);

    // banda superior branca
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, bandH, halfWidth * 2 + 1.0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    );
    band.position.set(0, netTopY - bandH / 2 + 0.02, 0);
    band.castShadow = true;
    this.group.add(band);

    // postes
    const postMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.4, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, postH, 12), postMat);
      post.position.set(0, postH / 2, s * (halfWidth + 0.8));
      post.castShadow = true;
      this.group.add(post);
      // proteção acolchoada
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.7, 12),
        new THREE.MeshStandardMaterial({ color: s < 0 ? 0x1565e8 : 0xe53935, roughness: 0.9 }),
      );
      pad.position.set(0, 0.85, s * (halfWidth + 0.8));
      this.group.add(pad);

      // antenas (vermelho/branco)
      const antenna = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.11, 6),
          new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0xd32f2f }),
        );
        seg.position.y = i * 0.11;
        antenna.add(seg);
      }
      antenna.position.set(0, netTopY, s * halfWidth);
      this.group.add(antenna);
    }

    // cadeira do juiz (ao lado do poste, lado -z)
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 });
    const stand = new THREE.Group();
    const pole1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), chairMat);
    pole1.position.set(-0.25, 1.05, 0);
    const pole2 = pole1.clone(); pole2.position.x = 0.25;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.6), chairMat);
    seat.position.set(0, 2.1, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.06), chairMat);
    back.position.set(0, 2.4, -0.27);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.5), chairMat);
    deck.position.set(0, 1.55, 0.28);
    stand.add(pole1, pole2, seat, back, deck);
    stand.position.set(0, 0, -(halfWidth + 1.55));
    stand.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.group.add(stand);
  }
}
