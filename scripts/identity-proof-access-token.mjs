// @ts-check
import process from "node:process";

const maximumSeconds = 5 * 60;

/**
 * Срок жизни токена доступа Platform на стенде Logto. Bootstrap создаёт с ним ресурс, а проверки
 * ждут по нему истечения токена, поэтому значение читается только здесь.
 *
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function readAccessTokenTtl(environment = process.env) {
  const value = environment["IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS"];
  if (value === undefined) return maximumSeconds;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > maximumSeconds) {
    throw new Error(
      "IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS must be between 60 and 300",
    );
  }
  return seconds;
}

/**
 * Момент, когда токен, выданный не позже `signedInAt`, уже истёк: `exp` в токене — целые секунды,
 * поэтому лишняя секунда покрывает округление.
 *
 * @param {number} signedInAt миллисекунды монотонных часов при завершённом входе
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function accessTokenExpiredAt(signedInAt, environment = process.env) {
  return signedInAt + (readAccessTokenTtl(environment) + 1) * 1_000;
}
