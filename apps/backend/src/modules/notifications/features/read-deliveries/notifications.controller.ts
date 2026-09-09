import { Body, Controller, Get, Post, HttpCode, HttpException, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccountGuard, CurrentAccount, type AuthenticatedAccount } from '../../../accounts/index.js';
import { PrivateNoStore } from '../../../../infrastructure/http/http-cache-policy.js';
import { toOpenApiSchema, problemDetailsContent, problemDetailsSchema } from '../../../../infrastructure/http/zod-openapi.js';
import { Notifications } from '../../facets/notifications/notifications.js';
import { changePreferencesSchema, preferenceSchema, preferenceResultSchema } from '../change-preferences/change-preferences.js';
import { recoverySchema, deliveryViewSchema } from './read-deliveries.js';
function queryId(value: string | undefined): string | undefined {
  const parsed = z.uuid().optional().safeParse(value);
  if (!parsed.success) throw new HttpException({ code: 'invalid_input' }, 400);
  return parsed.data;
}
@Controller('accounts/current/notifications')
@ApiBearerAuth('logto')
@ApiTags('Notifications')
@ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ['dependency_unavailable'])) })
@ApiResponse({ status: 500, content: problemDetailsContent(problemDetailsSchema(500, ['internal_error'])) })
@PrivateNoStore()
@UseGuards(AccountGuard)
export class NotificationPreferencesController {
  constructor(@Inject(Notifications) private readonly notifications: Notifications) {}
  @Get('preferences')
  @ApiOperation({ operationId: 'readNotificationPreferences', summary: 'Read own material notification opt-ins' })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(preferenceSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ['invalid_proof', 'account_not_found'])) })
  read(@CurrentAccount() account: AuthenticatedAccount) { return this.notifications.readPreferences(account.accountId); }
  @Post('preferences')
  @HttpCode(200)
  @ApiOperation({ operationId: 'changeNotificationPreferences', summary: 'Change own channel opt-ins with revision and idempotency' })
  @ApiBody({ schema: toOpenApiSchema(changePreferencesSchema) })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(preferenceResultSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ['invalid_input'])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ['invalid_proof', 'account_not_found'])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(problemDetailsSchema(409, ['revision_conflict', 'operation_conflict', 'not_unknown'])) })
  async change(@CurrentAccount() account: AuthenticatedAccount, @Body() body: unknown) {
    const result = await this.notifications.changePreferences(account.accountId, body);
    if (!result.ok) throw new HttpException({ code: result.code }, result.code === 'invalid_input' ? 400 : 409);
    return result;
  }
  @Get('deliveries')
  @ApiOperation({ operationId: 'readOwnNotificationDeliveries', summary: 'Read own delivery summaries without recipients or provider payloads' })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ['invalid_input'])) })
  @ApiQuery({ name: 'after', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(z.array(deliveryViewSchema)) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ['invalid_proof', 'account_not_found'])) })
  async deliveries(@CurrentAccount() account: AuthenticatedAccount, @Query('after') after?: string) { return this.notifications.readDeliveries(account.accountId, queryId(after)); }
}
@Controller('operations/notifications')
@ApiBearerAuth('logto')
@ApiTags('Notifications')
@ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ['dependency_unavailable'])) })
@ApiResponse({ status: 500, content: problemDetailsContent(problemDetailsSchema(500, ['internal_error'])) })
@PrivateNoStore()
@UseGuards(AccountGuard)
export class NotificationOperationsController {
  constructor(@Inject(Notifications) private readonly notifications: Notifications) {}
  @Get('accounts/:accountId/deliveries')
  @ApiOperation({ operationId: 'readOperatorNotificationDeliveries', summary: 'Read delivery summaries as current Platform administrator' })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ['invalid_input'])) })
  @ApiQuery({ name: 'after', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(z.array(deliveryViewSchema)) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ['invalid_proof', 'account_not_found'])) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ['forbidden'])) })
  async read(@CurrentAccount() actor: AuthenticatedAccount, @Param('accountId') account: string, @Query('after') after?: string) {
    const result = await this.notifications.readOperatorDeliveries(actor.accountId, queryId(account) ?? '', queryId(after));
    if (!result.ok) throw new HttpException({ code: result.code }, 403);
    return result.deliveries;
  }
  @Post('unknown/resolve')
  @HttpCode(200)
  @ApiOperation({ operationId: 'resolveUnknownNotificationDelivery', summary: 'Audit an administrator skip, preserving unknown and prohibiting resend' })
  @ApiBody({ schema: toOpenApiSchema(recoverySchema) })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(z.object({ ok: z.literal(true) })) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ['invalid_input'])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ['invalid_proof', 'account_not_found'])) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ['forbidden'])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(problemDetailsSchema(409, ['revision_conflict', 'operation_conflict', 'not_unknown'])) })
  async resolve(@CurrentAccount() actor: AuthenticatedAccount, @Body() body: unknown) {
    const result = await this.notifications.resolveUnknown(actor.accountId, body);
    if (!result.ok) throw new HttpException({ code: result.code }, result.code === 'forbidden' ? 403 : result.code === 'invalid_input' ? 400 : 409);
    return result;
  }
}
