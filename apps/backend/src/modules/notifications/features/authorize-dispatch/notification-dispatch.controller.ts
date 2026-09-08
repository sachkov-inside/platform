import { NotificationDispatchFilter } from "./notification-dispatch.filter.js";
import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PLATFORM_CONFIG, type PlatformConfig } from '../../../../config/platform-config.js';
import { bearerCredential, credentialsMatch } from '../../../../infrastructure/http/bearer-credentials.js';
import { PrivateNoStore } from '../../../../infrastructure/http/http-cache-policy.js';
import { toOpenApiSchema } from '../../../../infrastructure/http/zod-openapi.js';
import { authorizeSchema, dispatchResponseSchema } from '../../domain/notification-wire.js';
import { Notifications } from '../../facets/notifications/notifications.js';
const genericError = z.object({ code: z.enum(['malformed', 'unauthorized']) });
@Controller('internal/notifications/dispatch')
@ApiBearerAuth('telegram-notifications')
@ApiTags('Notifications')
@UseFilters(NotificationDispatchFilter)
@PrivateNoStore()
export class NotificationDispatchController {
  constructor(@Inject(Notifications) private readonly notifications: Notifications, @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig) {}
  @Post('authorize')
  @HttpCode(200)
  @ApiOperation({ operationId: 'authorizeNotificationDispatch', summary: 'Authorize one correlated Telegram attempt against current source and binding' })
  @ApiBody({ schema: toOpenApiSchema(authorizeSchema) })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(dispatchResponseSchema) })
  @ApiResponse({ status: 400, schema: toOpenApiSchema(genericError) })
  @ApiResponse({ status: 401, schema: toOpenApiSchema(genericError) })
  @ApiResponse({ status: 409, schema: toOpenApiSchema(dispatchResponseSchema) })
  @ApiResponse({ status: 422, schema: toOpenApiSchema(dispatchResponseSchema) })
  @ApiResponse({ status: 503, schema: toOpenApiSchema(dispatchResponseSchema) })
  async authorize(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const secret = this.config.notificationDelivery?.telegramSecret;
    if (!secret || !credentialsMatch(bearerCredential(authorization) ?? '', secret)) throw new HttpException({ code: 'unauthorized' }, 401);
    const versioned = authorizeSchema.extend({ contractVersion: z.string() }).safeParse(body);
    if (versioned.success && versioned.data.contractVersion !== 'inside.notification-dispatch.v1') {
      throw new HttpException({ ...versioned.data, contractVersion: 'inside.notification-dispatch.v1', status: 'error', code: 'unsupported_contract' }, 422);
    }
    const parsed = authorizeSchema.safeParse(body);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(body)) > 16 * 1024) throw new HttpException({ code: 'malformed' }, 400);
    const result = await this.notifications.authorizeDispatch('telegram', parsed.data).catch(() => ({ ...parsed.data, status: 'error' as const, code: 'unavailable' as const }));
    if (result.status === 'error') throw new HttpException(result, result.code === 'operation_conflict' ? 409 : 503);
    return result;
  }
}
