import { lockNotification } from '../../../../infrastructure/prisma/index.js';
import { stageDeliveryCommand } from '../../infrastructure/stage-delivery-command.js';
import { randomUUID } from 'node:crypto';
import { deliverySchema, eventSchema, fingerprint, commandWindow, channelSchema } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import { optedIn } from '../change-preferences/change-preferences.js';
import { answer, settle, validSource, type NotificationDependencies } from './expand-audience.js';

/** Replace only a command with a correlated not-started result, never merely an expired lease. */
export async function refreshDeliveries(deps: NotificationDependencies) {
  const candidates = await deps.prisma.notificationDelivery.findMany({ where: { state: 'suppressed', recoverySkipped: false, nextCommandAt: { lte: deps.now() }, reason: { in: ['expired', 'superseded'] } }, orderBy: [{ nextCommandAt: 'asc' }, { id: 'asc' }], take: 25, include: { notification: true } });
  for (const candidate of candidates) {
    const facts = await readRefreshFacts(deps, candidate.notification, candidate.channel);
    await deps.prisma.$transaction(async transaction => {
      await lockNotification(transaction, `delivery:${candidate.id}`);
      const delivery = await transaction.notificationDelivery.findUniqueOrThrow({ where: { id: candidate.id }, include: { notification: true } });
      if (delivery.state !== 'suppressed' || delivery.recoverySkipped || delivery.commandRevision !== candidate.commandRevision) return;
      await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { nextCommandAt: new Date(deps.now().getTime() + 30_000) } });
      const stored = await transaction.notificationCommand.findUniqueOrThrow({ where: { deliveryId_revision: { deliveryId: delivery.id, revision: delivery.commandRevision } } });
      const old = deliverySchema.parse(JSON.parse(stored.payload));
      const event = eventSchema.parse(JSON.parse(delivery.notification.eventPayload));
      // One reading decides both that the event is still live and what window the replacement gets.
      const deliveryWindow = commandWindow(deps.now(), new Date(event.notAfter));
      if (!deliveryWindow) {
        await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { nextCommandAt: null } });
        return;
      }
      // The facts were read before the lock; when they describe another event, the refresh repeats later.
      if (facts?.eventPayload !== delivery.notification.eventPayload) return;
      const source = answer(facts.source);
      if (!validSource(event, source)) return;
      const channel = channelSchema.parse(delivery.channel);
      if (source.content.category === 'material' && (!await optedIn(transaction, delivery.notification.accountId, channel, new Date(event.occurredAt)) || answer(facts.access) !== 'allowed')) return;
      const binding = answer(facts.binding);
      if (!binding || fingerprint(binding) !== fingerprint(old.binding)) return;
      // Без адреса читателя команду не пересобрать: замена подождёт настройки доставки.
      if (deps.origin === undefined) return;
      const template = renderNotification(source, deps.origin);
      const command = { ...old, operationId: randomUUID(), commandRevision: old.commandRevision + 1, sourceEventId: event.messageId,
        content: source.content, templateRef: template.templateRef, templateRevision: template.templateRevision, text: template.text,
        ...(channel === 'email' ? { subject: template.subject } : {}), ...deliveryWindow };
      await stageDeliveryCommand(transaction, command, deps.now());
    });
  }
}

/**
 * Source, access and recipient binding come from other Modules on their own connections, so they
 * are read before the refresh transaction and judged under its Delivery lock, which guards none of
 * them. A failed read surfaces only where the refresh takes its answer, as it did in place.
 */
async function readRefreshFacts(deps: NotificationDependencies, notification: { readonly eventPayload: string; readonly accountId: string }, delivery: string) {
  // A value that does not parse fails in the transaction, where it failed before.
  const event = eventSchema.safeParse(JSON.parse(notification.eventPayload));
  if (!event.success) return undefined;
  const channel = channelSchema.safeParse(delivery);
  const source = await settle(() => deps.sources.resolve(event.data));
  const current = source.status === 'fulfilled' && validSource(event.data, source.value) ? source.value : undefined;
  const access = current?.content.category === 'material' ? await settle(() => deps.sources.canRead(notification.accountId, event.data.sourceRef)) : undefined;
  const binding = channel.success && current && (!access || (access.status === 'fulfilled' && access.value === 'allowed'))
    ? await settle(() => deps.recipients.binding(notification.accountId, channel.data))
    : undefined;
  return { eventPayload: notification.eventPayload, source, access, binding };
}
