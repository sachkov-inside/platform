import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { tap, type Observable } from "rxjs";

/** Bank acknowledgement is plain text only after the application operation succeeds. */
@Injectable()
export class BankAcknowledgementInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(tap(() => {
      context.switchToHttp().getResponse<FastifyReply>().header("content-type", "text/plain; charset=utf-8");
    }));
  }
}
