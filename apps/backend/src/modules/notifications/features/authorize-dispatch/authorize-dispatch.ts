import { randomUUID } from 'node:crypto';
import { lockNotification, type NotificationsPrisma } from '../../../../infrastructure/prisma/index.js';
import { authorizeSchema, dispatchResponseSchema, deliverySchema, eventSchema, fingerprint, PERMIT_LIFETIME_MS, type Channel, type DispatchResponse } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import { validSource, type NotificationDependencies } from '../expand-audience/expand-audience.js';
import { optedIn } from '../change-preferences/change-preferences.js';

export async function authorizeDispatch(deps: NotificationDependencies, channel: Channel, input: unknown): Promise<DispatchResponse> {
  const request = authorizeSchema.parse(input);
  const facts = await readDispatchFacts(deps, channel, request);
  return deps.prisma.$transaction(async transaction => {
    // One order for all authorizations: request receipt, then Delivery.
    await lockNotification(transaction, `authorize:${channel}:${request.operationId}`);
    const digest = fingerprint(request);
    const old = await transaction.notificationAuthorization.findUnique({ where: { channel_operationId: { channel, operationId: request.operationId } } });
    if (old) return old.digest === digest ? dispatchResponseSchema.parse(JSON.parse(old.response)) : { ...request, status: 'error', code: 'operation_conflict' };
    await lockNotification(transaction, `delivery:${request.deliveryRef}`);
    const decide = async (): Promise<DispatchResponse> => {
      const stored = await findDeliveryCommand(transaction, channel, request);
      if (!stored) return { ...request, status: 'denied', reason: 'not_found' };
      if (stored.digest !== request.payloadDigest || stored.revision !== request.commandRevision) return { ...request, status: 'denied', reason: 'payload_conflict' };
      if (stored.delivery.commandRevision !== stored.revision || stored.delivery.recoverySkipped || ['sent', 'failed'].includes(stored.delivery.state)) return { ...request, status: 'denied', reason: 'superseded' };
      const command = deliverySchema.parse(JSON.parse(stored.payload));
      if (new Date(command.notAfter) <= deps.now()) return { ...request, status: 'denied', reason: 'expired' };
      const notification = stored.delivery.notification;
      const event = eventSchema.parse(JSON.parse(notification.eventPayload));
      // The facts were read before the locks; when they describe another notification, the attempt repeats.
      if (facts?.notificationId !== notification.id || facts.eventPayload !== notification.eventPayload) return { ...request, status: 'error', code: 'unavailable' };
      const { source } = facts;
      if (source.status === 'unavailable') return { ...request, status: 'error', code: 'unavailable' };
      if (!validSource(event, source) || command.sourceEventId !== event.messageId || fingerprint(command.content) !== fingerprint(source.content)) return { ...request, status: 'denied', reason: 'superseded' };
      // Без адреса читателя текст команды не с чем сравнить: это временное состояние настройки,
      // а не отказ по существу, поэтому попытка повторится.
      if (deps.origin === undefined) return { ...request, status: 'error', code: 'unavailable' };
      const template = renderNotification(source, deps.origin);
      if (template.text !== command.text || template.templateRef !== command.templateRef || template.templateRevision !== command.templateRevision || (channel === 'email' && template.subject !== command.subject)) return { ...request, status: 'denied', reason: 'superseded' };
      if (source.content.category === 'material') {
        if (!await optedIn(transaction, notification.accountId, channel, new Date(event.occurredAt))) return { ...request, status: 'denied', reason: 'preference_disabled' };
        const { access } = facts;
        if (access === undefined || access === 'unavailable') return { ...request, status: 'error', code: 'unavailable' };
        if (access === 'denied') return { ...request, status: 'denied', reason: 'access_denied' };
      }
      const { binding } = facts;
      if (!binding || fingerprint(binding) !== fingerprint(command.binding)) return { ...request, status: 'denied', reason: 'binding_conflict' };
      const deadline = Math.min(deps.now().getTime() + PERMIT_LIFETIME_MS, Date.parse(command.notAfter), Date.parse(event.notAfter));
      if (deadline <= deps.now().getTime()) return { ...request, status: 'denied', reason: 'expired' };
      return { ...request, status: 'allowed', permitRef: randomUUID(), validUntil: new Date(deadline).toISOString() };
    };
    const response = await decide();
    await transaction.notificationAuthorization.create({ data: { channel, operationId: request.operationId, digest, deliveryId: request.deliveryRef,
      attemptRef: request.attemptRef, response: JSON.stringify(response), createdAt: deps.now() } });
    return response;
  });
}

/**
 * Source, access and recipient binding come from other Modules on their own connections, so they
 * are read before the authorization transaction and judged under its locks; the locks guard none of
 * them. Unused answers cost a read, never a decision: the transaction applies them in its order.
 */
async function readDispatchFacts(deps: NotificationDependencies, channel: Channel, request: DeliveryCommandRef) {
  const stored = await findDeliveryCommand(deps.prisma, channel, request);
  if (!stored) return undefined;
  const notification = stored.delivery.notification;
  const event = eventSchema.safeParse(JSON.parse(notification.eventPayload));
  if (!event.success) return undefined;
  const source = await deps.sources.resolve(event.data);
  const access = source.status === 'current' && source.content.category === 'material'
    ? await deps.sources.canRead(notification.accountId, event.data.sourceRef)
    : undefined;
  const binding = await deps.recipients.binding(notification.accountId, channel);
  return { notificationId: notification.id, eventPayload: notification.eventPayload, source, access, binding };
}

type DeliveryCommandRef = { readonly deliveryOperationId: string; readonly deliveryRef: string };

/** The Delivery command the request names, when it belongs to that Delivery on this channel. */
async function findDeliveryCommand(prisma: Pick<NotificationsPrisma, 'notificationCommand'>, channel: Channel, request: DeliveryCommandRef) {
  const stored = await prisma.notificationCommand.findUnique({ where: { operationId: request.deliveryOperationId }, include: { delivery: { include: { notification: true } } } });
  return stored && stored.deliveryId === request.deliveryRef && stored.delivery.channel === channel ? stored : null;
}
