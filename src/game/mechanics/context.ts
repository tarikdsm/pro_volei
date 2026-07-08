// Contexto injetado nas funções de mecânica (mechanics/*): a fatia do Match que elas
// precisam — bola, estado do rally, hooks, tuning e alguns callbacks — sem que elas
// conheçam o Match inteiro. O Match fornece este objeto (ver Match.makeCtx).
import * as THREE from 'three';
import { TeamSide, Difficulty, TouchKind } from '../../core/constants';
import { Ball } from '../../entities/Ball';
import { Team } from '../Team';
import { RallyState } from '../RallyState';
import type { Hooks, MatchStats } from '../Match';

export interface MechanicsCtx {
  ball: Ball;
  rally: RallyState;
  hooks: Hooks;
  diff: Difficulty;
  servingTeam: TeamSide; // leitura (saque)
  aim: THREE.Vector3; // leitura (cortada humana)
  chosenZone: number; // leitura (levantamento humano)
  stats: MatchStats; // escrita (stats.blocks no bloqueio)
  teamOf(side: TeamSide): Team;
  after(t: number, fn: () => void): void;
  planNext(kind: TouchKind): void;
}
