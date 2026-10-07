import { preProductCommand } from "../../../infrastructure/contracts/pre-product-command.js";
import {
  commandDigest,
  replayFingerprint,
  type ReplayFingerprint,
} from "../../../infrastructure/contracts/canonical-digest.js";

/**
 * Отпечаток команды для повторов: порядок ключей и отсутствующие необязательные поля не меняют
 * результат, поэтому та же нагрузка узнаётся, а изменённая конфликтует.
 */
export function commandFingerprint(
  operation: string,
  command: unknown,
): string {
  return commandDigest(preProductCommand({ version: 1, operation, command }));
}

/**
 * Тот же отпечаток для каталога, расчёта цены и покупки. До #732 их квитанции хранили сам текст
 * `JSON.stringify(command)`, зависящий от порядка ключей; такой сохранённый текст узнаётся и дальше.
 */
export function replayCommandFingerprint(
  operation: string,
  command: unknown,
): ReplayFingerprint {
  return replayFingerprint(
    preProductCommand({ version: 1, operation, command }),
    JSON.stringify(preProductCommand(command)),
  );
}
