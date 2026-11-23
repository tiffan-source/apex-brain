import { BusEvent } from './bus-event';

/** Ce qu'un abonné reçoit : un événement à la fois, dans l'ordre de publication. */
export type BusHandler = (event: BusEvent) => void | Promise<void>;

export type BusSubscription = {
  unsubscribe(): void;
};

/**
 * Où un abonné reçoit les événements quand l'API tourne sur plusieurs instances.
 *
 * - `one-instance` (par défaut) : chaque événement est remis sur une seule instance, celle qui le
 *   publie. Pour les réactions du serveur (compter un tour, journaliser une panne), qui ne doivent pas
 *   se répéter sur chaque instance.
 * - `every-instance` : chaque instance le reçoit, quelle que soit celle qui le publie. Pour ce qui suit
 *   une connexion ouverte sur l'instance (le flux SSE d'un client), qui n'est pas forcément celle où
 *   tourne le workflow.
 *
 * Avec une seule instance, les deux reviennent au même.
 */
export type BusDelivery = 'one-instance' | 'every-instance';

export type BusSubscribeOptions = {
  delivery?: BusDelivery;
};

export interface BusLogger {
  error(message: string, error?: unknown): void;
  /** Ce qui n'est pas une panne mais mérite une trace (une connexion rétablie). */
  info?(message: string): void;
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
  /**
   * Remettre un événement au bus : résout quand le bus l'a pris en charge, pas quand les abonnés l'ont
   * traité. Rejette si le bus est fermé ou ne peut pas le transporter.
   */
  abstract publish(event: BusEvent): Promise<void>;

  /** S'abonner à un type d'événement, ou à tous avec `*` ; sur une seule instance, par défaut. */
  abstract subscribe(type: string, handler: BusHandler, options?: BusSubscribeOptions): BusSubscription;

  /**
   * Se fermer, en dernier à l'arrêt : les abonnés finissent de traiter ce qu'ils ont reçu, puis le bus ne
   * publie ni ne livre plus rien et libère ce qu'il tient (connexions).
   */
  abstract close(): Promise<void>;
}

/** Ce que rejette `publish` sur un bus fermé. */
export class EventBusClosedError extends Error {
  constructor() {
    super('The event bus is closed');
    this.name = 'EventBusClosedError';
  }
}
