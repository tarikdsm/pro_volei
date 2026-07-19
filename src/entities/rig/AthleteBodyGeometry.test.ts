import { describe, expect, it } from 'vitest';
import { buildAthleteSkeleton } from './AthleteSkeleton';
import { buildAthleteBodyParts } from './AthleteBodyGeometry';

describe('buildAthleteBodyParts', () => {
  const rig = buildAthleteSkeleton();

  it('produz as cinco regiões com skinning rígido válido', () => {
    const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: 'ponytail' });
    expect(parts.map((part) => part.region).sort()).toEqual([
      'hair',
      'jersey',
      'shoes',
      'shorts',
      'skin',
    ]);
    for (const part of parts) {
      const skinIndex = part.geometry.getAttribute('skinIndex');
      const skinWeight = part.geometry.getAttribute('skinWeight');
      const position = part.geometry.getAttribute('position');
      expect(skinIndex.count).toBe(position.count);
      expect(skinWeight.count).toBe(position.count);
      for (let i = 0; i < position.count; i += 1) {
        expect(skinWeight.getX(i)).toBe(1); // rígido: 100% num único osso
        expect(skinIndex.getX(i)).toBeGreaterThanOrEqual(0);
        expect(skinIndex.getX(i)).toBeLessThan(20);
      }
    }
  });

  it('penteados pendentes têm vértices skinnados no hairTail', () => {
    for (const hairstyle of ['ponytail', 'braid', 'long'] as const) {
      const rig = buildAthleteSkeleton();
      const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle });
      const hair = parts.find((p) => p.region === 'hair')!;
      const skinIndex = hair.geometry.getAttribute('skinIndex');
      let tailVerts = 0;
      for (let i = 0; i < skinIndex.count; i += 1) {
        if (skinIndex.getX(i) === rig.boneIndex.hairTail) tailVerts += 1;
      }
      expect(tailVerts, hairstyle).toBeGreaterThan(0);
    }
  });

  it('coque e curto permanecem 100% na cabeça', () => {
    for (const hairstyle of ['bun', 'short'] as const) {
      const rig = buildAthleteSkeleton();
      const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle });
      const hair = parts.find((p) => p.region === 'hair')!;
      const skinIndex = hair.geometry.getAttribute('skinIndex');
      for (let i = 0; i < skinIndex.count; i += 1) {
        expect(skinIndex.getX(i)).toBe(rig.boneIndex.head);
      }
    }
  });

  it('fica dentro do orçamento de triângulos por atleta', () => {
    const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: 'long' });
    const triangles = parts.reduce((sum, part) => {
      const index = part.geometry.getIndex();
      const count = index ? index.count : part.geometry.getAttribute('position').count;
      return sum + count / 3;
    }, 0);
    expect(triangles).toBeGreaterThan(500); // sanidade: não é um corpo vazio
    expect(triangles).toBeLessThanOrEqual(4500);
  });

  it.each(['short', 'long', 'ponytail', 'bun', 'braid'] as const)(
    '%s tem geometria de cabelo própria',
    (h) => {
      const parts = buildAthleteBodyParts(rig.boneIndex, { hairstyle: h });
      const hair = parts.find((part) => part.region === 'hair')!;
      expect(hair.geometry.getAttribute('position').count).toBeGreaterThan(0);
    },
  );

  it('corpo alto e forte continua no orçamento e mais alto que o base', () => {
    const tall = buildAthleteBodyParts(rig.boneIndex, {
      hairstyle: 'short',
      heightScale: 1.06,
      buildScale: 1.1,
    });
    const triangles = tall.reduce((sum, part) => {
      const index = part.geometry.getIndex();
      const count = index ? index.count : part.geometry.getAttribute('position').count;
      return sum + count / 3;
    }, 0);
    expect(triangles).toBeLessThanOrEqual(4500);
    const maxY = (parts: typeof tall) =>
      Math.max(
        ...parts.map((part) => {
          part.geometry.computeBoundingBox();
          return part.geometry.boundingBox!.max.y;
        }),
      );
    const base = buildAthleteBodyParts(rig.boneIndex, { hairstyle: 'short' });
    expect(maxY(tall)).toBeGreaterThan(maxY(base) * 1.03);
  });
});
