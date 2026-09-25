import { commandDigest } from "../../../infrastructure/contracts/canonical-digest.js";

/**
 * Отпечаток команды для повторов: порядок ключей и отсутствующие необязательные поля не меняют
 * результат, поэтому та же нагрузка узнаётся, а изменённая конфликтует.
 */
export function commandFingerprint(operation: string, command: unknown): string {
  return commandDigest({ version: 1, operation, command });
}
