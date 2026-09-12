import { z } from 'zod';
import type { Accounts } from '../../../accounts/index.js';
import type { NotificationEnvelope } from '../../../../infrastructure/notification-transport/wire.js';
import { assembleNotificationTransport } from '../notification-transport/notification-transport.js';
import { authorizeDispatch } from '../../features/authorize-dispatch/authorize-dispatch.js';
import { changePreferences, readPreferences } from '../../features/change-preferences/change-preferences.js';
import { expandAudience, type AudienceObservation, type NotificationDependencies } from '../../features/expand-audience/expand-audience.js';
import { refreshDeliveries } from '../../features/expand-audience/refresh-deliveries.js';
import { acceptEmailCommand, dispatchEmail } from '../../features/dispatch-email/dispatch-email.js';
import { acceptDeliveryResult } from '../../features/project-result/project-result.js';
import { readDeliveries, resolveUnknown } from '../../features/read-deliveries/read-deliveries.js';
import type { SendNotificationEmail } from '../../ports/notification-sources.js';
import type { Channel } from '../../domain/notification-wire.js';

export class Notifications {
  readonly transport;
  constructor(private readonly deps: NotificationDependencies, private readonly accounts: Accounts, quarantineCapacity = 1_000) {
    const transport = assembleNotificationTransport(deps.prisma, quarantineCapacity);
    this.transport = { ...transport, accept: (envelope: NotificationEnvelope) => this.acceptEvent(envelope),
      observe: async () => ({ ...await transport.observe(), emailPending: await deps.prisma.notificationEmailEffect.count({ where: { state: { in: ['accepted', 'retrying'] } } }),
        unknown: await deps.prisma.notificationDelivery.count({ where: { state: 'unknown', recoverySkipped: false } }) }) };
  }
  async acceptEvent(envelope: NotificationEnvelope) {
    if (envelope.lane === 'emailMaterial' || envelope.lane === 'emailSubscription') return acceptEmailCommand(this.deps.prisma, JSON.parse(envelope.payload), envelope.lane, this.deps.now);
    return assembleNotificationTransport(this.deps.prisma, 1_000).accept(envelope);
  }
  readPreferences(accountId: string) { return readPreferences(this.deps.prisma, z.uuid().parse(accountId)); }
  async changePreferences(accountId: string, command: unknown) {
    if (!await this.deps.recipients.exists(accountId)) return { ok: false as const, code: 'invalid_input' as const };
    return changePreferences(this.deps.prisma, accountId, command, this.deps.now);
  }
  authorizeDispatch(channel: Channel, input: unknown) { return authorizeDispatch(this.deps, channel, input); }
  acceptDeliveryResult(channel: Channel, input: unknown) { return acceptDeliveryResult(this.deps.prisma, channel, input); }
  readDeliveries(accountId: string, after?: string) { return readDeliveries(this.deps.prisma, z.uuid().parse(accountId), after); }
  async readOperatorDeliveries(actorId: string, accountId: string, after?: string) {
    const decision = await this.accounts.checkPermission({ accountId: actorId, permission: 'platform:admin' });
    if (!decision.ok || !decision.allowed) return { ok: false as const, code: 'forbidden' as const };
    return { ok: true as const, deliveries: await this.readDeliveries(accountId, after) };
  }
  resolveUnknown(actorId: string, input: unknown) { return resolveUnknown(this.deps.prisma, this.accounts, actorId, input, this.deps.now); }
  async sweep(send?: SendNotificationEmail) {
    // Each lane makes bounded progress independently; a saturated subscription lane cannot starve materials/results.
    for (const channel of ['email', 'telegram'] as const) {
      const lane = channel === 'email' ? 'emailResult' : 'telegramResult';
      const rows = await this.deps.prisma.notificationInbox.findMany({ where: { lane, completedAt: null, nextAttemptAt: { lte: this.deps.now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { receivedAt: 'asc' }], take: 25 });
      for (const row of rows) {
        const outcome = await this.acceptDeliveryResult(channel, JSON.parse(row.payload));
        if (outcome === 'deferred') {
          await this.deps.prisma.notificationInbox.update({ where: { scope_messageId: { scope: row.scope, messageId: row.messageId } }, data: { nextAttemptAt: new Date(this.deps.now().getTime() + 5_000) } });
          continue;
        }
        if (!['accepted', 'duplicate', 'stale'].includes(outcome)) await this.transport.quarantine(lane, Buffer.from(row.payload), outcome);
        await this.deps.prisma.notificationInbox.update({ where: { scope_messageId: { scope: row.scope, messageId: row.messageId } }, data: { completedAt: this.deps.now() } });
      }
    }
    const observations: AudienceObservation[] = [];
    for (const lane of ['billing', 'materials'] as const) {
      const expansion = await expandAudience(this.deps, lane, (target, bytes, reason) => this.transport.quarantine(target, bytes, reason));
      if (expansion.observation) observations.push(expansion.observation);
    }
    await refreshDeliveries(this.deps);
    if (send) for (const category of ['subscription', 'material'] as const) await dispatchEmail(this.deps, send, category);
    return observations;
  }
}
