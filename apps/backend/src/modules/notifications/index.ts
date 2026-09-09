export { assembleNotificationTransport, type NotificationTransport } from './facets/notification-transport/notification-transport.js';

export { Notifications } from './facets/notifications/notifications.js';
export { NotificationsModule } from './notifications.module.js';
export { assembleNotificationEmailSender } from './infrastructure/send-notification-email.js';
export type { NotificationDependencies } from './features/expand-audience/expand-audience.js';
export type { NotificationSource, NotificationSources, NotificationRecipients, SendNotificationEmail } from './ports/notification-sources.js';
