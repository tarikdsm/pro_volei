import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrailBuffer } from './TrailBuffer';

// helper: cria um vetor a partir de um escalar (x=y=z=n) para facilitar as asserções
function v(n: number): THREE.Vector3 {
  return new THREE.Vector3(n, n, n);
}

describe('TrailBuffer', () => {
  it('push abaixo da capacidade cresce length e preserva ordem', () => {
    const buf = new TrailBuffer(26);
    buf.push(v(1));
    buf.push(v(2));
    buf.push(v(3));
    expect(buf.length).toBe(3);
    expect(buf.at(0).x).toBe(1); // mais antigo
    expect(buf.at(2).x).toBe(3); // mais recente
  });

  it('push não aliasa o vetor de origem (usa .copy)', () => {
    const buf = new TrailBuffer(26);
    const src = v(1);
    buf.push(src);
    src.set(99, 99, 99); // muta a origem depois do push
    expect(buf.at(0).x).toBe(1); // valor original preservado
  });

  it('ao encher, sobrescreve o mais antigo (FIFO cap)', () => {
    const buf = new TrailBuffer(26);
    for (let i = 0; i < 28; i++) buf.push(v(i));
    expect(buf.length).toBe(26);
    expect(buf.at(0).x).toBe(2); // v[2] = 3º inserido
    expect(buf.at(25).x).toBe(27); // v[27] = 28º inserido
  });

  it('shift remove o mais antigo e faz fade', () => {
    const buf = new TrailBuffer(26);
    for (let i = 1; i <= 5; i++) buf.push(v(i));
    buf.shift();
    expect(buf.length).toBe(4);
    expect(buf.at(0).x).toBe(2); // 2º inserido virou o mais antigo
  });

  it('shift em buffer vazio não lança e mantém length 0', () => {
    const buf = new TrailBuffer(26);
    expect(() => buf.shift()).not.toThrow();
    expect(buf.length).toBe(0);
  });

  it('at retorna referência estável enquanto não houver push/shift', () => {
    const buf = new TrailBuffer(26);
    buf.push(v(1));
    buf.push(v(2));
    expect(buf.at(0)).toBe(buf.at(0)); // mesma instância
    expect(buf.at(1)).toBe(buf.at(1));
  });

  it('wrap-around de índices físicos mantém ordem e capacidade', () => {
    const buf = new TrailBuffer(26);
    // push*30 (sobrescreve os 4 primeiros: restam v[4]..v[29])
    for (let i = 0; i < 30; i++) buf.push(v(i));
    expect(buf.length).toBe(26);
    expect(buf.at(0).x).toBe(4);
    // shift*10 (remove v[4]..v[13]: restam v[14]..v[29])
    for (let i = 0; i < 10; i++) buf.shift();
    expect(buf.length).toBe(16);
    expect(buf.at(0).x).toBe(14);
    // push*5 (adiciona v[100]..v[104] no fim)
    for (let i = 0; i < 5; i++) buf.push(v(100 + i));
    expect(buf.length).toBe(21);
    expect(buf.at(0).x).toBe(14); // ordem preservada no início
    expect(buf.at(20).x).toBe(104); // último inserido no fim
  });

  it('capacity reflete o valor do construtor', () => {
    expect(new TrailBuffer(26).capacity).toBe(26);
    expect(new TrailBuffer(8).capacity).toBe(8);
  });

  it('clear zera o length', () => {
    const buf = new TrailBuffer(26);
    buf.push(v(1));
    buf.push(v(2));
    buf.clear();
    expect(buf.length).toBe(0);
  });
});
