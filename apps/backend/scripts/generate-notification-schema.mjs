import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../../../docs/contracts/notifications-v1/schema.json', import.meta.url);
const target = new URL('../src/infrastructure/notification-transport/schema.generated.ts', import.meta.url);
const schema = JSON.parse(readFileSync(source, 'utf8'));
const output = `// Generated from docs/contracts/notifications-v1/schema.json. Do not edit.\nexport const notificationSchema = ${JSON.stringify(schema, null, 2)};\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Notification schema drift; run notifications:generate');
} else writeFileSync(target, output);
