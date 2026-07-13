// Contexto injetado nas funções de mecânica (mechanics/*): a fatia do Match que elas
// precisam — bola, estado do rally, hooks, tuning e alguns callbacks — sem que elas
// conheçam o Match inteiro. O Match fornece este objeto (ver Match.makeCtx).
import * as THREE from 'three';
import { TeamSide, Difficulty, TouchKind } from '../../core/constants';
import type { BallSimulationPort } from '../simulation/BallSimulationPort';
import { Team } from '../Team';
import { RallyState } from '../RallyState';
import type { MatchHooks as Hooks, MatchStats } from '../ports/MatchHooks';
import type { ActionIntent } from '../control/ActionIntent';
import type { RandomSource } from '../../core/random';
import type { SimulationTelemetryEmitter } from '../simulation/SimulationTelemetry';

export interface GameplayRandomStreams {
  readonly rules: RandomSource;
  readonly ai: RandomSource;
  readonly contact: RandomSource;
  readonly control: RandomSource;
}

export interface MechanicsCtx {
  ball: BallSimulationPort;
  rally: RallyState;
  hooks: Hooks;
  diff: Difficulty;
  servingTeam: TeamSide; // leitura (saque)
  aim: THREE.Vector3; // leitura (cortada humana)
  chosenZone: number; // leitura (levantamento humano)
  stats: MatchStats; // escrita (stats.blocks no bloqueio)
  random: GameplayRandomStreams;
  emitTelemetry: SimulationTelemetryEmitter;
  isHumanSide(side: TeamSide): boolean;
  teamOf(side: TeamSide): Team;
  after(t: number, fn: () => void): void;
  planNext(kind: TouchKind): void;
  startRally(): void; // transição de estado: o saque entrou em jogo
  /** Consome a intenção de bloqueio humano vinculada à cortada rival atual. */
  takeHumanBlockIntent?(planId: number): ActionIntent | null;
}
