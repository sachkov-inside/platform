// @ts-check
/**
 * Печатает через пробел столько свободных портов из резервного диапазона, сколько просит первый
 * аргумент (#896). Порты одного вызова различны: `reservePort` не выдаёт порт дважды в процессе.
 * Вызывает `apps/web/test/support/browser-test-ports.mjs`: конфигурации Playwright синхронны, а
 * проверка свободного порта — нет.
 *
 *   node scripts/reserve-ports.mjs <count>
 */
import { reservePort } from "./smoke-stand.mjs";

const count = Number(process.argv[2]);
if (!Number.isInteger(count) || count < 1) {
  throw new Error("Usage: node scripts/reserve-ports.mjs <count>");
}
const ports = [];
for (let index = 0; index < count; index += 1) {
  ports.push(await reservePort());
}
process.stdout.write(ports.join(" "));
