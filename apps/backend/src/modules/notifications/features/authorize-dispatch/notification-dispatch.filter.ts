import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PRIVATE_NO_STORE_HEADERS } from '../../../../infrastructure/http/http-cache-policy.js';
import { dispatchResponseSchema } from '../../domain/notification-wire.js';

/** The service protocol requires correlated JSON errors, not the public RFC 9457 wrapper. */
@Catch(HttpException)
export class NotificationDispatchFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const parsed = dispatchResponseSchema.safeParse(exception.getResponse());
    const status = exception.getStatus();
    host.switchToHttp().getResponse<FastifyReply>().status(status).headers(PRIVATE_NO_STORE_HEADERS).type('application/json')
      .send(parsed.success ? parsed.data : { code: status === 401 ? 'unauthorized' : 'malformed' });
  }
}
