import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { UNKNOWN_ERROR } from '@org/chore';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ApiErrorBody } from './api-error';
import { DomainFailureException, RequestValidationException } from './api-error';

const GENERIC_MESSAGE = 'An unexpected error occurred';

/** Les codes des erreurs HTTP du framework (route inconnue, JSON illisible, corps trop gros…). */
const HTTP_CODES: Readonly<Partial<Record<number, string>>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

/**
 * Toute erreur devient `{ error: { code, message } }`. Le message d'une panne inattendue n'est
 * jamais renvoyé (il peut contenir des détails d'infrastructure) : il est journalisé.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.describe(exception);

    if (status === HttpStatus.UNAUTHORIZED) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof DomainFailureException) {
      const { code, message } = exception.failure;
      const status = exception.getStatus();

      if (status >= 500) {
        this.logger.error(`${code}: ${message}`);
        return {
          status,
          body: { error: { code, message: code === UNKNOWN_ERROR ? GENERIC_MESSAGE : message } },
        };
      }
      return { status, body: { error: { code, message } } };
    }

    if (exception instanceof RequestValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: exception.details } },
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, try again later' } },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      return {
        status,
        body: { error: { code: HTTP_CODES[status] ?? `HTTP_${status}`, message: exception.message } },
      };
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: UNKNOWN_ERROR, message: GENERIC_MESSAGE } },
    };
  }
}
