import { BusEvent } from './bus-event';

/** Ce qu'un abonné reçoit : un événement à la fois, dans l'ordre de publication. */
export type BusHandler = (event: BusEvent) => void | Promise<void>;

export type BusSubscription = {
  unsubscribe(): void;
};

export interface BusLogger {
  error(message: string, error?: unknown): void;
}

/**
 * Le bus d'événements ([ADR 0010](../../../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)) :
 * les workflows y publient leurs faits, l'application s'y abonne pour réagir. Qui publie ne sait pas qui
 * écoute, ni quel bus le transporte.
 *
 * Au plus une fois : un événement peut se perdre (un serveur qui tombe, un bus distant injoignable), jamais
 * être livré deux fois par le bus lui-même. Chaque abonné reçoit les événements dans l'ordre où ils ont été
 * publiés ; une erreur d'abonné est journalisée, jamais remontée à celui qui publie ni aux autres abonnés.
 */
export abstract class EventBus {
  /** Remettre un événement au bus : résout quand le bus l'a pris en charge, pas quand les abonnés l'ont traité. */
  abstract publish(event: BusEvent): Promise<void>;

  /** S'abonner à un type d'événement, ou à tous avec `*`. */
  abstract subscribe(type: string, handler: BusHandler): BusSubscription;

  /** Libérer ce que le bus tient (connexions). Sans effet pour un bus en mémoire. */
  async close(): Promise<void> {
    /* rien à libérer */
  }
}
