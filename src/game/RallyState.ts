// Estado de um rally: posse, contagem de toques, plano do próximo contato e eventos de rede.
// Extraído de Match.ts para centralizar os campos que antes viviam espalhados na partida.
import * as THREE from 'three';
import { TeamSide, TouchKind } from '../core/constants';
import { Athlete } from './Team';

export interface TouchPlan {
  planId: number;
  side: TeamSide;
  athlete: Athlete;
  contactIn: number; // segundos até o contato ideal
  point: THREE.Vector3; // onde a bola estará no contato
  kind: TouchKind; // o que este toque deve ser
  isHuman: boolean;
  tacticalRevision?: number;
  jumpScheduledIn?: number; // p/ ataque IA
  done: boolean;
}

export interface CommittedBlockPlan {
  readonly planId: number;
  readonly tacticalRevision: number;
  readonly side: TeamSide;
  readonly primaryAthleteId: number;
  readonly assistAthleteId: number | null;
}

export class RallyState {
  private nextPlanId = 1;
  // posse e toques
  possessionTeam: TeamSide | null = null;
  possessionTouches = 0;
  lastTouchTeam: TeamSide | null = null;
  lastKind: TouchKind = 'serve';
  rallyTouches = 0;

  // próximo contato e geometria de rede
  plan: TouchPlan | null = null;
  netEventIn: number | null = null;
  outAntennaIn: number | null = null; // countdown até o cruzamento fora da antena (falta)
  netEventPoint: THREE.Vector3 | null = null; // ponto analítico do toque na rede (snap)

  // planejamento: quem joga o próximo toque e bloqueadores agendados
  setterHold: Athlete | null = null;
  plannedAttacker: Athlete | null = null;
  lastToucher: Athlete | null = null;
  blockers: { athlete: Athlete; jumpIn: number; jumped: boolean }[] = [];
  blockPlan: CommittedBlockPlan | null = null;

  /** Identidade monotônica do plano; não reinicia entre pontos para impedir rebind obsoleto. */
  allocatePlanId(): number {
    return this.nextPlanId++;
  }

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

  /**
   * Passador a excluir no replanejamento de pass/dig: evita contato consecutivo do mesmo atleta
   * quando a bola volta ao mesmo lado (rebote de rede, passe ruim). O bloqueio não conta, então
   * após bloqueio o mesmo atleta pode jogar de novo.
   */
  excludedPasser(landSide: TeamSide): Athlete | undefined {
    return this.lastTouchTeam === landSide && this.lastKind !== 'block'
      ? (this.lastToucher ?? undefined)
      : undefined;
  }

  /** Zera o estado do rally para começar um novo (chamado no preparo do saque). */
  reset(): void {
    this.possessionTeam = null;
    this.possessionTouches = 0;
    this.rallyTouches = 0;
    this.lastTouchTeam = null;
    this.plan = null;
    this.netEventIn = null;
    this.outAntennaIn = null;
    this.netEventPoint = null;
    // planejamento: limpa bloqueadores agendados e ponteiros do próximo toque
    // para nenhum agendamento vazar entre pontos (pulo fantasma / lixo latente).
    this.blockers = [];
    this.blockPlan = null;
    this.setterHold = null;
    this.plannedAttacker = null;
    this.lastToucher = null;
  }
}
