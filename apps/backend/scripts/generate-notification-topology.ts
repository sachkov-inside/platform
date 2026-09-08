import { readFileSync, writeFileSync } from 'node:fs';
import { localNotificationTopology } from '../src/infrastructure/notification-transport/topology.js';
const target = new URL('../../../infra/notifications/local-definitions.json', import.meta.url);
const output = `${JSON.stringify(localNotificationTopology(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Local Notification topology drift');
} else writeFileSync(target, output);
