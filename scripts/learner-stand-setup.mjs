// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const learnerStandProfile = {
  url: "http://127.0.0.1:3002/mcp/learning",
  callbackUrl: "http://127.0.0.1:4387/callback",
  callbackPort: 4387,
  scope: "learning:read",
};

/** Specialize the existing restricted review instructions for the local public PKCE client.
 * @param {string} root
 * @param {string} clientId
 * @param {string} resource */
export async function writeLearnerStandSetup(root, clientId, resource) {
  const template = await readFile(
    resolve(root, "apps/web/public/practice-review-setup.txt"),
    "utf8",
  );
  const setting =
    '  -c "mcp_servers.inside_learning.url=\\\"$INSIDE_MCP_URL\\\"" \\\n';
  const oauth = [
    `  -c 'mcp_servers.inside_learning.oauth.client_id="${clientId}"'`,
    `  -c 'mcp_servers.inside_learning.oauth.callback_url="${learnerStandProfile.callbackUrl}"'`,
    `  -c 'mcp_servers.inside_learning.oauth.callback_port=${learnerStandProfile.callbackPort}'`,
    `  -c 'mcp_servers.inside_learning.oauth_resource="${resource}"'`,
    `  -c 'mcp_servers.inside_learning.scopes=["openid","offline_access","${learnerStandProfile.scope}"]'`,
  ]
    .map((line) => `${line} \\\n`)
    .join("");
  if (!template.includes(setting))
    throw new Error(
      "Learner setup template lost the MCP settings insertion point",
    );
  const certificate = resolve(root, ".identity-proof/tls/certificate.pem");
  const setup = template
    .replace("https://LEARNER_MCP_HOST/mcp/learning", learnerStandProfile.url)
    .replaceAll(setting, setting + oauth)
    .replace(
      "--oauth-client-registration dcr",
      `--scopes openid,offline_access,${learnerStandProfile.scope} --no-browser`,
    )
    .replace(/2Б\. Claude Code[\s\S]*?(?=3\. На странице)/u, "")
    .replace(/4Б\. Claude Code[\s\S]*?(?=5\. Сначала)/u, "")
    .replace(
      "3. На странице",
      "После команды входа скопируйте напечатанный адрес, добавьте в его конец &prompt=consent\nи откройте в браузере. Терминал оставьте открытым до завершения входа. Это позволяет\nLogto выдать refresh token и не повторять вход каждые пять минут. Если терминал\nпродолжает ждать Callback URL, скопируйте полный адрес обратного перехода из браузера\nи вставьте только в этот локальный терминал. Не передавайте callback или токены в чат.\n\n3. На странице",
    );
  await writeFile(
    resolve(root, ".identity-proof/practice-review-setup.txt"),
    `Локальный стенд Inside AI Engineering. Эта инструкция настроена для Codex.\nВходите тем же тестовым аккаунтом, что и на сайте. Реальных платежей нет.\nСначала выполните в терминале:\nexport CODEX_CA_CERTIFICATE='${certificate.replaceAll("'", "'\\''")}'\nexport SSL_CERT_FILE="$CODEX_CA_CERTIFICATE"\nexport NO_PROXY="identity.inside.localhost,127.0.0.1,localhost,\${NO_PROXY:-}"\nexport no_proxy="$NO_PROXY"\n\n${setup}`,
  );
}
