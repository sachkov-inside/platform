// @ts-check
// Внешняя проверка production (#245): workflow `production-monitor.yml` запускает её по расписанию с
// GitHub-hosted runner. Она замечает то, чего не увидит сторож на сервере: потерю VPS, DNS, TLS и
// маршрутов Caddy. Сигнал уходит после двух неудачных запусков подряд, восстановление — одной строкой.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { connect } from "node:tls";
import { pathToFileURL } from "node:url";

const siteOrigin = "https://inside.sachkov.dev";
const identityOrigin = "https://auth.sachkov.dev";
const requestTimeoutMilliseconds = 15_000;
const certificateMinimumDays = 14;
export const confirmingFailures = 2;

/**
 * @typedef {{ consecutiveFailures: number, alerted: boolean }} MonitorState
 * @typedef {{ state: MonitorState, message: string | null }} MonitorDecision
 */

/**
 * Решает, что сообщить владельцу по итогу запуска. Пока сигнал отправлен, новые отказы не повторяются.
 * @param {MonitorState} previous
 * @param {readonly string[]} failures
 * @returns {MonitorDecision}
 */
export function decide(previous, failures) {
  if (failures.length === 0) {
    return {
      state: { consecutiveFailures: 0, alerted: false },
      message: previous.alerted
        ? "Восстановлено: сайт, вход и TLS отвечают."
        : null,
    };
  }
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const alert = !previous.alerted && consecutiveFailures >= confirmingFailures;
  return {
    state: { consecutiveFailures, alerted: previous.alerted || alert },
    message: alert
      ? `Отказ (${String(consecutiveFailures)} проверки подряд):\n${failures.map((failure) => `- ${failure}`).join("\n")}`
      : null,
  };
}

/**
 * @param {string} path
 * @returns {MonitorState}
 */
export function readState(path) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { consecutiveFailures: 0, alerted: false };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "consecutiveFailures" in value &&
    "alerted" in value &&
    typeof value.consecutiveFailures === "number" &&
    Number.isInteger(value.consecutiveFailures) &&
    value.consecutiveFailures >= 0 &&
    typeof value.alerted === "boolean"
  ) {
    return {
      consecutiveFailures: value.consecutiveFailures,
      alerted: value.alerted,
    };
  }
  return { consecutiveFailures: 0, alerted: false };
}

/**
 * @param {string} url
 * @param {(response: Response) => Promise<string | null>} inspect
 * @returns {Promise<string | null>}
 */
async function checkUrl(url, inspect) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    if (response.status !== 200)
      return `${url}: HTTP ${String(response.status)}`;
    const problem = await inspect(response);
    return problem === null ? null : `${url}: ${problem}`;
  } catch (error) {
    return `${url}: ${error instanceof Error ? error.message : "запрос не выполнен"}`;
  }
}

/**
 * @param {string} host
 * @returns {Promise<string | null>}
 */
function checkCertificate(host) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host });
    socket.setTimeout(requestTimeoutMilliseconds, () => {
      socket.destroy();
      resolve(`TLS ${host}: нет ответа`);
    });
    socket.once("error", (error) => resolve(`TLS ${host}: ${error.message}`));
    socket.once("secureConnect", () => {
      const validTo = Date.parse(socket.getPeerCertificate().valid_to);
      socket.end();
      const days = Math.floor((validTo - Date.now()) / 86_400_000);
      resolve(
        Number.isNaN(days) || days < certificateMinimumDays
          ? `TLS ${host}: сертификат истекает через ${String(days)} дн.`
          : null,
      );
    });
  });
}

/** @returns {Promise<string[]>} */
export async function runChecks() {
  const results = await Promise.all([
    checkUrl(`${siteOrigin}/`, () => Promise.resolve(null)),
    checkUrl(`${siteOrigin}/billing/cohorts`, async (response) => {
      /** @type {unknown} */
      const body = await response.json();
      return typeof body === "object" &&
        body !== null &&
        "items" in body &&
        Array.isArray(body.items)
        ? null
        : "ответ без items";
    }),
    checkUrl(
      `${identityOrigin}/oidc/.well-known/openid-configuration`,
      async (response) => {
        /** @type {unknown} */
        const body = await response.json();
        return typeof body === "object" &&
          body !== null &&
          "issuer" in body &&
          body.issuer === `${identityOrigin}/oidc`
          ? null
          : "неверный issuer";
      },
    ),
    checkCertificate(new URL(siteOrigin).host),
    checkCertificate(new URL(identityOrigin).host),
  ]);
  return results.filter((result) => result !== null);
}

/**
 * Отправляет сообщение боту сигналов. Без настроенного бота возвращает false.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function notify(text) {
  const token = process.env["MONITOR_TELEGRAM_BOT_TOKEN"] ?? "";
  const chatId = process.env["MONITOR_TELEGRAM_CHAT_ID"] ?? "";
  if (token === "" || chatId === "") return false;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** @param {string} text */
function summarize(text) {
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "")
    appendFileSync(summary, `${text}\n`);
  console.log(text);
}

function runLink() {
  const server = process.env["GITHUB_SERVER_URL"] ?? "";
  const repository = process.env["GITHUB_REPOSITORY"] ?? "";
  const run = process.env["GITHUB_RUN_ID"] ?? "";
  return server === "" || repository === "" || run === ""
    ? ""
    : `\n${server}/${repository}/actions/runs/${run}`;
}

/**
 * Код выхода 1 значит: владельцу нужен сигнал, а бот сигналов его не доставил. Красный запуск
 * тогда сам становится сигналом через уведомления GitHub.
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const [command, argument] = argv;
  if (command === "check" && argument !== undefined) {
    const failures = await runChecks();
    const decision = decide(readState(argument), failures);
    writeFileSync(argument, `${JSON.stringify(decision.state)}\n`);
    summarize(
      failures.length === 0
        ? "Все внешние проверки прошли."
        : `Внешние проверки с отказом:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
    if (decision.message === null) return 0;
    summarize(`Сигнал владельцу: ${decision.message}`);
    const delivered = await notify(
      `Inside production · внешняя проверка\n${decision.message}${runLink()}`,
    );
    return delivered || decision.state.consecutiveFailures === 0 ? 0 : 1;
  }
  if (command === "notify" && argument !== undefined) {
    const delivered = await notify(
      `Inside production · ${argument}${runLink()}`,
    );
    summarize(
      delivered
        ? "Сигнал отправлен боту сигналов."
        : "Бот сигналов не настроен или недоступен.",
    );
    return 0;
  }
  console.error(
    "usage: production-monitor.mjs check <state.json> | notify <text>",
  );
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
