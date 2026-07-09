import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { meshCastsShadow } from './PlayerCharacter';

// O construtor real de PlayerCharacter usa document/canvas (makeJerseyTexture) e
// THREE.CanvasTexture, indisponíveis em Node. Por isso testamos só o predicado puro
// meshCastsShadow e reproduzimos manualmente o traverse do construtor — sem WebGL/DOM.
const geo = new THREE.BoxGeometry(1, 1, 1);

describe('meshCastsShadow', () => {
  it('exclui plano decorativo (MeshBasicMaterial) do shadow pass', () => {
    const estampa = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
    expect(meshCastsShadow(estampa)).toBe(false);
  });

  it('mantém corpo sólido (MeshStandardMaterial) projetando sombra', () => {
    const corpo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    expect(meshCastsShadow(corpo)).toBe(true);
  });

  it('array de materiais: basta um MeshBasicMaterial para excluir', () => {
    const misto = new THREE.Mesh(geo, [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    expect(meshCastsShadow(misto)).toBe(false);
  });
});

// Regressão do propósito: reproduz o traverse do construtor sobre um grupo montado à mão
// (corpo sólido + estampa transparente) e garante que só a estampa sai do shadow pass.
describe('traverse de castShadow do personagem', () => {
  it('liga sombra no corpo e desliga na estampa', () => {
    const grupo = new THREE.Group();
    const corpo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    const estampa = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
    grupo.add(corpo);
    grupo.add(estampa);

    grupo.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = meshCastsShadow(o);
    });

    expect(corpo.castShadow).toBe(true);
    expect(estampa.castShadow).toBe(false);
  });
});
