import { HttpException, HttpStatus } from '@nestjs/common';
import type { ResultError } from '@org/chore';
import { UNKNOWN_ERROR } from '@org/chore';

/** Le corps de toute réponse d'erreur de l'API. */
export type ApiErrorBody = {
  error: {
    /** Code stable : les clients choisissent leur phrase d'après lui. */
    code: string;
    /** Message technique (en anglais), pour les journaux et le débogage : jamais à afficher tel quel. */
    message: string;
    /** Le détail des champs refusés (`VALIDATION_ERROR`). */
    details?: Array<{ path: string; message: string }>;
  };
};

/** Le statut HTTP de chaque code d'erreur du domaine et de l'API. */
export const ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  WEAK_PASSWORD: HttpStatus.BAD_REQUEST,
  INVALID_EMAIL: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_SESSION: HttpStatus.UNAUTHORIZED,
  EMAIL_NOT_CONFIRMED: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  OBJECTIVE_NOT_FOUND: HttpStatus.NOT_FOUND,
  TASK_NOT_FOUND: HttpStatus.NOT_FOUND,
  CONVERSATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_ALREADY_EXIST: HttpStatus.CONFLICT,
  WORKFLOW_BUSY: HttpStatus.CONFLICT,
  NO_PENDING_PERMISSION: HttpStatus.CONFLICT,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  FAIL_TO_SAVE_OBJECTIVE: HttpStatus.INTERNAL_SERVER_ERROR,
  FAIL_TO_SAVE_TASK: HttpStatus.INTERNAL_SERVER_ERROR,
  [UNKNOWN_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
};

export function statusOfCode(code: string): HttpStatus {
  return ERROR_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * L'échec d'un cas d'usage (ou de l'API) qui remonte jusqu'au filtre d'exceptions : son code
 * choisit le statut HTTP.
 */
export class DomainFailureException extends HttpException {
  constructor(readonly failure: ResultError) {
    super(failure.message, statusOfCode(failure.code));
  }
}

/** La requête n'a pas de jeton valide. */
export function unauthenticated(): DomainFailureException {
  return new DomainFailureException({ code: 'UNAUTHENTICATED', message: 'Missing or invalid access token' });
}

/** Le corps, les paramètres ou la requête ne respectent pas le contrat. */
export class RequestValidationException extends HttpException {
  constructor(readonly details: Array<{ path: string; message: string }>) {
    super('Invalid request', HttpStatus.BAD_REQUEST);
  }
}
