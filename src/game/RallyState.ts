// Estado de um rally: posse, contagem de toques, plano do próximo contato e eventos de rede.
// Extraído de Match.ts para centralizar os campos que antes viviam espalhados na partida.
import * as THREE from 'three';
import { TeamSide, TouchKind } from '../core/constants';
import { Athlete } from './Team';

export interface TouchPlan {
  side: TeamSide;
  athlete: Athlete;
  contactIn: number; // segundos até o contato ideal
  point: THREE.Vector3; // onde a bola estará no contato
  kind: TouchKind; // o que este toque deve ser
  isHuman: boolean;
  jumpScheduledIn?: number; // p/ ataque IA
  done: boolean;
}

export class RallyState {
  // posse e toques
  possessionTeam: TeamSide | null = null;
  possessionTouches = 0;
  lastTouchTeam: TeamSide | null = null;
  lastKind: TouchKind = 'serve';
  rallyTouches = 0;

  // próximo contato e geometria de rede
  plan: TouchPlan | null = null;
  netEventIn: number | null = null;
  crossIn: number | null = null;
  prevBallX = 0;

  // planejamento: quem joga o próximo toque e bloqueadores agendados
  setterHold: Athlete | null = null;
  plannedAttacker: Athlete | null = null;
  lastToucher: Athlete | null = null;
  blockers: { athlete: Athlete; jumpIn: number }[] = [];

  /** Conta um toque para o lado: bola nova em um time abre a posse com 1; mesmo time incrementa. */
  countTouch(side: TeamSide): void {
    if (this.possessionTeam !== side) {
      this.possessionTeam = side;
      this.possessionTouches = 1;
    } else {
      this.possessionTouches++;
    }
  }

  /** Quantos toques o lado indicado já deu nesta posse (0 se não está com a bola). */
  touchesOf(side: TeamSide): number {
    return this.possessionTeam === side ? this.possessionTouches : 0;
  }

  /** Zera o estado do rally para começar um novo (chamado no preparo do saque). */
  reset(): void {
    this.possessionTeam = null;
    this.possessionTouches = 0;
    this.rallyTouches = 0;
    this.lastTouchTeam = null;
    this.plan = null;
    this.netEventIn = null;
  }
}
