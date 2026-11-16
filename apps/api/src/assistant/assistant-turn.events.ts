import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { TurnEnded } from '@org/ai-assistant';
import type { Observable } from 'rxjs';
import { Subject } from 'rxjs';

/**
 * Les fins de tour d'Akari, publiées pour qui veut les entendre. L'assistant annonce un fait (un tour a
 * réussi, ou une panne l'a arrêté) sans savoir qui écoute : aujourd'hui, les politiques d'usage.
 */
@Injectable()
export class AssistantTurnEvents implements OnModuleDestroy {
  private readonly ended = new Subject<TurnEnded>();

  /** Chaque fin de tour, au moment où le workflow revient au repos. */
  readonly ended$: Observable<TurnEnded> = this.ended.asObservable();

  publish(turn: TurnEnded): void {
    this.ended.next(turn);
  }

  onModuleDestroy(): void {
    this.ended.complete();
  }
}
